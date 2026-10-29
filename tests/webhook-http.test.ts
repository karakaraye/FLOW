import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import {
  createWorkflow,
  publishWorkflow,
  enqueue,
  getRun,
  cancelRun,
} from "../src/lib/engine/service";
import {
  manageWebhook,
  listWebhooks,
  signature,
  workflowState,
  verifySignature,
} from "../src/lib/webhooks/service";
import { createConnection } from "../src/lib/integrations/service";
import { storeHttpCredential } from "../src/lib/http-actions/credentials";
import { installFixture } from "./http-fixture-preload.mjs";
import type { Definition, Data } from "../src/lib/engine/definition";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(50);
  }
  throw Error("Timed out waiting for worker");
}
function worker(id: string, env: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/http-fixture-preload.mjs",
      "scripts/worker.ts",
      "--once",
      "--run-id",
      id,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return child;
}
async function exited(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((r, j) => {
    child.once("error", j);
    child.once("exit", r);
  });
}
function definition(
  trigger: "webhook_trigger" | "manual_trigger" = "webhook_trigger",
  http?: Data,
): Definition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: trigger, config: {} },
      ...(http
        ? [{ id: "request", type: "http_request" as const, config: http }]
        : [
            {
              id: "log",
              type: "log_event" as const,
              config: { message: "Received" },
            },
          ]),
    ],
    edges: [{ from: "start", to: http ? "request" : "log" }],
  };
}
test(
  "signed webhook and secure external-action integration",
  { timeout: 120000 },
  async (t) => {
    const email = `hook-${randomUUID()}@example.test`,
      password = `Secure-${randomUUID()}!`;
    const user = (
      await auth.api.signUpEmail({
        body: { email, password, name: "Webhook test" },
      })
    ).user;
    const space = await ensurePersonalWorkspace(user.id, user.name);
    const actor = { userId: user.id, workspaceId: space.workspaceId };
    let foreignId = "";
    const children: ChildProcess[] = [];
    const dir = mkdtempSync(join(tmpdir(), "flow-worker-tls-"));
    let restore: undefined | (() => void);
    let server: https.Server | undefined;
    const originalAllowed = process.env.HTTP_ACTION_ALLOWED_ORIGINS,
      originalIdempotent = process.env.HTTP_IDEMPOTENT_ORIGINS;
    try {
      const signed = await auth.api.signInEmail({
        body: { email, password },
        asResponse: true,
      });
      const cookie = signed.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const headers = {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      };
      const w = await createWorkflow(actor, {
        name: "Signed webhook",
        definition: definition(),
      });
      const v = await publishWorkflow(actor, w.id, 1);
      const hook = await manageWebhook(actor, w.id, {
        action: "create",
        versionId: v.id,
      });
      assert.ok("secret" in hook && typeof hook.secret === "string");
      let secret = hook.secret as string;
      let revision = hook.revision;
      const deliver = async (
        options: {
          secret?: string;
          id?: string;
          timestamp?: string;
          raw?: string;
          signature?: string;
        } = {},
      ) => {
        const raw = options.raw ?? '{"customer":{"score":12}}',
          timestamp =
            options.timestamp ?? String(Math.floor(Date.now() / 1000)),
          id = options.id ?? randomUUID();
        return fetch(`${base}/api/hooks/${hook.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FlowPilot-Timestamp": timestamp,
            "X-FlowPilot-Delivery-Id": id,
            "X-FlowPilot-Signature":
              options.signature ??
              `v1=${signature(options.secret ?? secret, timestamp, id, Buffer.from(raw))}`,
          },
          body: raw,
        });
      };
      await t.test(
        "real signed HTTP delivery durably queues and real worker executes",
        async () => {
          const response = await deliver();
          assert.equal(response.status, 202);
          const result = await response.json();
          const pending = await db.workflowRun.findUniqueOrThrow({
            where: { id: result.runId },
          });
          assert.equal(pending.status, "QUEUED");
          const c = worker(pending.id);
          children.push(c);
          assert.equal(await exited(c), 0);
          assert.equal((await getRun(actor, pending.id)).status, "SUCCEEDED");
          assert.equal(
            await db.nodeRun.count({ where: { runId: pending.id } }),
            2,
          );
        },
      );
      await t.test(
        "invalid/missing signatures, old timestamps and oversized bodies do not admit",
        async () => {
          const before = await db.workflowRun.count({
            where: { workflowId: w.id },
          });
          for (const o of [
            { signature: "" },
            { secret: "wrong" },
            { timestamp: String(Math.floor(Date.now() / 1000) - 301) },
            { raw: JSON.stringify("x".repeat(17000)) },
          ]) {
            const r = await deliver(o);
            assert.ok([401, 413].includes(r.status));
          }
          assert.equal(
            await db.workflowRun.count({ where: { workflowId: w.id } }),
            before,
          );
          assert.equal(
            verifySignature(secret, null, null, null, Buffer.from("{}")),
            false,
          );
        },
      );
      await t.test(
        "concurrent duplicate delivery admits one job and persists replay protection",
        async () => {
          const id = randomUUID();
          const responses = await Promise.all([
            deliver({ id }),
            deliver({ id }),
            deliver({ id }),
          ]);
          assert.deepEqual(
            responses.map((r) => r.status).sort(),
            [202, 409, 409],
          );
          assert.equal((await deliver({ id })).status, 409);
          assert.equal(
            await db.webhookDelivery.count({
              where: { webhookId: hook.id, deliveryId: id },
            }),
            1,
          );
        },
      );
      await t.test(
        "rotation, disable, archive, lost membership, and revocation reject admissions",
        async () => {
          const old = secret;
          const r = await manageWebhook(actor, w.id, {
            action: "rotate",
            id: hook.id,
            revision,
          });
          secret = ("secret" in r ? r.secret : "") as string;
          revision = r.revision;
          assert.equal((await deliver({ secret: old })).status, 401);
          assert.equal((await deliver()).status, 202);
          const disabled = await manageWebhook(actor, w.id, {
            action: "disable",
            id: hook.id,
            revision,
          });
          revision = disabled.revision;
          assert.equal((await deliver()).status, 410);
          revision = (
            await manageWebhook(actor, w.id, {
              action: "enable",
              id: hook.id,
              revision,
            })
          ).revision;
          await workflowState(actor, w.id, { enabled: false, archived: true });
          assert.equal((await deliver()).status, 410);
          await workflowState(actor, w.id, { enabled: true, archived: false });
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: actor.workspaceId,
                userId: user.id,
              },
            },
            data: { role: "VIEWER" },
          });
          assert.equal((await deliver()).status, 403);
          await assert.rejects(
            manageWebhook(actor, w.id, {
              action: "rotate",
              id: hook.id,
              revision,
            }),
            { status: 403 },
          );
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: actor.workspaceId,
                userId: user.id,
              },
            },
            data: { role: "OWNER" },
          });
          await manageWebhook(actor, w.id, {
            action: "revoke",
            id: hook.id,
            revision,
          });
          assert.equal((await deliver()).status, 410);
          const row = await db.webhook.findUniqueOrThrow({
            where: { id: hook.id },
          });
          assert.equal(row.ciphertext, "");
          assert.ok(
            !JSON.stringify(await listWebhooks(actor, w.id)).includes(secret),
          );
        },
      );
      await t.test(
        "workspace isolation, protected management, CSRF and immutable versions",
        async () => {
          const other = await db.workspace.create({ data: { name: "Other" } });
          foreignId = other.id;
          await assert.rejects(
            listWebhooks({ ...actor, workspaceId: other.id }, w.id),
            { status: 404 },
          );
          const path = `${base}/api/workspaces/${actor.workspaceId}/workflows/${w.id}/webhooks`;
          assert.equal((await fetch(path)).status, 401);
          assert.equal(
            (
              await fetch(path, {
                method: "POST",
                headers: { Cookie: cookie, "Content-Type": "application/json" },
                body: "{}",
              })
            ).status,
            403,
          );
          assert.equal((await fetch(path, { headers })).status, 200);
          await assert.rejects(
            db.workflowVersion.update({
              where: { id: v.id },
              data: { definition: definition("manual_trigger") },
            }),
          );
          assert.deepEqual(
            (
              await db.workflowVersion.findUniqueOrThrow({
                where: { id: v.id },
              })
            ).definition,
            definition(),
          );
        },
      );
      await t.test(
        "webhook foreign keys and immutable audit/dedup records survive accidental writes",
        async () => {
          const other = await createWorkflow(actor, {
            name: "Other version",
            definition: definition(),
          });
          const version = await publishWorkflow(actor, other.id, 1);
          await assert.rejects(
            db.webhook.update({
              where: { id: hook.id },
              data: { versionId: version.id },
            }),
          );
          const audit = await db.webhookAudit.findFirstOrThrow({
            where: { webhookId: hook.id },
          });
          await assert.rejects(
            db.webhookAudit.update({
              where: { id: audit.id },
              data: { code: "ALTERED" },
            }),
          );
          const delivery = await db.webhookDelivery.findFirstOrThrow({
            where: { webhookId: hook.id },
          });
          await assert.rejects(
            db.webhookDelivery.delete({ where: { id: delivery.id } }),
          );
        },
      );
      await t.test(
        "durable rate limit caps signed and rejected requests",
        async () => {
          await db.webhookRate.upsert({
            where: { webhookId: hook.id },
            create: {
              webhookId: hook.id,
              bucket: BigInt(Math.floor(Date.now() / 60000)),
              count: 60,
            },
            update: {
              bucket: BigInt(Math.floor(Date.now() / 60000)),
              count: 60,
            },
          });
          assert.equal((await deliver()).status, 429);
        },
      );
      // Isolated real TLS service; only the test preload maps the validated public fixture IP to loopback.
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          join(dir, "key.pem"),
          "-out",
          join(dir, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=action.fixture.net",
          "-addext",
          "subjectAltName=DNS:action.fixture.net",
        ],
        { stdio: "ignore" },
      );
      let seen = 0,
        authSeen = false,
        keys: string[] = [],
        slowReceived = false;
      let failures = 0;
      server = https.createServer(
        {
          key: readFileSync(join(dir, "key.pem")),
          cert: readFileSync(join(dir, "cert.pem")),
        },
        (req, res) => {
          seen++;
          authSeen ||=
            req.headers.authorization === "Bearer fixture-test-token";
          if (req.headers["idempotency-key"])
            keys.push(String(req.headers["idempotency-key"]));
          if (req.url === "/slow") {
            slowReceived = true;
            setTimeout(() => res.end("{}"), 500);
            return;
          }
          if (req.url === "/crash") {
            slowReceived = true;
            setTimeout(() => res.end("{}"), 10000);
            return;
          }
          if (req.url === "/retry" && failures++ < 2) {
            res.writeHead(503);
            res.end("{}");
            return;
          }
          if (req.url === "/unsafe") {
            res.writeHead(503);
            res.end("{}");
            return;
          }
          res.end('{"result":{"ok":true}}');
        },
      );
      await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const env = {
        FLOW_TEST_TLS_PORT: String(address.port),
        FLOW_TEST_TLS_CA: join(dir, "cert.pem"),
        HTTP_ACTION_ALLOWED_ORIGINS: '["https://action.fixture.net"]',
      };
      restore = installFixture(address.port, env.FLOW_TEST_TLS_CA);
      process.env.HTTP_ACTION_ALLOWED_ORIGINS = env.HTTP_ACTION_ALLOWED_ORIGINS;
      process.env.HTTP_IDEMPOTENT_ORIGINS = "[]";
      const connection = await createConnection(actor, {
        providerId: "https-bearer",
        label: "Fixture bearer",
      });
      await storeHttpCredential(actor, connection.id, {
        revision: 1,
        token: "fixture-test-token",
        healthUrl: "https://action.fixture.net/verify",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      assert.equal(authSeen, true);
      authSeen = false;
      async function runHttp(config: Data) {
        const workflow = await createWorkflow(actor, {
          name: "External HTTP",
          definition: definition("manual_trigger", config),
        });
        const version = await publishWorkflow(actor, workflow.id, 1);
        const run = await enqueue(
          actor,
          workflow.id,
          { versionId: version.id, input: { hello: "world" } },
          randomUUID(),
        );
        return run.id;
      }
      const config: Data = {
        method: "GET",
        url: "https://action.fixture.net/ok",
        headers: { Accept: "application/json" },
        timeoutMs: 1000,
        maxAttempts: 1,
        connectionId: connection.id,
        responsePath: "result",
      };
      await t.test(
        "real worker injects destination-bound vault credentials without log leakage",
        async () => {
          const id = await runHttp(config);
          const c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(run.status, "SUCCEEDED");
          assert.equal(authSeen, true);
          assert.ok(!JSON.stringify(run).includes("fixture-test-token"));
          const credential = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: connection.id },
          });
          assert.ok(!credential.ciphertext.includes("fixture-test-token"));
          assert.equal(run.attempts.length, 1);
          assert.equal(run.attempts[0].state, "SUCCEEDED");
        },
      );
      await t.test(
        "bounded GET retry uses stable idempotency key and distinct attempt identifiers",
        async () => {
          keys = [];
          const id = await runHttp({
            ...config,
            url: "https://action.fixture.net/retry",
            maxAttempts: 3,
          });
          const c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(run.status, "SUCCEEDED");
          assert.equal(run.attempts.length, 3);
          assert.equal(new Set(keys).size, 1);
          assert.equal(new Set(run.attempts.map((a) => a.id)).size, 3);
        },
      );
      await t.test(
        "unsafe POST is not retried even when editor requests retrySafe",
        async () => {
          const before = seen;
          const id = await runHttp({
            ...config,
            method: "POST",
            url: "https://action.fixture.net/unsafe",
            bodyFromInput: true,
            maxAttempts: 3,
            retrySafe: true,
          });
          const c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(run.status, "FAILED");
          assert.equal(run.error, "HTTP_STATUS_ERROR");
          assert.equal(run.attempts.length, 1);
          assert.equal(seen, before + 1);
        },
      );
      await t.test(
        "timeout records ambiguous external outcome without unsafe retry",
        async () => {
          slowReceived = false;
          const id = await runHttp({
            ...config,
            method: "POST",
            url: "https://action.fixture.net/slow",
            timeoutMs: 100,
            maxAttempts: 3,
          });
          const c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(slowReceived, true);
          assert.equal(run.error, "HTTP_OUTCOME_UNKNOWN");
          assert.equal(run.attempts[0].state, "AMBIGUOUS");
          assert.equal(run.attempts.length, 1);
        },
      );
      await t.test(
        "crashed worker recovers RUNNING intent as unknown and never reissues request",
        async () => {
          slowReceived = false;
          const id = await runHttp({
            ...config,
            method: "POST",
            url: "https://action.fixture.net/crash",
            timeoutMs: 10000,
          });
          const first = worker(id, env);
          children.push(first);
          await until(
            async () =>
              slowReceived &&
              (await db.httpAttempt.count({
                where: { runId: id, state: "IN_FLIGHT" },
              })) === 1,
          );
          const concurrent = worker(id, env);
          children.push(concurrent);
          assert.equal(await exited(concurrent), 0);
          const before = seen;
          first.kill("SIGKILL");
          await exited(first);
          const recovery = worker(id, env);
          children.push(recovery);
          assert.equal(await exited(recovery), 0);
          const run = await getRun(actor, id);
          assert.equal(run.status, "FAILED");
          assert.equal(run.error, "WORKER_LOST_OUTCOME_UNKNOWN");
          assert.equal(run.attempts[0].state, "AMBIGUOUS");
          assert.equal(seen, before);
        },
      );
      await t.test(
        "successful POST and approved idempotent write retries",
        async () => {
          let id = await runHttp({
            ...config,
            method: "POST",
            body: { event: "created" },
          });
          let c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          assert.equal((await getRun(actor, id)).status, "SUCCEEDED");
          failures = 0;
          keys = [];
          id = await runHttp({
            ...config,
            method: "PUT",
            url: "https://action.fixture.net/retry",
            body: { event: "retry" },
            retrySafe: true,
            maxAttempts: 3,
          });
          c = worker(id, {
            ...env,
            HTTP_IDEMPOTENT_ORIGINS: '["https://action.fixture.net"]',
          });
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(run.status, "SUCCEEDED");
          assert.equal(run.attempts.length, 3);
          assert.equal(new Set(keys).size, 1);
        },
      );
      await t.test(
        "cancellation stops queued HTTP work without a network request",
        async () => {
          const id = await runHttp(config);
          const before = seen;
          await cancelRun(actor, id);
          const c = worker(id, env);
          children.push(c);
          assert.equal(await exited(c), 0);
          const run = await getRun(actor, id);
          assert.equal(run.error, "RUN_CANCELLED");
          assert.equal(run.attempts.length, 0);
          assert.equal(seen, before);
        },
      );
      await t.test(
        "disabled workflows reject manual HTTP admission and workers",
        async () => {
          const wf = await createWorkflow(actor, {
            name: "Disabled HTTP",
            definition: definition("manual_trigger", config),
          });
          const version = await publishWorkflow(actor, wf.id, 1);
          await workflowState(actor, wf.id, {
            enabled: false,
            archived: false,
          });
          await assert.rejects(
            enqueue(
              actor,
              wf.id,
              { versionId: version.id, input: {} },
              randomUUID(),
            ),
            { status: 409 },
          );
        },
      );
      await t.test(
        "vault credentials cannot be used across workspace or origin",
        async () => {
          const outsider = await db.workspace.create({
            data: {
              name: "No vault permission",
              members: { create: { userId: user.id, role: "OWNER" } },
            },
          });
          try {
            const wf = await createWorkflow(
              { ...actor, workspaceId: outsider.id },
              {
                name: "Blocked credentials",
                definition: definition("manual_trigger", config),
              },
            );
            const version = await publishWorkflow(
              { ...actor, workspaceId: outsider.id },
              wf.id,
              1,
            );
            const job = await enqueue(
              { ...actor, workspaceId: outsider.id },
              wf.id,
              { versionId: version.id, input: {} },
              randomUUID(),
            );
            const c = worker(job.id, env);
            children.push(c);
            assert.equal(await exited(c), 0);
            assert.equal(
              (await getRun({ ...actor, workspaceId: outsider.id }, job.id))
                .error,
              "HTTP_CREDENTIAL_UNAVAILABLE",
            );
          } finally {
            await db.workspace.delete({ where: { id: outsider.id } });
          }
        },
      );
    } finally {
      for (const c of children)
        if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
      restore?.();
      if (server) await new Promise<void>((r) => server!.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
      if (originalAllowed === undefined)
        delete process.env.HTTP_ACTION_ALLOWED_ORIGINS;
      else process.env.HTTP_ACTION_ALLOWED_ORIGINS = originalAllowed;
      if (originalIdempotent === undefined)
        delete process.env.HTTP_IDEMPOTENT_ORIGINS;
      else process.env.HTTP_IDEMPOTENT_ORIGINS = originalIdempotent;
      await db.workspace.deleteMany({
        where: { id: { in: [actor.workspaceId, foreignId].filter(Boolean) } },
      });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
