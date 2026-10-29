import { consumeQuota, adjustQuota } from "../billing/quotas";
import { randomUUID } from "node:crypto";
import { Prisma, type AIUsage } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { EngineError, type Json } from "../engine/definition";
import { costMicros, provenance } from "./models";
import { pricingSnapshot, type PreparedAI } from "./prepare";
import type { ProviderResult } from "./provider";
import { encryptSecret, decryptSecret } from "../integrations/crypto";
export type Actor = { userId: string; workspaceId: string };
export const resultContext = (id: string, workspaceId: string) => ({
  workspaceId,
  integrationId: `ai-result:${id}`,
  providerId: "openai",
  recordId: id,
  purpose: "ai-result" as const,
});
export async function reserveAI(
  runId: string,
  nodeId: string,
  prepared: PreparedAI,
) {
  return db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { workflow: true },
    });
    const actor = {
      userId: run.requestedBy,
      workspaceId: run.workflow.workspaceId,
    };
    await authorize(tx, actor, ["OWNER", "ADMIN", "EDITOR"]);
    if (
      run.status !== "RUNNING" ||
      !run.workflow.enabled ||
      run.workflow.archivedAt
    )
      throw new EngineError("RUN_CANCELLED", "Further AI work is disabled.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${actor.workspaceId}`}))`;
    if (
      await tx.aIUsage.findUnique({
        where: { runId_nodeId: { runId, nodeId } },
      })
    )
      throw new EngineError(
        "AI_DUPLICATE_REQUEST",
        "An AI request was already admitted for this node.",
        409,
      );
    const budget = await tx.aIWorkspaceBudget.upsert({
      where: { workspaceId: actor.workspaceId },
      create: { workspaceId: actor.workspaceId },
      update: {},
    });
    const now = new Date(),
      day = now.toISOString().slice(0, 10),
      month = day.slice(0, 7),
      reserved = costMicros(
        prepared.inputTokenBound,
        prepared.maxOutputTokens,
        prepared.model,
      );
    const daily = await tx.aIUsage.aggregate({
        where: { workspaceId: actor.workspaceId, day },
        _sum: { accountedMicros: true },
      }),
      monthly = await tx.aIUsage.aggregate({
        where: { workspaceId: actor.workspaceId, month },
        _sum: { accountedMicros: true },
      });
    if (
      (daily._sum.accountedMicros ?? 0n) + reserved > budget.dailyLimitMicros ||
      (monthly._sum.accountedMicros ?? 0n) + reserved >
        budget.monthlyLimitMicros
    )
      throw new EngineError(
        "AI_BUDGET_EXCEEDED",
        "The workspace daily or monthly AI budget is exhausted or disabled.",
        429,
      );
    if (
      (await tx.aIUsage.count({
        where: {
          workspaceId: actor.workspaceId,
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })) >= 20
    )
      throw new EngineError(
        "AI_WORKSPACE_RATE_LIMIT",
        "Workspace AI request rate exceeded.",
        429,
      );
    await consumeQuota(
      tx,
      actor.workspaceId,
      "aiMicros",
      `${runId}:${nodeId}`,
      reserved,
    );
    return tx.aIUsage.create({
      data: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        runId,
        nodeId,
        requestedBy: actor.userId,
        source:
          run.workflow.internalKind === "AI_PLAYGROUND"
            ? "PLAYGROUND"
            : "WORKFLOW",
        provider: "openai",
        mode: provenance(),
        modelId: prepared.model.id,
        model: prepared.model.model,
        inputTokenBound: prepared.inputTokenBound,
        maxOutputTokens: prepared.maxOutputTokens,
        reservedMicros: reserved,
        accountedMicros: reserved,
        pricing: pricingSnapshot(prepared.model) as Prisma.InputJsonValue,
        day,
        month,
      },
    });
  });
}
export async function settleAI(
  usage: AIUsage,
  result: ProviderResult,
  output?: Json,
) {
  return db.$transaction(async (tx) => {
    const pricing = usage.pricing as {
      inputMicrosPerMillion: string;
      outputMicrosPerMillion: string;
    };
    const known = Boolean(result.usage);
    const estimated = result.usage
      ? costMicros(result.usage.input, result.usage.output, pricing)
      : undefined;
    const state = known ? result.state : "UNKNOWN";
    const encrypted =
      known && result.state === "SUCCEEDED" && output !== undefined
        ? encryptSecret(output, resultContext(usage.id, usage.workspaceId))
            .ciphertext
        : null;
    const data: Prisma.AIUsageUpdateManyMutationInput = {
      status: state,
      revision: { increment: 1 },
      accountedMicros: estimated ?? usage.reservedMicros,
      estimatedCostMicros: estimated ?? null,
      accountingSource: known ? "PROVIDER_USAGE" : "RESERVATION",
      inputTokens: result.usage?.input ?? null,
      outputTokens: result.usage?.output ?? null,
      totalTokens: result.usage?.total ?? null,
      usageDetails: result.usage
        ? { cachedInputTokens: result.usage.cachedInput }
        : Prisma.DbNull,
      error: known ? (result.code ?? null) : "AI_USAGE_UNKNOWN",
      requestId: result.requestId ?? null,
      responseId: result.responseId ?? null,
      resultCiphertext: encrypted,
      resultExpiresAt: encrypted ? new Date(Date.now() + 600000) : null,
      finishedAt: new Date(),
    };
    const updated = await tx.aIUsage.updateMany({
      where: {
        id: usage.id,
        status: { in: ["RESERVED", "RUNNING", "UNKNOWN"] },
        reconciledAt: null,
      },
      data,
    });
    if (updated.count)
      await adjustQuota(
        tx,
        usage.workspaceId,
        "aiMicros",
        `${usage.runId}:${usage.nodeId}`,
        estimated ?? usage.reservedMicros,
      );
  });
}
export async function rejectAI(id: string, code: string, definitive: boolean) {
  await db.$transaction(async (tx) => {
    const row = await tx.aIUsage.findUniqueOrThrow({ where: { id } });
    const updated = await tx.aIUsage.updateMany({
      where: {
        id,
        status: { in: ["RESERVED", "RUNNING"] },
        reconciledAt: null,
      },
      data: {
        status: definitive ? "FAILED" : "UNKNOWN",
        revision: { increment: 1 },
        ...(definitive
          ? { accountedMicros: 0n, accountingSource: "NO_USAGE" }
          : {}),
        error: code,
        finishedAt: new Date(),
      },
    });
    if (definitive && updated.count)
      await adjustQuota(
        tx,
        row.workspaceId,
        "aiMicros",
        `${row.runId}:${row.nodeId}`,
        0n,
      );
  });
}
export async function markAIUnknownForRun(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  await tx.aIUsage.updateMany({
    where: { runId, status: { in: ["RESERVED", "RUNNING"] } },
    data: {
      status: "UNKNOWN",
      revision: { increment: 1 },
      error: "WORKER_LOST_OUTCOME_UNKNOWN",
      finishedAt: new Date(),
    },
  });
}
export function usageDto(r: AIUsage) {
  const { resultCiphertext, ...data } = r;
  void resultCiphertext;
  return {
    ...data,
    reservedMicros: r.reservedMicros.toString(),
    accountedMicros: r.accountedMicros.toString(),
    estimatedCostMicros: r.estimatedCostMicros?.toString() ?? null,
    resultAvailable: Boolean(
      r.resultCiphertext && r.resultExpiresAt && r.resultExpiresAt > new Date(),
    ),
  };
}
export function readAIResult(r: AIUsage) {
  if (
    !r.resultCiphertext ||
    !r.resultExpiresAt ||
    r.resultExpiresAt <= new Date()
  )
    return undefined;
  try {
    return decryptSecret<Json>(
      r.resultCiphertext,
      resultContext(r.id, r.workspaceId),
    );
  } catch {
    throw new EngineError(
      "AI_RESULT_UNAVAILABLE",
      "The encrypted result is unavailable.",
      503,
    );
  }
}
let lastCleanup = 0;
export async function purgeAIResults() {
  if (Date.now() - lastCleanup < 60000) return;
  lastCleanup = Date.now();
  await db.aIUsage.updateMany({
    where: {
      resultExpiresAt: { lte: new Date() },
      resultCiphertext: { not: null },
    },
    data: { resultCiphertext: null },
  });
}
