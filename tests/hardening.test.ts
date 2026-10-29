import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { runtimeIssues, boundedInteger } from "../src/lib/security/runtime";
import { csp } from "../src/lib/security/headers";
import { logRecord } from "../src/lib/operations/log";
import {
  operationsAuthorized,
  operationsMetrics,
} from "../src/lib/operations/health";
import { apiRate } from "../src/lib/security/rate";
import { EngineError } from "../src/lib/engine/definition";
import {
  createWorkflow,
  publishWorkflow,
  enqueue,
  getRun,
} from "../src/lib/engine/service";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const hasCode = (code: string) => (e: unknown) =>
  e instanceof EngineError && e.code === code;
function worker(run: string, id = randomUUID()) {
  return spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", run],
    {
      env: {
        ...process.env,
        FLOWPILOT_WORKER_ID: id,
        WORKER_HEALTH_FILE: `/tmp/flow-worker-${id}.json`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
function exit(p: ChildProcess) {
  return new Promise<number | null>((r, j) => {
    p.once("exit", r);
    p.once("error", j);
  });
}
test("production controls and metadata-only observability", async (t) => {
  await t.test(
    "valid disabled-integration production config; insecure origins/TLS/test activation fail closed",
    () => {
      const env = {
        FLOWPILOT_ENV: "production",
        BETTER_AUTH_URL: "https://app.example.test",
        BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
        DATABASE_URL:
          "postgresql://app:synthetic@db:5432/flow?sslmode=verify-full",
        OPERATIONS_TOKEN: randomBytes(48).toString("base64url"),
        INTEGRATION_ACTIVE_KEY_ID: "v1",
        INTEGRATION_ENCRYPTION_KEYS: JSON.stringify({
          v1: randomBytes(32).toString("base64"),
        }),
      };
      assert.deepEqual(runtimeIssues(env), []);
      assert.ok(
        runtimeIssues({
          ...env,
          BETTER_AUTH_URL: "http://app.example.test",
        }).includes("PUBLIC_ORIGIN_INVALID"),
      );
      assert.ok(
        runtimeIssues({
          ...env,
          DATABASE_URL: "postgresql://app:test@db/flow",
        }).includes("DATABASE_TLS_REQUIRED"),
      );
      assert.ok(
        runtimeIssues({
          ...env,
          INTEGRATION_TEST_ADAPTER_ENABLED: "true",
        }).includes("TEST_CONFIGURATION_FORBIDDEN"),
      );
      assert.ok(
        runtimeIssues({ ...env, PAYSTACK_TEST_ENABLED: "true" }).includes(
          "UNVERIFIED_EXTERNAL_ACTIVATION_FORBIDDEN",
        ),
      );
      assert.ok(
        runtimeIssues({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" }).includes(
          "TLS_VERIFICATION_DISABLED",
        ),
      );
      assert.ok(
        runtimeIssues({ ...env, AUTH_REGISTRATION_ENABLED: "true" }).includes(
          "PUBLIC_REGISTRATION_NOT_READY",
        ),
      );
    },
  );
  await t.test(
    "CSP production scripts use per-request nonces, without unsafe eval or inline script fallback",
    () => {
      const a = csp(randomBytes(24).toString("base64"));
      assert.ok(a.includes("'strict-dynamic'"));
      assert.ok(!a.includes("'unsafe-eval'"));
      assert.ok(!a.match(/script-src[^;]*unsafe-inline/));
      assert.ok(a.includes("frame-ancestors 'none'"));
      assert.ok(a.includes("style-src 'self' 'unsafe-inline'"));
      assert.throws(() => csp("bad\nvalue"));
    },
  );
  await t.test(
    "structured log allowlist drops errors, credentials, arbitrary paths and personal values",
    () => {
      const runId = randomUUID(),
        record = logRecord("API_RESPONSE", {
          runId,
          requestId: randomUUID(),
          status: 500,
          code: "DATABASE_UNAVAILABLE",
          route: "workspace",
          message: "sk-sensitive-auth-token",
          email: "private@example.test",
          url: "https://private/path?code=secret",
          headers: { Authorization: "Bearer secret" },
          token: "secret",
          exception: Error("secret"),
        });
      const text = JSON.stringify(record);
      assert.ok(!text.includes("sensitive"));
      assert.ok(!text.includes("private@example"));
      assert.ok(!text.includes("Bearer"));
      assert.ok(
        !JSON.stringify(
          logRecord("API_RESPONSE", {
            route: "https://secret-path",
            code: "sk_test_secret",
          }),
        ).includes("secret"),
      );
      assert.equal(record.runId, runId);
    },
  );
  await t.test(
    "operator metrics require a dedicated token, never a workspace owner session",
    () => {
      const old = process.env.OPERATIONS_TOKEN;
      process.env.OPERATIONS_TOKEN = randomBytes(48).toString("base64url");
      assert.equal(operationsAuthorized(new Request(base)), false);
      assert.equal(
        operationsAuthorized(
          new Request(base, { headers: { Authorization: "Bearer wrong" } }),
        ),
        false,
      );
      assert.equal(
        operationsAuthorized(
          new Request(base, {
            headers: {
              Authorization: "Bearer " + process.env.OPERATIONS_TOKEN,
            },
          }),
        ),
        true,
      );
      if (old === undefined) delete process.env.OPERATIONS_TOKEN;
      else process.env.OPERATIONS_TOKEN = old;
    },
  );
  await t.test(
    "database pool bounds reject invalid and oversized configuration",
    () => {
      const old = process.env.DB_POOL_MAX;
      for (const value of ["0", "999", "abc"]) {
        process.env.DB_POOL_MAX = value;
        assert.throws(() => boundedInteger("DB_POOL_MAX", 5, 1, 32));
      }
      if (old === undefined) delete process.env.DB_POOL_MAX;
      else process.env.DB_POOL_MAX = old;
    },
  );
});
test("session, tenant and worker reauthorization hardening", async (t) => {
  const ids: string[] = [randomUUID(), randomUUID()],
    spaces = [randomUUID(), randomUUID()],
    password = "Hardening-" + randomUUID() + "!";
  for (const [i, id] of ids.entries()) {
    const user = await auth.api.signUpEmail({
      body: {
        name: "Hardening test",
        email: `hardening-${id}@example.test`,
        password,
      },
    });
    ids[i] = user.user.id;
    await db.workspace.create({
      data: {
        id: spaces[i],
        name: "Hardening private",
        members: { create: { userId: user.user.id, role: "OWNER" } },
      },
    });
  }
  const actor = { workspaceId: spaces[0], userId: ids[0] },
    other = { workspaceId: spaces[1], userId: ids[1] };
  async function cookie(index = 0) {
    const r = await auth.api.signInEmail({
      body: {
        email: `hardening-${index === 0 ? firstEmail : secondEmail}@example.test`,
        password,
      },
      asResponse: true,
    });
    return r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  const firstEmail = (
      await db.user.findUniqueOrThrow({ where: { id: ids[0] } })
    ).email
      .replace("hardening-", "")
      .replace("@example.test", ""),
    secondEmail = (
      await db.user.findUniqueOrThrow({ where: { id: ids[1] } })
    ).email
      .replace("hardening-", "")
      .replace("@example.test", "");
  async function job() {
    const w = await createWorkflow(actor, {
        name: "Security fixture",
        definition: {
          schemaVersion: 1,
          nodes: [{ id: "start", type: "manual_trigger", config: {} }],
          edges: [],
        },
      }),
      v = await publishWorkflow(actor, w.id, 1);
    return {
      w,
      v,
      ...(await enqueue(
        actor,
        w.id,
        {
          versionId: v.id,
          input: { privateMarker: "do-not-log-customer-secret" },
        },
        randomUUID(),
      )),
    };
  }
  try {
    await t.test(
      "foreign session cannot read workspace, workflow run, AI/billing or integration metadata",
      async () => {
        const r = await job(),
          foreign = await cookie(1);
        for (const path of [
          "",
          `/runs/${r.id}`,
          "/billing/overview",
          "/ai/overview",
          "/whatsapp/overview",
          "/integrations",
        ]) {
          const response = await fetch(
            base + `/api/workspaces/${actor.workspaceId}` + path,
            { headers: { Cookie: foreign } },
          );
          assert.equal(response.status, 404, path);
        }
        await assert.rejects(getRun(other, r.id), hasCode("NOT_FOUND"));
      },
    );
    await t.test(
      "session expiry is enforced from PostgreSQL, with no stale cookie authorization",
      async () => {
        const c = await cookie();
        await db.session.updateMany({
          where: { userId: ids[0] },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        assert.equal(
          (
            await fetch(base + `/api/workspaces/${actor.workspaceId}`, {
              headers: { Cookie: c },
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "auth CSRF rejects cross-site and missing-origin writes; legitimate bodyless logout revokes the session",
      async () => {
        const c = await cookie(),
          before = await db.session.count({ where: { userId: ids[0] } });
        for (const origin of ["https://evil.example", null]) {
          const response = await fetch(base + "/api/auth/sign-out", {
            method: "POST",
            headers: { Cookie: c, ...(origin ? { Origin: origin } : {}) },
          });
          assert.equal(response.status, 403);
        }
        assert.equal(
          await db.session.count({ where: { userId: ids[0] } }),
          before,
        );
        const response = await fetch(base + "/api/auth/sign-out", {
          method: "POST",
          headers: { Cookie: c, Origin: base },
        });
        assert.equal(response.status, 200);
        assert.equal(
          (
            await fetch(base + `/api/workspaces/${actor.workspaceId}`, {
              headers: { Cookie: c },
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "durable authenticated API limiter is atomic under concurrent attempts",
      async () => {
        const old = process.env.API_USER_RATE_PER_MINUTE;
        process.env.API_USER_RATE_PER_MINUTE = "30";
        const subject = randomUUID(),
          r = await Promise.allSettled(
            Array.from({ length: 31 }, () => apiRate(subject)),
          );
        assert.equal(r.filter((x) => x.status === "fulfilled").length, 30);
        assert.ok(
          r.some(
            (x) =>
              x.status === "rejected" && hasCode("API_RATE_LIMIT")(x.reason),
          ),
        );
        if (old === undefined) delete process.env.API_USER_RATE_PER_MINUTE;
        else process.env.API_USER_RATE_PER_MINUTE = old;
      },
    );
    await t.test(
      "pure worker refuses membership revoked after queue admission",
      async () => {
        const r = await job();
        await db.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: actor.workspaceId,
              userId: actor.userId,
            },
          },
          data: { role: "VIEWER" },
        });
        assert.equal(await exit(worker(r.id)), 0);
        assert.equal(
          (await db.workflowRun.findUniqueOrThrow({ where: { id: r.id } }))
            .error,
          "RUN_AUTHORIZATION_REVOKED",
        );
        await db.workspaceMember.update({
          where: {
            workspaceId_userId: {
              workspaceId: actor.workspaceId,
              userId: actor.userId,
            },
          },
          data: { role: "OWNER" },
        });
      },
    );
    await t.test(
      "pure worker refuses a disabled workflow without producing fake node successes",
      async () => {
        const r = await job();
        await db.workflow.update({
          where: { id: r.w.id },
          data: { enabled: false },
        });
        assert.equal(await exit(worker(r.id)), 0);
        const run = await getRun(actor, r.id);
        assert.equal(run.status, "FAILED");
        assert.equal(run.nodes.length, 0);
      },
    );
    await t.test(
      "terminating only the dedicated worker database session rolls back its claim, then restart recovers once",
      async () => {
        const r = await job(),
          blocker = new pg.Client({
            connectionString: process.env.DATABASE_URL,
          }),
          wid = randomUUID();
        await blocker.connect();
        await blocker.query("BEGIN");
        await blocker.query(
          'SELECT id FROM "WorkspaceMember" WHERE "workspaceId"=$1 AND "userId"=$2 FOR UPDATE',
          [actor.workspaceId, actor.userId],
        );
        const child = worker(r.id, wid);
        let output = "";
        child.stdout?.on("data", (c) => {
          output += c.toString();
        });
        const done = exit(child);
        try {
          for (let i = 0; i < 200 && !output.includes(`CLAIMED ${r.id}`); i++)
            await sleep(25);
          assert.ok(output.includes(`CLAIMED ${r.id}`));
          let pid: number | undefined;
          for (let i = 0; i < 100 && !pid; i++) {
            const found = await blocker.query(
              "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type=$2",
              [`flowpilot-worker:${wid}`, "Lock"],
            );
            pid = found.rows[0]?.pid;
            if (!pid) await sleep(25);
          }
          assert.ok(pid);
          assert.equal(
            (
              await blocker.query(
                "SELECT pg_terminate_backend($1) AS terminated",
                [pid],
              )
            ).rows[0].terminated,
            true,
          );
          await blocker.query("ROLLBACK");
          assert.equal(await done, 1);
          assert.equal(
            (await db.workflowRun.findUniqueOrThrow({ where: { id: r.id } }))
              .status,
            "QUEUED",
          );
          assert.ok(!output.includes("do-not-log-customer-secret"));
          assert.equal(await exit(worker(r.id)), 0);
          const recovered = await getRun(actor, r.id);
          assert.equal(recovered.status, "SUCCEEDED");
          assert.equal(recovered.nodes.length, 1);
        } finally {
          child.kill("SIGTERM");
          await blocker.query("ROLLBACK").catch(() => {});
          await blocker.end();
        }
      },
    );
    await t.test(
      "health and metrics expose aggregate state without credential or workspace payloads",
      async () => {
        assert.equal((await fetch(base + "/api/health/live")).status, 200);
        assert.equal((await fetch(base + "/api/health/ready")).status, 200);
        assert.equal(
          (await fetch(base + "/api/operations/metrics")).status,
          401,
        );
        const m = JSON.stringify(await operationsMetrics());
        assert.ok(!m.includes("do-not-log-customer-secret"));
        assert.ok(!m.includes("ciphertext"));
        assert.ok(!m.includes("accessToken"));
        assert.ok(
          (await db.workerHeartbeat.count({ where: { status: "STOPPED" } })) >
            0,
        );
      },
    );
  } finally {
    await db.workspace.deleteMany({ where: { id: { in: spaces } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
