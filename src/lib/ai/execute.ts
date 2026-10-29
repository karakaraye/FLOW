import { loadKeys } from "../integrations/crypto";
import { setTimeout } from "node:timers/promises";
import { db } from "../db";
import { authorize } from "../engine/service";
import {
  EngineError,
  type WorkflowNode,
  type Json,
} from "../engine/definition";
import { attemptId } from "../http-actions/execute";
import { prepareAI } from "./prepare";
import { reserveAI, settleAI, rejectAI } from "./accounting";
import { OpenAIProvider, AIProviderError, type AIProvider } from "./provider";
import { provenance } from "./models";
export async function executeAI(
  runId: string,
  node: WorkflowNode,
  input: Json,
  deadline: number,
  options: { provider?: AIProvider } = {},
): Promise<{ output: Json }> {
  const prepared = prepareAI(node, input);
  const key = process.env.FLOWPILOT_OPENAI_API_KEY;
  if (!options.provider && !key)
    throw new EngineError(
      "AI_PROVIDER_UNCONFIGURED",
      "The AI provider is not configured.",
      503,
    );
  loadKeys();
  const provider = options.provider ?? new OpenAIProvider(provenance(), key!);
  const usage = await reserveAI(runId, node.id, prepared);
  for (let number = 1; number <= 3; number++) {
    let dispatched = false;
    const id = attemptId(runId, node.id, number);
    try {
      if (Date.now() >= deadline)
        throw new AIProviderError("EXECUTION_TIMEOUT", true);
      await db.$transaction(async (tx) => {
        const run = await tx.workflowRun.findUniqueOrThrow({
          where: { id: runId },
          include: { workflow: true },
        });
        await authorize(
          tx,
          { userId: run.requestedBy, workspaceId: run.workflow.workspaceId },
          ["OWNER", "ADMIN", "EDITOR"],
        );
        if (
          run.status !== "RUNNING" ||
          !run.workflow.enabled ||
          run.workflow.archivedAt
        )
          throw new AIProviderError("RUN_CANCELLED", true);
        await tx.aIUsage.update({
          where: { id: usage.id },
          data: { status: "RUNNING" },
        });
        await tx.httpAttempt.create({
          data: { id, runId, nodeId: node.id, number, state: "IN_FLIGHT" },
        });
      });
      dispatched = true;
      const result = await provider.generate({
        model: prepared.model,
        schema: prepared.schema,
        input: prepared.messages,
        kind: node.type,
        maxOutputTokens: prepared.maxOutputTokens,
        correlationId: usage.id,
        attemptId: id,
        timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())),
      });
      let output: Json | undefined;
      if (result.state === "SUCCEEDED")
        try {
          output = prepared.validate(result.output as Json);
        } catch {
          result.state = "FAILED";
          result.code = "AI_INVALID_RESPONSE";
        }
      if (!result.usage) {
        await settleAI(usage, result);
        await db.httpAttempt.update({
          where: { id },
          data: {
            state: "AMBIGUOUS",
            error: "AI_USAGE_UNKNOWN",
            finishedAt: new Date(),
          },
        });
        throw new EngineError(
          "AI_USAGE_UNKNOWN",
          "Provider usage is unknown; the reservation remains held.",
        );
      }
      await settleAI(usage, result, output);
      await db.httpAttempt.update({
        where: { id },
        data: {
          state: result.state === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
          error: result.code ?? null,
          finishedAt: new Date(),
        },
      });
      if (result.state !== "SUCCEEDED")
        throw new EngineError(
          result.code ?? "AI_INVALID_RESPONSE",
          "The model refused or could not produce a valid result.",
        );
      return { output: output! };
    } catch (error) {
      if (
        error instanceof EngineError &&
        [
          "AI_USAGE_UNKNOWN",
          "AI_INVALID_RESPONSE",
          "AI_REFUSED",
          "AI_TOKEN_LIMIT",
          "AI_CONTENT_FILTER",
        ].includes(error.code)
      )
        throw error;
      const failure =
        error instanceof AIProviderError
          ? error
          : new AIProviderError(
              dispatched ? "AI_USAGE_UNKNOWN" : "AI_REQUEST_NOT_SENT",
              !dispatched,
            );
      await db.httpAttempt.updateMany({
        where: { id, state: "IN_FLIGHT" },
        data: {
          state: failure.definitive ? "FAILED" : "AMBIGUOUS",
          error: failure.code,
          finishedAt: new Date(),
        },
      });
      if (failure.retryable && failure.definitive && number < 3) {
        await setTimeout(100 * 2 ** (number - 1));
        continue;
      }
      await rejectAI(usage.id, failure.code, failure.definitive);
      throw new EngineError(
        failure.code,
        failure.definitive
          ? "The AI request was rejected or disabled."
          : "AI outcome and provider charges are uncertain. The reservation is retained.",
      );
    }
  }
  throw new EngineError("AI_REQUEST_FAILED", "AI request failed.");
}
