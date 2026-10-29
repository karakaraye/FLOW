import { processExternal } from "./external-worker";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit, EngineError, validateDefinition } from "./definition";
import { execute } from "./executor";
import { unseal } from "./payload";
/** The queue claim and all DB-only effects share one bounded transaction.
 * A process/connection crash rolls back the claim; another worker can recover it.
 * SKIP LOCKED permits multiple workers without duplicate committed execution.
 * HTTP graphs use the durable external-attempt path before entering this pure-node transaction.
 */
export async function processNext(
  options: { runId?: string; onClaim?: (id: string) => void } = {},
) {
  if (await processExternal(options)) return true;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '5s'`;
      const rows = options.runId
        ? await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "WorkflowRun" WHERE NOT EXISTS (SELECT 1 FROM "WorkflowVersion" v WHERE v.id="WorkflowRun"."versionId" AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email'))) AND status='QUEUED' AND id=${options.runId} ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "WorkflowRun" WHERE NOT EXISTS (SELECT 1 FROM "WorkflowVersion" v WHERE v.id="WorkflowRun"."versionId" AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email'))) AND status='QUEUED' ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return false;
      const id = rows[0].id;
      await tx.workflowRun.update({
        where: { id },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      options.onClaim?.(id);
      const run = await tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: { version: true },
      });
      try {
        const definition = validateDefinition(run.version.definition);
        const input = unseal(run.payload, id);
        const result = execute(definition, input);
        await tx.nodeRun.createMany({
          data: result.nodes.map((node) => ({
            ...node,
            runId: id,
            input: node.input as Prisma.InputJsonValue,
            output: node.output as Prisma.InputJsonValue | undefined,
          })),
        });
        await tx.workflowRun.update({
          where: { id },
          data: {
            status: result.status,
            error: result.error ?? null,
            output: result.output,
            payload: "",
            finishedAt: new Date(),
          },
        });
      } catch (error) {
        // Error messages and DB exceptions can contain data; persist fixed codes only.
        const code =
          error instanceof EngineError
            ? "INVALID_PUBLISHED_DEFINITION"
            : "EXECUTION_FAILED";
        await tx.workflowRun.update({
          where: { id },
          data: {
            status: "FAILED",
            error: code,
            output: audit(null),
            payload: "",
            finishedAt: new Date(),
          },
        });
      }
      return true;
    },
    { timeout: 10000, maxWait: 5000 },
  );
}
