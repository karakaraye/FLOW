import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { backup } from "../scripts/operations/backup.mjs";
import { restore, validateRestore } from "../scripts/operations/restore.mjs";
import { pgTool } from "../scripts/operations/pg-tools.mjs";
import { encryptSecret, decryptSecret } from "../src/lib/integrations/crypto";
import { seal } from "../src/lib/engine/payload";
test("encrypted PostgreSQL backup restores only disposable data into a separate empty database and recovers a queued job", async () => {
  if (process.env.FLOWPILOT_ENV === "production")
    throw Error("Recovery test refuses production");
  const dev = new URL(process.env.DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(dev.hostname),
    "Recovery test requires explicitly local development DB",
  );
  const suffix = randomBytes(8).toString("hex"),
    source = `flowpilot_restore_source_${suffix}`,
    target = `flowpilot_restore_target_${suffix}`,
    sourceURL = new URL(dev),
    targetURL = new URL(dev),
    adminURL = new URL(dev);
  sourceURL.pathname = "/" + source;
  targetURL.pathname = "/" + target;
  adminURL.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminURL.href }),
    oldContainer = process.env.PG_TOOL_CONTAINER,
    oldSecret = process.env.BETTER_AUTH_SECRET;
  process.env.PG_TOOL_CONTAINER =
    process.env.RECOVERY_TEST_CONTAINER ?? "flow-db-1";
  const dir = await mkdtemp(join(tmpdir(), "flow-recovery-")),
    archive = join(dir, "source.backup.enc"),
    key = randomBytes(32).toString("base64"),
    keyId = "restore-test",
    authSecret = randomBytes(48).toString("base64url");
  const id = randomUUID(),
    workspace = randomUUID(),
    workflow = randomUUID(),
    version = randomUUID(),
    run = randomUUID(),
    integration = randomUUID(),
    credential = randomUUID();
  const ring = {
      active: keyId,
      keys: new Map([[keyId, Buffer.from(key, "base64")]]),
    },
    context = {
      workspaceId: workspace,
      integrationId: integration,
      providerId: "https-bearer",
      recordId: credential,
      purpose: "credential" as const,
    },
    plain = {
      accessToken: "disposable-recovery-secret-not-a-real-token",
      refreshToken: "",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      scopes: [],
    },
    encrypted = encryptSecret(plain, context, ring);
  const q = (v: string) => "'" + v.replaceAll("'", "''") + "'";
  let restored: pg.Client | undefined, src: pg.Client | undefined;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${source}"`);
    await admin.query(`CREATE DATABASE "${target}"`);
    // Schema only: no development customer data, tokens, or sessions are copied.
    const dump = pgTool(
        "pg_dump",
        ["--schema-only", "--no-owner", "--no-acl"],
        dev.href,
      ),
      load = pgTool("psql", ["--set", "ON_ERROR_STOP=1"], sourceURL.href, {
        input: true,
      });
    await Promise.all([
      pipeline(dump.child.stdout, load.child.stdin),
      dump.done,
      load.done,
    ]);
    src = new pg.Client({ connectionString: sourceURL.href });
    await src.connect();
    process.env.BETTER_AUTH_SECRET = authSecret;
    const payload = seal({ restored: true }, run);
    process.env.BETTER_AUTH_SECRET = oldSecret;
    const definition = JSON.stringify({
      schemaVersion: 1,
      nodes: [{ id: "start", type: "manual_trigger", config: {} }],
      edges: [],
    });
    await src.query(
      `INSERT INTO "User" (id,name,email,"updatedAt") VALUES (${q(id)},'Disposable restore user','restore@example.test',NOW()); INSERT INTO "Workspace" (id,name,"updatedAt") VALUES (${q(workspace)},'Disposable restore workspace',NOW()); INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role) VALUES (${q(randomUUID())},${q(workspace)},${q(id)},'OWNER'); INSERT INTO "Workflow" (id,"workspaceId",name,draft,"updatedAt") VALUES (${q(workflow)},${q(workspace)},'Recovery graph',${q(definition)}::jsonb,NOW()); INSERT INTO "WorkflowVersion" (id,"workflowId",number,definition) VALUES (${q(version)},${q(workflow)},1,${q(definition)}::jsonb); INSERT INTO "WorkflowRun" (id,"workflowId","versionId","requestedBy","idempotencyKey","requestHash",payload,input) VALUES (${q(run)},${q(workflow)},${q(version)},${q(id)},'restore-test-key','restore-test-hash',${q(payload)},'{}'); INSERT INTO "IntegrationProvider" (id,name,description,"authMethod","requiredScopes",capabilities,"configurationSchema",state,"updatedAt") VALUES ('https-bearer','Disposable test','Disposable','BEARER','{}','{}','{}','AVAILABLE',NOW()); INSERT INTO "WorkspaceIntegration" (id,"workspaceId","providerId",label,status,scopes,"updatedAt") VALUES (${q(integration)},${q(workspace)},'https-bearer','Disposable','CONNECTED','{}',NOW()); INSERT INTO "IntegrationCredential" (id,"integrationId","workspaceId","providerId",ciphertext,"keyId","issuedAt","expiresAt","updatedAt") VALUES (${q(credential)},${q(integration)},${q(workspace)},'https-bearer',${q(encrypted.ciphertext)},${q(keyId)},NOW(),NOW()+INTERVAL '1 hour',NOW());`,
    );
    await backup({ url: sourceURL.href, path: archive, key, keyId });
    const bytes = await readFile(archive);
    assert.ok(!bytes.includes(Buffer.from("disposable-recovery-secret")));
    assert.ok(!bytes.includes(Buffer.from("Disposable restore user")));
    assert.throws(
      () => validateRestore(dev.href, dev.pathname.slice(1)),
      /RESTORE_/,
    );
    const corrupted = join(dir, "corrupt.enc"),
      bad = Buffer.from(bytes);
    bad[Math.floor(bad.length / 2)] ^= 1;
    await writeFile(corrupted, bad);
    await writeFile(corrupted + ".json", await readFile(archive + ".json"));
    await assert.rejects(
      restore({
        url: targetURL.href,
        confirm: target,
        path: corrupted,
        key,
        keyId,
        developmentUrl: dev.href,
      }),
    );
    await restore({
      url: targetURL.href,
      confirm: target,
      path: archive,
      key,
      keyId,
      developmentUrl: dev.href,
    });
    restored = new pg.Client({ connectionString: targetURL.href });
    await restored.connect();
    const data = await restored.query(
      'SELECT ciphertext FROM "IntegrationCredential" WHERE id=$1',
      [credential],
    );
    assert.deepEqual(
      decryptSecret(data.rows[0].ciphertext, context, ring),
      plain,
    );
    await assert.rejects(
      restored.query('UPDATE "WorkflowVersion" SET definition=$1 WHERE id=$2', [
        {},
        version,
      ]),
    );
    await assert.rejects(
      restore({
        url: targetURL.href,
        confirm: target,
        path: archive,
        key,
        keyId,
        developmentUrl: dev.href,
      }),
      /NOT_EMPTY/,
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", run],
      {
        env: {
          ...process.env,
          DATABASE_URL: targetURL.href,
          BETTER_AUTH_SECRET: authSecret,
          FLOWPILOT_ENV: "test",
          WORKER_HEALTH_FILE: join(dir, "health.json"),
        },
        stdio: "ignore",
      },
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      }),
      0,
    );
    assert.equal(
      (
        await restored.query(
          'SELECT status,payload FROM "WorkflowRun" WHERE id=$1',
          [run],
        )
      ).rows[0].status,
      "SUCCEEDED",
    );
    assert.equal(
      (
        await restored.query('SELECT payload FROM "WorkflowRun" WHERE id=$1', [
          run,
        ])
      ).rows[0].payload,
      "",
    );
    console.log(
      "Disposable encrypted backup/restore, constraint integrity, credential decrypt and real-worker queue recovery: passed",
    );
  } finally {
    if (src) await src.end();
    if (restored) await restored.end();
    for (const name of [source, target]) {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    }
    await admin.end();
    await rm(dir, { recursive: true, force: true });
    if (oldContainer === undefined) delete process.env.PG_TOOL_CONTAINER;
    else process.env.PG_TOOL_CONTAINER = oldContainer;
    if (oldSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = oldSecret;
  }
});
