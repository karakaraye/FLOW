import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import pg from "pg";
import { db } from "../src/lib/db";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import { starterDefinition } from "../src/lib/engine/example";
import { branching } from "./engine-fixtures";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const ids: string[] = [];
const workspaces: string[] = [];
const workers: ChildProcess[] = [];
async function request(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  return fetch(new URL(path, base), {
    method,
    redirect: "manual",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function worker(id: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", id],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  workers.push(child);
  let text = "";
  child.stdout.on("data", (chunk) => {
    text += chunk.toString();
  });
  child.stderr.on("data", () => {});
  const done = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    done,
    async claimed() {
      const deadline = Date.now() + 10000;
      while (!text.includes(`CLAIMED ${id}`)) {
        assert.ok(Date.now() < deadline, "Worker did not claim the job");
        await delay(25);
      }
    },
  };
}
after(async () => {
  for (const child of workers)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test(
  "workflow API and real durable background worker",
  { timeout: 60000 },
  async (t) => {
    const cookies: string[] = [];
    for (const label of ["A", "B"]) {
      const response = await request("/api/auth/sign-up/email", "", "POST", {
        name: `Engine ${label}`,
        email: `engine-${label}-${randomUUID()}@example.test`,
        password: `Strong-${randomUUID()}!`,
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      ids.push(result.user.id);
      cookies.push(
        response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      );
      const member = await ensurePersonalWorkspace(
        result.user.id,
        result.user.name,
      );
      workspaces.push(member.workspaceId);
    }
    const root = `/api/workspaces/${workspaces[0]}`;
    const cookie = cookies[0];
    let workflowId = "",
      versionId = "",
      runId = "";
    async function call(
      suffix: string,
      method = "GET",
      body?: unknown,
      key?: string,
    ) {
      return request(root + suffix, cookie, method, body, key);
    }
    await t.test(
      "anonymous and untrusted-origin workflow mutations rejected",
      async () => {
        assert.equal(
          (
            await request(root + "/workflows", "", "POST", {
              name: "Bad",
              definition: starterDefinition,
            })
          ).status,
          401,
        );
        const response = await fetch(new URL(root + "/workflows", base), {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "Bad", definition: starterDefinition }),
        });
        assert.equal(response.status, 403);
      },
    );
    await t.test(
      "create validates definitions and saves a real draft",
      async () => {
        assert.equal(
          (
            await call("/workflows", "POST", {
              name: "Invalid",
              definition: {},
            })
          ).status,
          400,
        );
        const response = await call("/workflows", "POST", {
          name: "Real background workflow",
          definition: branching,
        });
        assert.equal(response.status, 201);
        const data = await response.json();
        workflowId = data.id;
        assert.equal(data.revision, 1);
      },
    );
    await t.test(
      "publish is repeatable and database rejects snapshot mutation",
      async () => {
        const response = await call(
          `/workflows/${workflowId}/publish`,
          "POST",
          { revision: 1 },
        );
        assert.equal(response.status, 200);
        const version = await response.json();
        versionId = version.id;
        const repeated = await call(
          `/workflows/${workflowId}/publish`,
          "POST",
          { revision: 1 },
        );
        assert.equal(repeated.status, 200);
        assert.equal((await repeated.json()).id, versionId);
        await assert.rejects(
          db.workflowVersion.update({
            where: { id: versionId },
            data: { definition: starterDefinition },
          }),
        );
        await assert.rejects(
          db.workflowVersion.delete({ where: { id: versionId } }),
        );
        assert.deepEqual(
          (
            await db.workflowVersion.findUniqueOrThrow({
              where: { id: versionId },
            })
          ).definition,
          branching,
        );
      },
    );
    await t.test(
      "concurrent duplicate admission produces one durable queued job",
      async () => {
        const key = randomUUID();
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            call(
              `/workflows/${workflowId}/runs`,
              "POST",
              {
                versionId,
                input: {
                  score: 12,
                  apiKey: "sk-test-do-not-log",
                  password: "must-never-appear",
                },
              },
              key,
            ),
          ),
        );
        for (const result of results) assert.equal(result.status, 202);
        const bodies = await Promise.all(results.map((r) => r.json()));
        assert.equal(new Set(bodies.map((b) => b.id)).size, 1);
        assert.equal(bodies.filter((b) => !b.replayed).length, 1);
        runId = bodies[0].id;
        assert.equal(
          await db.workflowRun.count({
            where: { workflowId, idempotencyKey: key },
          }),
          1,
        );
        const queued = await db.workflowRun.findUniqueOrThrow({
          where: { id: runId },
        });
        assert.equal(queued.status, "QUEUED");
        assert.doesNotMatch(
          queued.payload,
          /sk-test-do-not-log|must-never-appear/,
        );
        assert.equal(
          (
            await call(
              `/workflows/${workflowId}/runs`,
              "POST",
              { versionId, input: { score: 1 } },
              key,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "draft editing preserves pinned versions and rejects stale revisions",
      async () => {
        const edited = await call(`/workflows/${workflowId}`, "PATCH", {
          name: "Edited name",
          revision: 1,
          definition: starterDefinition,
        });
        assert.equal(edited.status, 200);
        assert.equal((await edited.json()).revision, 2);
        assert.equal(
          (
            await call(`/workflows/${workflowId}`, "PATCH", {
              name: "Stale",
              revision: 1,
              definition: starterDefinition,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await call(`/workflows/${workflowId}/publish`, "POST", {
              revision: 1,
            })
          ).status,
          409,
        );
        const next = await call(`/workflows/${workflowId}/publish`, "POST", {
          revision: 2,
        });
        assert.equal(next.status, 200);
        assert.notEqual((await next.json()).id, versionId);
        assert.deepEqual(
          (
            await db.workflowVersion.findUniqueOrThrow({
              where: { id: versionId },
            })
          ).definition,
          branching,
        );
      },
    );
    await t.test(
      "separate worker completes queued snapshot with skipped branch and sanitized audits",
      async () => {
        assert.equal((await worker(runId).done).code, 0);
        const response = await call(`/runs/${runId}`);
        assert.equal(response.status, 200);
        const run = await response.json();
        assert.equal(run.status, "SUCCEEDED");
        assert.equal(run.version.number, 1);
        assert.equal(run.nodes.length, 5);
        assert.equal(
          run.nodes.find((n: { nodeId: string }) => n.nodeId === "no").status,
          "SKIPPED",
        );
        assert.equal(
          run.nodes.find((n: { nodeId: string }) => n.nodeId === "yes").status,
          "SUCCEEDED",
        );
        assert.ok(run.startedAt && run.finishedAt);
        assert.doesNotMatch(
          JSON.stringify(run),
          /sk-test-do-not-log|must-never-appear|Do not persist this message|requestHash|payload|idempotencyKey/,
        );
        assert.equal(
          (await db.workflowRun.findUniqueOrThrow({ where: { id: runId } }))
            .payload,
          "",
        );
      },
    );
    await t.test(
      "runtime node failures are durable, sanitized, and skip descendants",
      async () => {
        const response = await call(
          `/workflows/${workflowId}/runs`,
          "POST",
          { versionId, input: { score: "not-a-number-secret" } },
          randomUUID(),
        );
        const { id } = await response.json();
        assert.equal(response.status, 202);
        assert.equal((await worker(id).done).code, 0);
        const result = await (await call(`/runs/${id}`)).json();
        assert.equal(result.status, "FAILED");
        assert.equal(result.error, "TYPE_MISMATCH");
        assert.equal(
          result.nodes.find((n: { nodeId: string }) => n.nodeId === "check")
            .status,
          "FAILED",
        );
        assert.equal(
          result.nodes.filter((n: { status: string }) => n.status === "SKIPPED")
            .length,
          3,
        );
        assert.doesNotMatch(JSON.stringify(result), /not-a-number-secret/);
      },
    );
    await t.test(
      "workspace isolation covers workflows, publishing, admission, histories, and pages",
      async () => {
        for (const [suffix, method, body] of [
          [`/workflows/${workflowId}`, "GET", undefined],
          [
            `/workflows/${workflowId}`,
            "PATCH",
            { name: "Cross", revision: 2, definition: starterDefinition },
          ],
          [`/workflows/${workflowId}/publish`, "POST", { revision: 2 }],
          [`/workflows/${workflowId}/runs`, "POST", { versionId, input: {} }],
          [`/runs/${runId}`, "GET", undefined],
        ] as const) {
          assert.equal(
            (
              await request(
                root + suffix,
                cookies[1],
                method,
                body,
                randomUUID(),
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/api/workspaces/${workspaces[1]}` + suffix,
                cookies[1],
                method,
                body,
                randomUUID(),
              )
            ).status,
            404,
          );
        }
        assert.deepEqual(
          await (
            await request(`/api/workspaces/${workspaces[1]}/runs`, cookies[1])
          ).json(),
          [],
        );
        for (const page of [`/workflows/${workflowId}`, `/history/${runId}`])
          assert.equal((await request(page, cookies[1])).status, 404);
      },
    );
    await t.test(
      "role policy enforced on create, edit, publish, run, and view APIs",
      async () => {
        for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: workspaces[0],
                userId: ids[0],
              },
            },
            data: { role },
          });
          assert.equal((await call(`/workflows/${workflowId}`)).status, 200);
          assert.equal((await call(`/runs/${runId}`)).status, 200);
          const created = await call("/workflows", "POST", {
            name: `Role ${role}`,
            definition: starterDefinition,
          });
          assert.equal(created.status, role === "VIEWER" ? 403 : 201);
          const current = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          assert.equal(
            (
              await call(`/workflows/${workflowId}`, "PATCH", {
                name: "Role checked",
                revision: current.revision,
                definition: starterDefinition,
              })
            ).status,
            role === "VIEWER" ? 403 : 200,
          );
          const revision = (
            await db.workflow.findUniqueOrThrow({ where: { id: workflowId } })
          ).revision;
          assert.equal(
            (
              await call(`/workflows/${workflowId}/publish`, "POST", {
                revision,
              })
            ).status,
            ["OWNER", "ADMIN"].includes(role) ? 200 : 403,
          );
          assert.equal(
            (
              await call(
                `/workflows/${workflowId}/runs`,
                "POST",
                { versionId, input: { score: 12 } },
                randomUUID(),
              )
            ).status,
            role === "VIEWER" ? 403 : 202,
          );
        }
        await db.workspaceMember.update({
          where: {
            workspaceId_userId: { workspaceId: workspaces[0], userId: ids[0] },
          },
          data: { role: "OWNER" },
        });
      },
    );
    await t.test(
      "killed in-flight worker rolls back its claim and a restarted worker recovers it",
      async () => {
        const response = await call(
          `/workflows/${workflowId}/runs`,
          "POST",
          { versionId, input: { score: 4 } },
          randomUUID(),
        );
        assert.equal(response.status, 202);
        const { id } = await response.json();
        const lock = new pg.Client({
          connectionString: process.env.DATABASE_URL,
        });
        await lock.connect();
        let stopped: ReturnType<typeof worker> | undefined;
        try {
          await lock.query("BEGIN");
          await lock.query('LOCK TABLE "NodeRun" IN ACCESS EXCLUSIVE MODE');
          stopped = worker(id);
          await stopped.claimed();
          // No completed audit can commit while the table is locked. Kill the actual
          // worker process in the middle of its claimed transaction, not a mock.
          stopped.child.kill("SIGKILL");
          assert.equal((await stopped.done).signal, "SIGKILL");
        } finally {
          if (
            stopped &&
            stopped.child.exitCode === null &&
            stopped.child.signalCode === null
          )
            stopped.child.kill("SIGKILL");
          await lock.query("ROLLBACK");
          await lock.end();
        }
        const queued = await db.workflowRun.findUniqueOrThrow({
          where: { id },
        });
        assert.equal(queued.status, "QUEUED");
        assert.equal(await db.nodeRun.count({ where: { runId: id } }), 0);
        assert.equal((await worker(id).done).code, 0);
        assert.equal(
          (await db.workflowRun.findUniqueOrThrow({ where: { id } })).status,
          "SUCCEEDED",
        );
        assert.equal(await db.nodeRun.count({ where: { runId: id } }), 5);
      },
    );
    await t.test(
      "competing worker processes cannot commit duplicate node runs",
      async () => {
        const response = await call(
          `/workflows/${workflowId}/runs`,
          "POST",
          { versionId, input: { score: 15 } },
          randomUUID(),
        );
        const { id } = await response.json();
        assert.equal(response.status, 202);
        const results = await Promise.all([worker(id).done, worker(id).done]);
        for (const result of results) assert.equal(result.code, 0);
        assert.equal(
          (await db.workflowRun.findUniqueOrThrow({ where: { id } })).status,
          "SUCCEEDED",
        );
        assert.equal(await db.nodeRun.count({ where: { runId: id } }), 5);
      },
    );
    await t.test(
      "run admission enforces input and HTTP body size limits",
      async () => {
        const path = `/workflows/${workflowId}/runs`;
        assert.equal(
          (
            await call(
              path,
              "POST",
              { versionId, input: { value: "x".repeat(17000) } },
              randomUUID(),
            )
          ).status,
          413,
        );
        assert.equal(
          (
            await call(
              path,
              "POST",
              { versionId, input: { value: "x".repeat(66000) } },
              randomUUID(),
            )
          ).status,
          413,
        );
        assert.equal(
          (await call(path, "POST", { versionId, input: {} }, "bad")).status,
          400,
        );
      },
    );
    await t.test(
      "run version foreign key cannot cross workflow boundaries",
      async () => {
        const other = await db.workflow.create({
          data: {
            workspaceId: workspaces[0],
            name: "FK test",
            draft: starterDefinition,
          },
        });
        await assert.rejects(
          db.workflowRun.create({
            data: {
              id: randomUUID(),
              workflowId: other.id,
              versionId,
              requestedBy: ids[0],
              idempotencyKey: randomUUID(),
              requestHash: "test",
              payload: "test",
              input: {},
            },
          }),
        );
      },
    );
    await t.test(
      "workspace queue capacity is enforced transactionally",
      async () => {
        const pending = await db.workflowRun.count({
          where: {
            workflow: { workspaceId: workspaces[0] },
            status: { in: ["QUEUED", "RUNNING"] },
          },
        });
        await db.workflowRun.createMany({
          data: Array.from({ length: 100 - pending }, () => ({
            id: randomUUID(),
            workflowId,
            versionId,
            requestedBy: ids[0],
            idempotencyKey: randomUUID(),
            requestHash: "capacity-fixture",
            payload: "not-executed",
            input: {},
          })),
        });
        assert.equal(
          (
            await call(
              `/workflows/${workflowId}/runs`,
              "POST",
              { versionId, input: {} },
              randomUUID(),
            )
          ).status,
          429,
        );
      },
    );
  },
);
