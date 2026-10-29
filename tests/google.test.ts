import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import {
  createConnection,
  getConnection,
  operate,
} from "../src/lib/integrations/service";
import {
  beginGoogle,
  completeGoogle,
  credentialForGoogle,
  googleManagement,
} from "../src/lib/google/service";
import { googleConfig, googleScopes } from "../src/lib/google/config";
import { googleSettings } from "../src/lib/google/provider";
import { composeEmail } from "../src/lib/google/execute";
import {
  createWorkflow,
  publishWorkflow,
  enqueue,
  getRun,
} from "../src/lib/engine/service";
import type { Data, NodeType } from "../src/lib/engine/definition";
import { googleFixture } from "./google-fixture";
import { installGoogleFixture } from "./google-fixture-preload.mjs";
async function exit(child: ChildProcess) {
  return new Promise<number | null>((r, j) => {
    child.on("exit", r);
    child.on("error", j);
  });
}
test(
  "Google OAuth, vault and real provider-node worker integration",
  { timeout: 120000 },
  async (t) => {
    const fixture = await googleFixture(),
      original = { ...process.env };
    Object.assign(process.env, fixture.env);
    const restore = installGoogleFixture(fixture.port, fixture.ca);
    const user = (
      await auth.api.signUpEmail({
        body: {
          name: "Google test",
          email: `google-${randomUUID()}@example.test`,
          password: `Secure-${randomUUID()}!`,
        },
      })
    ).user;
    const actor = {
      userId: user.id,
      workspaceId: (await ensurePersonalWorkspace(user.id, user.name))
        .workspaceId,
    };
    const children: ChildProcess[] = [];
    const other = await db.workspace.create({
      data: {
        name: "Other Google workspace",
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    async function connect(
      provider: "gmail" | "google-sheets",
      bad?: "identity" | "scopes",
    ) {
      const row = await createConnection(actor, {
        providerId: provider,
        label: `Controlled ${provider}`,
      });
      const start = await beginGoogle(actor, row.id, row.revision),
        url = new URL(start.authorizationUrl),
        code = randomUUID();
      fixture.codes.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        provider,
        badIdentity: bad === "identity",
        badScopes: bad === "scopes",
      });
      return { row, url, code };
    }
    let sheets = "",
      gmail = "";
    try {
      await t.test(
        "workspace state, PKCE, offline consent and single-use callback",
        async () => {
          const p = await connect("google-sheets");
          sheets = p.row.id;
          assert.equal(p.url.origin, "https://accounts.google.com");
          assert.equal(p.url.searchParams.get("code_challenge_method"), "S256");
          assert.equal(p.url.searchParams.get("access_type"), "offline");
          assert.equal(
            p.url.searchParams.get("include_granted_scopes"),
            "false",
          );
          assert.deepEqual(
            p.url.searchParams.get("scope")!.split(" ").sort(),
            [...googleScopes["google-sheets"]].sort(),
          );
          const state = p.url.searchParams.get("state")!;
          await assert.rejects(
            completeGoogle(
              user.id,
              state,
              p.code,
              "http://evil.invalid/callback",
            ),
          );
          await completeGoogle(
            user.id,
            state,
            p.code,
            googleSettings().redirect,
          );
          await assert.rejects(
            completeGoogle(user.id, state, p.code, googleSettings().redirect),
            { code: "GOOGLE_STATE_INVALID" },
          );
          const row = await getConnection(actor, sheets);
          assert.equal(row.status, "CONNECTED");
          assert.equal(row.accountEmail, "authorized@example.test");
          const secret = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: sheets },
          });
          assert.ok(
            !secret.ciphertext.includes("fixture-google-sheets-access"),
          );
          assert.ok(!JSON.stringify(row).includes("accessToken"));
        },
      );
      await t.test(
        "invalid issuer, nonce, scope, PKCE, expired state, and concurrent callbacks fail safely",
        async () => {
          const otherActor = { ...actor, workspaceId: other.id };
          for (const invalid of [
            "identity",
            "nonce",
            "scopes",
            "pkce",
            "expired",
            "concurrent",
          ]) {
            const row = await createConnection(otherActor, {
              providerId: "gmail",
              label: "Invalid callback fixture",
            });
            const start = await beginGoogle(otherActor, row.id, row.revision),
              url = new URL(start.authorizationUrl),
              code = randomUUID(),
              state = url.searchParams.get("state")!;
            fixture.codes.set(code, {
              provider: "gmail",
              nonce:
                invalid === "nonce" ? "wrong" : url.searchParams.get("nonce")!,
              challenge:
                invalid === "pkce"
                  ? "wrong"
                  : url.searchParams.get("code_challenge")!,
              badIdentity: invalid === "identity",
              badScopes: invalid === "scopes",
            });
            if (invalid === "expired")
              await db.googleOAuthAttempt.updateMany({
                where: { integrationId: row.id },
                data: { expiresAt: new Date(0) },
              });
            if (invalid === "concurrent") {
              const results = await Promise.allSettled([
                completeGoogle(user.id, state, code, googleSettings().redirect),
                completeGoogle(user.id, state, code, googleSettings().redirect),
              ]);
              assert.equal(
                results.filter((r) => r.status === "fulfilled").length,
                1,
              );
            } else {
              await assert.rejects(
                completeGoogle(user.id, state, code, googleSettings().redirect),
              );
              assert.notEqual(
                (await getConnection(otherActor, row.id)).status,
                "CONNECTED",
              );
            }
            const current = await getConnection(otherActor, row.id);
            await operate(otherActor, row.id, current.revision, "delete");
          }
        },
      );
      await t.test(
        "Gmail is a separate send-only grant with verified identity",
        async () => {
          const p = await connect("gmail");
          gmail = p.row.id;
          assert.ok(!p.url.searchParams.get("scope")!.includes("readonly"));
          await completeGoogle(
            user.id,
            p.url.searchParams.get("state")!,
            p.code,
            googleSettings().redirect,
          );
          assert.equal(
            (await getConnection(actor, gmail)).accountSubject,
            "fixture-google-subject",
          );
        },
      );
      await t.test(
        "concurrent expiry refresh is serialized and refresh-token rotation persists",
        async () => {
          const credential = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: sheets },
          });
          const { readCredential, saveCredential } =
            await import("../src/lib/integrations/service");
          await db.$transaction(async (tx) => {
            const row = await tx.workspaceIntegration.findUniqueOrThrow({
              where: { id: sheets },
              include: { credential: true, provider: true },
            });
            const token = readCredential(row);
            token.expiresAt = new Date(Date.now() + 2000).toISOString();
            await saveCredential(tx, row, token);
          });
          const before = fixture.counters.refreshes;
          const tokens = await Promise.all([
            credentialForGoogle(actor, sheets, "google-sheets"),
            credentialForGoogle(actor, sheets, "google-sheets"),
          ]);
          assert.equal(fixture.counters.refreshes, before + 1);
          assert.equal(tokens[0].refreshToken, "fixture-google-sheets-rotated");
          assert.equal(tokens[1].refreshToken, tokens[0].refreshToken);
          assert.ok(
            (
              await db.integrationCredential.findUniqueOrThrow({
                where: { integrationId: sheets },
              })
            ).generation > credential.generation,
          );
        },
      );
      await t.test(
        "tenant and role denial never decrypt or refresh another workspace connection",
        async () => {
          await assert.rejects(
            credentialForGoogle(
              { ...actor, workspaceId: other.id },
              sheets,
              "google-sheets",
            ),
          );
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: actor.workspaceId,
                userId: actor.userId,
              },
            },
            data: { role: "VIEWER" },
          });
          try {
            await assert.rejects(
              credentialForGoogle(actor, sheets, "google-sheets"),
              { status: 403 },
            );
            await assert.rejects(
              beginGoogle(
                actor,
                gmail,
                (await getConnection(actor, gmail)).revision,
              ),
              { status: 403 },
            );
          } finally {
            await db.workspaceMember.update({
              where: {
                workspaceId_userId: {
                  workspaceId: actor.workspaceId,
                  userId: actor.userId,
                },
              },
              data: { role: "OWNER" },
            });
          }
        },
      );
      await t.test(
        "configuration and MIME encoding reject unsafe recipients, headers, ranges and fields",
        async () => {
          const c: Data = {
            connectionId: gmail,
            to: ["recipient@example.test"],
            subject: "Hello ✓",
            body: "Plain text",
            mappings: { body: "message" },
          };
          googleConfig("gmail_send_email", c);
          const raw = await composeEmail(
            c,
            { message: "Hello <script>text only</script>" },
            "authorized@example.test",
            "stable-test",
          );
          const text = Buffer.from(raw, "base64url").toString();
          assert.match(text, /From: authorized@example.test/);
          assert.match(text, /To: recipient@example.test/);
          assert.match(text, /Content-Type: text\/plain/);
          assert.ok(!text.includes("Content-Type: text/html"));
          for (const change of [
            { to: ["a@example.test\r\nBcc: victim@example.test"] },
            { subject: "x\nBcc:x" },
            { to: Array(11).fill("x@example.test") },
            { html: "<script>x</script>" },
          ])
            assert.throws(() =>
              googleConfig(
                "gmail_send_email",
                JSON.parse(JSON.stringify({ ...c, ...change })),
              ),
            );
          for (const range of [
            "A1",
            "Sheet1!A0",
            "Sheet1!A1:Z1000",
            "Sheet1!A2:A1",
          ])
            assert.throws(() =>
              googleConfig("google_sheets_read_rows", {
                connectionId: sheets,
                spreadsheetId: "fixture-sheet-id",
                range,
              }),
            );
        },
      );
      async function run(type: NodeType, config: Data) {
        const wf = await createWorkflow(actor, {
          name: `Google ${type}`,
          definition: {
            schemaVersion: 1,
            nodes: [
              { id: "start", type: "manual_trigger", config: {} },
              { id: "operation", type, config },
            ],
            edges: [{ from: "start", to: "operation" }],
          },
        });
        const version = await publishWorkflow(actor, wf.id, 1);
        const job = await enqueue(
          actor,
          wf.id,
          {
            versionId: version.id,
            input: { message: "A mapped body", value: 42 },
          },
          randomUUID(),
        );
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--import",
            "./tests/google-fixture-preload.mjs",
            "scripts/worker.ts",
            "--once",
            "--run-id",
            job.id,
          ],
          { env: { ...process.env }, stdio: "ignore" },
        );
        children.push(child);
        assert.equal(await exit(child), 0);
        return getRun(actor, job.id);
      }
      await t.test(
        "real worker reads, appends, and updates through pinned Google REST",
        async () => {
          for (const type of [
            "google_sheets_read_rows",
            "google_sheets_append_row",
            "google_sheets_update_row",
          ] as const) {
            const config: Data = {
              connectionId: sheets,
              spreadsheetId: "fixture-sheet-id",
              range:
                type === "google_sheets_read_rows"
                  ? "Sheet1!A1:B2"
                  : "Sheet1!A1:B1",
              ...(type === "google_sheets_read_rows"
                ? {}
                : { values: ["literal", 0], valuePaths: [null, "value"] }),
            };
            const result = await run(type, config);
            assert.equal(result.status, "SUCCEEDED", result.error ?? "");
            assert.equal(result.attempts.length, 1);
            assert.ok(!JSON.stringify(result).includes("Ada"));
          }
          assert.equal(fixture.counters.writes, 2);
        },
      );
      const mail: Data = {
        connectionId: gmail,
        to: ["recipient@example.test"],
        subject: "Controlled fixture only",
        body: "Hello",
        mappings: { body: "message" },
      };
      await t.test(
        "real worker sends MIME from verified account without storing message content",
        async () => {
          const result = await run("gmail_send_email", mail);
          assert.equal(result.status, "SUCCEEDED", result.error ?? "");
          assert.equal(fixture.counters.sends, 1);
          assert.ok(!JSON.stringify(result).includes("A mapped body"));
          assert.match(
            Buffer.from(fixture.messages[0], "base64url").toString(),
            /authorized@example.test/,
          );
        },
      );
      await t.test(
        "a rejected access token expires the connection and the next run refreshes it",
        async () => {
          fixture.failure = 401;
          const config = {
            connectionId: sheets,
            spreadsheetId: "fixture-sheet-id",
            range: "Sheet1!A1:B2",
          };
          const rejected = await run("google_sheets_read_rows", config);
          assert.equal(rejected.error, "GOOGLE_REAUTHORIZE");
          assert.equal((await getConnection(actor, sheets)).status, "EXPIRED");
          fixture.failure = 0;
          const before = fixture.counters.refreshes;
          assert.equal(
            (await run("google_sheets_read_rows", config)).status,
            "SUCCEEDED",
          );
          assert.equal(fixture.counters.refreshes, before + 1);
        },
      );
      await t.test(
        "quota errors retry reads only; sends and writes never automatically duplicate",
        async () => {
          fixture.failure = 429;
          const before = fixture.counters;
          const r = await run("google_sheets_read_rows", {
            connectionId: sheets,
            spreadsheetId: "fixture-sheet-id",
            range: "Sheet1!A1:A2",
          });
          assert.equal(r.attempts.length, 3);
          assert.equal(r.error, "GOOGLE_QUOTA_LIMIT");
          const sent = await run("gmail_send_email", mail);
          assert.equal(sent.attempts.length, 1);
          assert.equal(fixture.counters.sends, before.sends + 1);
          fixture.failure = 0;
        },
      );
      await t.test(
        "crashed send is recovered as ambiguous without another email",
        async () => {
          fixture.delayMs = 10000;
          const wf = await createWorkflow(actor, {
            name: "Uncertain Google send",
            definition: {
              schemaVersion: 1,
              nodes: [
                { id: "start", type: "manual_trigger", config: {} },
                { id: "mail", type: "gmail_send_email", config: mail },
              ],
              edges: [{ from: "start", to: "mail" }],
            },
          });
          const version = await publishWorkflow(actor, wf.id, 1);
          const job = await enqueue(
            actor,
            wf.id,
            {
              versionId: version.id,
              input: { message: "Controlled uncertain send" },
            },
            randomUUID(),
          );
          const before = fixture.counters.sends;
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "--import",
              "./tests/google-fixture-preload.mjs",
              "scripts/worker.ts",
              "--once",
              "--run-id",
              job.id,
            ],
            { env: { ...process.env }, stdio: "ignore" },
          );
          children.push(child);
          for (let i = 0; i < 100 && fixture.counters.sends === before; i++)
            await sleep(50);
          assert.equal(fixture.counters.sends, before + 1);
          child.kill("SIGKILL");
          await exit(child);
          fixture.delayMs = 0;
          const recovery = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/worker.ts",
              "--once",
              "--run-id",
              job.id,
            ],
            { stdio: "ignore" },
          );
          children.push(recovery);
          assert.equal(await exit(recovery), 0);
          const result = await getRun(actor, job.id);
          assert.equal(result.error, "WORKER_LOST_OUTCOME_UNKNOWN");
          assert.equal(fixture.counters.sends, before + 1);
        },
      );
      await t.test(
        "Gmail sending requires explicit enablement, recipient approval, and an hourly allowance",
        async () => {
          const before = fixture.counters.sends;
          process.env.GOOGLE_GMAIL_SEND_ENABLED = "false";
          try {
            assert.equal(
              (await run("gmail_send_email", mail)).error,
              "GOOGLE_SEND_DISABLED",
            );
          } finally {
            process.env.GOOGLE_GMAIL_SEND_ENABLED = "true";
          }
          assert.equal(
            (
              await run("gmail_send_email", {
                ...mail,
                to: ["unapproved@example.test"],
              })
            ).error,
            "GOOGLE_RECIPIENT_DENIED",
          );
          const key = `flowpilot:google:${actor.workspaceId}:gmail`;
          await db.rateLimit.update({
            where: { key },
            data: { count: 20, lastRequest: BigInt(Date.now()) },
          });
          try {
            assert.equal(
              (await run("gmail_send_email", mail)).error,
              "GOOGLE_RATE_LIMIT",
            );
          } finally {
            await db.rateLimit.delete({ where: { key } });
          }
          assert.equal(fixture.counters.sends, before);
        },
      );
      await t.test(
        "revocation while refresh is in flight cannot resurrect credentials",
        async () => {
          const otherActor = { ...actor, workspaceId: other.id },
            row = await createConnection(otherActor, {
              providerId: "google-sheets",
              label: "Refresh race",
            }),
            start = await beginGoogle(otherActor, row.id, row.revision),
            url = new URL(start.authorizationUrl),
            code = randomUUID();
          fixture.codes.set(code, {
            provider: "google-sheets",
            nonce: url.searchParams.get("nonce")!,
            challenge: url.searchParams.get("code_challenge")!,
          });
          await completeGoogle(
            user.id,
            url.searchParams.get("state")!,
            code,
            googleSettings().redirect,
          );
          fixture.refreshDelayMs = 250;
          const before = fixture.counters.refreshes;
          const pending = credentialForGoogle(
            otherActor,
            row.id,
            "google-sheets",
            { force: true },
          ).then(
            () => null,
            (e) => e,
          );
          for (let i = 0; i < 100 && fixture.counters.refreshes === before; i++)
            await sleep(10);
          const current = await getConnection(otherActor, row.id);
          await operate(otherActor, row.id, current.revision, "revoke");
          assert.ok(await pending);
          fixture.refreshDelayMs = 50;
          assert.equal(
            (await getConnection(otherActor, row.id)).status,
            "REVOKED",
          );
          assert.equal(
            (
              await db.integrationCredential.findUniqueOrThrow({
                where: { integrationId: row.id },
              })
            ).ciphertext,
            "",
          );
        },
      );
      await t.test(
        "expired or revoked refresh authorization fails closed and disconnect clears tokens",
        async () => {
          fixture.invalidRefresh = true;
          await assert.rejects(
            credentialForGoogle(actor, sheets, "google-sheets", {
              force: true,
            }),
            { code: "GOOGLE_REAUTHORIZE" },
          );
          assert.equal((await getConnection(actor, sheets)).status, "EXPIRED");
          fixture.invalidRefresh = false;
          const current = await getConnection(actor, gmail);
          const r = await googleManagement(
            actor,
            gmail,
            current.revision,
            "disconnect",
          );
          assert.equal(r.status, "REVOKED");
          assert.equal(
            "remoteRevocation" in r ? r.remoteRevocation : undefined,
            "CONFIRMED",
          );
          assert.equal(
            (
              await db.integrationCredential.findUniqueOrThrow({
                where: { integrationId: gmail },
              })
            ).ciphertext,
            "",
          );
          await assert.rejects(credentialForGoogle(actor, gmail, "gmail"));
        },
      );
    } finally {
      for (const c of children)
        if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
      restore();
      await fixture.close();
      for (const k of Object.keys(fixture.env)) {
        if (original[k] === undefined) delete process.env[k];
        else process.env[k] = original[k];
      }
      await db.workspace.deleteMany({
        where: { id: { in: [actor.workspaceId, other.id] } },
      });
      await db.user.delete({ where: { id: user.id } });
      await db.$disconnect();
    }
  },
);
