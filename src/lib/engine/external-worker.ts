import { executeGoogle } from "../google/execute";
import { isGoogleType } from "../google/config";
import { Client } from "pg";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit, validateDefinition } from "./definition";
import { executeAsync } from "./executor";
import { executeHttp } from "../http-actions/execute";
import { unseal } from "./payload";
export async function processExternal(options: {
  runId?: string;
  onClaim?: (id: string) => void;
}) {
  const candidates = options.runId
    ? await db.$queryRaw<
        { id: string }[]
      >`SELECT r.id FROM "WorkflowRun" r JOIN "WorkflowVersion" v ON v.id=r."versionId" WHERE r.id=${options.runId} AND r.status IN ('QUEUED','RUNNING') AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email')) LIMIT 1`
    : await db.$queryRaw<
        { id: string }[]
      >`SELECT r.id FROM "WorkflowRun" r JOIN "WorkflowVersion" v ON v.id=r."versionId" WHERE r.status IN ('QUEUED','RUNNING') AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email')) ORDER BY r."createdAt",r.id LIMIT 20`;
  for (const { id } of candidates) {
    const lock = new Client({
      connectionString: process.env.DATABASE_URL,
      keepAlive: true,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    let connected = false,
      lost = false;
    lock.on("error", () => {
      lost = true;
    });
    try {
      await lock.connect();
      connected = true;
      const result = await lock.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,512)) AS acquired",
        [id],
      );
      if (!result.rows[0].acquired) continue;
      const run = await db.workflowRun.findUniqueOrThrow({
        where: { id },
        include: { version: true, workflow: true },
      });
      if (!["QUEUED", "RUNNING"].includes(run.status)) continue;
      const definition = validateDefinition(run.version.definition);
      if (run.status === "RUNNING") {
        // Never re-issue an external call after losing a worker. The remote service may have acted.
        await db.$transaction(async (tx) => {
          await tx.httpAttempt.updateMany({
            where: { runId: id, state: "IN_FLIGHT" },
            data: {
              state: "AMBIGUOUS",
              error: "WORKER_LOST_OUTCOME_UNKNOWN",
              finishedAt: new Date(),
            },
          });
          // Node results that never committed are unknown, not fabricated failures.
          // The durable HttpAttempt row identifies the uncertain external operation.
          await tx.workflowRun.updateMany({
            where: { id, status: "RUNNING" },
            data: {
              status: "FAILED",
              error: "WORKER_LOST_OUTCOME_UNKNOWN",
              payload: "",
              finishedAt: new Date(),
              output: audit(null),
            },
          });
        });
        return true;
      }
      if (lost) return false;
      const claimed = await db.workflowRun.updateMany({
        where: { id, status: "QUEUED" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (!claimed.count) continue;
      options.onClaim?.(id);
      try {
        const member = await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: run.workflow.workspaceId,
              userId: run.requestedBy,
            },
          },
        });
        if (
          !member ||
          member.role === "VIEWER" ||
          !run.workflow.enabled ||
          run.workflow.archivedAt
        )
          throw Error("authorization");
        const deadline = Date.now() + 60000;
        const execution = await executeAsync(
          definition,
          unseal(run.payload, id),
          async (node, input) => {
            if (lost) throw Error("lock lost");
            // Recheck authorization and cancellation immediately before each external action.
            const current = await db.workflowRun.findUniqueOrThrow({
              where: { id },
              include: { workflow: true },
            });
            const membership = await db.workspaceMember.findUnique({
              where: {
                workspaceId_userId: {
                  workspaceId: current.workflow.workspaceId,
                  userId: current.requestedBy,
                },
              },
            });
            if (
              current.status !== "RUNNING" ||
              !membership ||
              membership.role === "VIEWER" ||
              !current.workflow.enabled ||
              current.workflow.archivedAt
            )
              throw Error("cancelled");
            return isGoogleType(node.type)
              ? executeGoogle(id, node, input, deadline)
              : executeHttp(id, node, input, deadline);
          },
          { maxMs: 60000 },
        );
        if (lost) return true;
        await db.$transaction(async (tx) => {
          const active = await tx.workflowRun.updateMany({
            where: { id, status: "RUNNING" },
            data: {
              status: execution.status,
              error: execution.error ?? null,
              payload: "",
              output: execution.output,
              finishedAt: new Date(),
            },
          });
          if (active.count)
            await tx.nodeRun.createMany({
              data: execution.nodes.map((n) => ({
                ...n,
                runId: id,
                input: n.input as Prisma.InputJsonValue,
                output: n.output as Prisma.InputJsonValue | undefined,
              })),
            });
        });
      } catch {
        await db.$transaction(async (tx) => {
          const uncertain = await tx.httpAttempt.updateMany({
            where: { runId: id, state: "IN_FLIGHT" },
            data: {
              state: "AMBIGUOUS",
              error: "EXTERNAL_OUTCOME_UNKNOWN",
              finishedAt: new Date(),
            },
          });
          await tx.workflowRun.updateMany({
            where: { id, status: "RUNNING" },
            data: {
              status: "FAILED",
              error: uncertain.count
                ? "EXTERNAL_OUTCOME_UNKNOWN"
                : "EXTERNAL_EXECUTION_FAILED",
              payload: "",
              finishedAt: new Date(),
              output: audit(null),
            },
          });
        });
      }
      return true;
    } finally {
      if (connected) await lock.end().catch(() => {});
    }
  }
  return false;
}
