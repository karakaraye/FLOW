import { authorize } from "./service";
import { processBillingEvent, reconcileDueBilling } from "../billing/events";
import { claimEntitledRun, releaseRunLease } from "../billing/quotas";
import { credentialForWhatsApp } from "../whatsapp/service";
import { processMetaEvent, purgeMetaEvents } from "../whatsapp/webhooks";
import { purgeAIResults } from "../ai/accounting";
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
  if (
    !options.runId &&
    ((await processBillingEvent()) || (await reconcileDueBilling()))
  )
    return true;
  await purgeMetaEvents();
  if (!options.runId && (await processMetaEvent())) return true;
  await purgeAIResults();
  if (await processExternal(options)) return true;
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '5s'`;
      const rows = options.runId
        ? await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "WorkflowRun" WHERE NOT EXISTS (SELECT 1 FROM "WorkflowVersion" v WHERE v.id="WorkflowRun"."versionId" AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('whatsapp_send_message','whatsapp_send_template','ai_classify','ai_summarize','ai_extract','ai_sentiment','ai_generate_text','http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email'))) AND status='QUEUED' AND id=${options.runId} ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "WorkflowRun" WHERE NOT EXISTS (SELECT 1 FROM "WorkflowVersion" v WHERE v.id="WorkflowRun"."versionId" AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'nodes') n WHERE n->>'type' IN ('whatsapp_send_message','whatsapp_send_template','ai_classify','ai_summarize','ai_extract','ai_sentiment','ai_generate_text','http_request','google_sheets_read_rows','google_sheets_append_row','google_sheets_update_row','gmail_send_email'))) AND status='QUEUED' ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return false;
      const id = rows[0].id;
      if (!(await claimEntitledRun(tx, id))) return false;
      options.onClaim?.(id);
      const run = await tx.workflowRun.findUniqueOrThrow({
        where: { id },
        include: { version: true },
      });
      try {
        const workflowState = await tx.workflow.findUniqueOrThrow({
          where: { id: run.workflowId },
        });
        await authorize(
          tx,
          { workspaceId: workflowState.workspaceId, userId: run.requestedBy },
          ["OWNER", "ADMIN", "EDITOR"],
        );
        if (!workflowState.enabled || workflowState.archivedAt)
          throw new EngineError(
            "RUN_AUTHORIZATION_REVOKED",
            "Execution is no longer authorized.",
            403,
          );
        const definition = validateDefinition(run.version.definition);
        const waTrigger = definition.nodes.find(
          (n) => n.type === "whatsapp_message_received",
        );
        if (waTrigger) {
          const workflow = await tx.workflow.findUniqueOrThrow({
            where: { id: run.workflowId },
          });
          const member = await tx.workspaceMember.findUnique({
            where: {
              workspaceId_userId: {
                workspaceId: workflow.workspaceId,
                userId: run.requestedBy,
              },
            },
          });
          if (
            !member ||
            member.role === "VIEWER" ||
            !workflow.enabled ||
            workflow.archivedAt ||
            run.createdAt.getTime() < Date.now() - 86400000
          )
            throw Error("authorization");
          await credentialForWhatsApp(
            tx,
            workflow.workspaceId,
            String(waTrigger.config.connectionId),
          );
        }
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
            ? ["FORBIDDEN", "NOT_FOUND", "RUN_AUTHORIZATION_REVOKED"].includes(
                error.code,
              )
              ? "RUN_AUTHORIZATION_REVOKED"
              : "INVALID_PUBLISHED_DEFINITION"
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
      await releaseRunLease(tx, id);
      return true;
    },
    { timeout: 10000, maxWait: 5000 },
  );
}
