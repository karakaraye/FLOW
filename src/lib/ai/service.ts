import { adjustQuota } from "../billing/quotas";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { authorize, enqueue } from "../engine/service";
import {
  EngineError,
  isObject,
  assertJson,
  canonical,
  type Definition,
  type Json,
  type WorkflowNode,
} from "../engine/definition";
import { aiConfig, isAIType } from "./config";
import { models, providerStatus, costMicros } from "./models";
import { prepareAI } from "./prepare";
import { usageDto, readAIResult, type Actor } from "./accounting";
const edit = ["OWNER", "ADMIN", "EDITOR"] as const;
export function aiNode(value: unknown): WorkflowNode {
  assertJson(value, 12000);
  if (
    !isObject(value) ||
    Object.keys(value).some((k) => !["id", "type", "config"].includes(k)) ||
    !isAIType(String(value.type)) ||
    !isObject(value.config)
  )
    throw new EngineError("AI_INVALID_CONFIG", "Provide a supported AI node.");
  aiConfig(String(value.type), value.config as never);
  return {
    id: "preview",
    type: String(value.type) as WorkflowNode["type"],
    config: value.config as WorkflowNode["config"],
  };
}
export async function aiOverview(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const budget = await tx.aIWorkspaceBudget.findUnique({
      where: { workspaceId: actor.workspaceId },
    });
    const day = new Date().toISOString().slice(0, 10),
      month = day.slice(0, 7);
    const daily = await tx.aIUsage.aggregate({
        where: { workspaceId: actor.workspaceId, day },
        _sum: { accountedMicros: true },
      }),
      monthly = await tx.aIUsage.aggregate({
        where: { workspaceId: actor.workspaceId, month },
        _sum: { accountedMicros: true },
      });
    const rows = await tx.aIUsage.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      provider: providerStatus(),
      models: (() => {
        try {
          return models().filter((m) => m.enabled);
        } catch {
          return [];
        }
      })(),
      budget: {
        revision: budget?.revision ?? 0,
        dailyLimitMicros: (budget?.dailyLimitMicros ?? 0n).toString(),
        monthlyLimitMicros: (budget?.monthlyLimitMicros ?? 0n).toString(),
        dailyAccountedMicros: (daily._sum.accountedMicros ?? 0n).toString(),
        monthlyAccountedMicros: (monthly._sum.accountedMicros ?? 0n).toString(),
        day,
        month,
      },
      usage: rows.map(usageDto),
    };
  });
}
function amount(v: unknown, max: bigint) {
  if (
    typeof v !== "string" ||
    !/^(0|[1-9][0-9]{0,12})$/.test(v) ||
    BigInt(v) > max
  )
    throw new EngineError(
      "AI_INVALID_BUDGET",
      "Use a nonnegative integer micro-USD amount within platform limits.",
    );
  return BigInt(v);
}
function cap(key: string, fallback: bigint) {
  try {
    const value = process.env[key];
    if (value === undefined) return fallback;
    if (!/^[0-9]{1,11}$/.test(value)) throw Error();
    return BigInt(value);
  } catch {
    throw new EngineError(
      "AI_INVALID_BUDGET",
      "Operator budget ceiling is invalid.",
      503,
    );
  }
}
export async function updateAIBudget(actor: Actor, body: unknown) {
  if (
    !isObject(body) ||
    Object.keys(body).some(
      (k) =>
        !["revision", "dailyLimitMicros", "monthlyLimitMicros"].includes(k),
    ) ||
    !Number.isInteger(body.revision)
  )
    throw new EngineError(
      "AI_INVALID_BUDGET",
      "Supply current revision and daily/monthly limits.",
    );
  const daily = amount(
      body.dailyLimitMicros,
      cap("FLOWPILOT_AI_MAX_DAILY_MICROS", 1000000n),
    ),
    monthly = amount(
      body.monthlyLimitMicros,
      cap("FLOWPILOT_AI_MAX_MONTHLY_MICROS", 5000000n),
    );
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${actor.workspaceId}`}))`;
    const existing = await tx.aIWorkspaceBudget.findUnique({
      where: { workspaceId: actor.workspaceId },
    });
    if ((existing?.revision ?? 0) !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "Reload the AI budget before saving.",
        409,
      );
    const row = await tx.aIWorkspaceBudget.upsert({
      where: { workspaceId: actor.workspaceId },
      create: {
        workspaceId: actor.workspaceId,
        dailyLimitMicros: daily,
        monthlyLimitMicros: monthly,
      },
      update: {
        dailyLimitMicros: daily,
        monthlyLimitMicros: monthly,
        revision: { increment: 1 },
      },
    });
    await tx.aIBudgetEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        kind: "BUDGET_UPDATED",
        data: {
          dailyLimitMicros: daily.toString(),
          monthlyLimitMicros: monthly.toString(),
          revision: row.revision,
        },
      },
    });
    return {
      revision: row.revision,
      dailyLimitMicros: daily.toString(),
      monthlyLimitMicros: monthly.toString(),
    };
  });
}
export async function validateAI(actor: Actor, body: unknown) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, [...edit]);
    if (!isObject(body))
      throw new EngineError("AI_INVALID_CONFIG", "Provide a node and input.");
    const node = aiNode(body.node);
    assertJson(body.input, 16384);
    const prepared = prepareAI(node, body.input);
    return {
      valid: true,
      modelId: prepared.model.id,
      inputTokenBound: prepared.inputTokenBound,
      maxOutputTokens: prepared.maxOutputTokens,
      maximumEstimatedMicros: costMicros(
        prepared.inputTokenBound,
        prepared.maxOutputTokens,
        prepared.model,
      ).toString(),
    };
  });
}
export async function queuePlayground(
  actor: Actor,
  body: unknown,
  key: string | null,
) {
  await db.$transaction((tx) => authorize(tx, actor, [...edit]));
  if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new EngineError(
      "INVALID_KEY",
      "Supply an Idempotency-Key of 8–100 safe characters.",
    );
  if (
    !isObject(body) ||
    Object.keys(body).some((k) => !["node", "input"].includes(k))
  )
    throw new EngineError(
      "AI_INVALID_CONFIG",
      "Provide only an AI node and input.",
    );
  const node = aiNode(body.node);
  assertJson(body.input, 16384);
  prepareAI(node, body.input);
  if (!providerStatus().configured)
    throw new EngineError(
      "AI_PROVIDER_UNCONFIGURED",
      "The AI provider is not configured.",
      503,
    );
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [{ id: "start", type: "manual_trigger", config: {} }, node],
    edges: [{ from: "start", to: node.id }],
  };
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, [...edit]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`;
    const workflow = await tx.workflow.upsert({
      where: {
        workspaceId_internalKind: {
          workspaceId: actor.workspaceId,
          internalKind: "AI_PLAYGROUND",
        },
      },
      create: {
        workspaceId: actor.workspaceId,
        internalKind: "AI_PLAYGROUND",
        name: "AI Playground",
        draft: definition as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    const existing = await tx.workflowRun.findUnique({
      where: {
        workflowId_idempotencyKey: {
          workflowId: workflow.id,
          idempotencyKey: key,
        },
      },
      include: { version: true },
    });
    if (existing) {
      const hash = createHash("sha256")
        .update(
          canonical({
            versionId: existing.versionId,
            input: body.input as Json,
          }),
        )
        .digest("hex");
      if (
        hash !== existing.requestHash ||
        canonical(existing.version.definition as Json) !==
          canonical(definition as unknown as Json)
      )
        throw new EngineError(
          "IDEMPOTENCY_CONFLICT",
          "This key identifies another playground request.",
          409,
        );
      return { id: existing.id, replayed: true };
    }
    const next = await tx.workflow.update({
      where: { id: workflow.id },
      data: { revision: { increment: 1 } },
    });
    const version = await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        number: next.revision,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    });
    return enqueue(
      actor,
      workflow.id,
      { versionId: version.id, input: body.input },
      key,
      { tx, internal: true },
    );
  });
}
export async function aiRequestResult(actor: Actor, runId: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const membership = await tx.workspaceMember.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
        },
      },
    });
    const run = await tx.workflowRun.findFirst({
      where: { id: runId, workflow: { workspaceId: actor.workspaceId } },
      select: { id: true, status: true, error: true, requestedBy: true },
    });
    if (!run) throw new EngineError("NOT_FOUND", "AI request not found.", 404);
    const rows = await tx.aIUsage.findMany({
      where: { runId, workspaceId: actor.workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return {
      ...run,
      usage: rows.map((r) => ({
        ...usageDto(r),
        ...(run.requestedBy === actor.userId && membership.role !== "VIEWER"
          ? { output: readAIResult(r) }
          : {}),
      })),
    };
  });
}
export async function reconcileAI(actor: Actor, id: string, body: unknown) {
  if (
    !isObject(body) ||
    Object.keys(body).some(
      (k) =>
        ![
          "revision",
          "resolution",
          "inputTokens",
          "outputTokens",
          "confirmedInProviderDashboard",
        ].includes(k),
    ) ||
    !Number.isInteger(body.revision) ||
    body.confirmedInProviderDashboard !== true ||
    !["NO_CHARGE", "REPORTED_USAGE"].includes(String(body.resolution))
  )
    throw new EngineError(
      "AI_INVALID_RECONCILIATION",
      "Confirm provider-dashboard review and choose a resolution.",
    );
  if (
    body.resolution === "REPORTED_USAGE" &&
    (typeof body.inputTokens !== "number" ||
      typeof body.outputTokens !== "number")
  )
    throw new EngineError(
      "AI_INVALID_RECONCILIATION",
      "Token counts must be numbers.",
    );
  const input = body.resolution === "NO_CHARGE" ? 0 : Number(body.inputTokens),
    output = body.resolution === "NO_CHARGE" ? 0 : Number(body.outputTokens);
  if (
    ![input, output].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10000000,
    )
  )
    throw new EngineError(
      "AI_INVALID_RECONCILIATION",
      "Provide bounded token counts.",
    );
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${actor.workspaceId}`}))`;
    const row = await tx.aIUsage.findFirst({
      where: { id, workspaceId: actor.workspaceId },
    });
    if (!row) throw new EngineError("NOT_FOUND", "AI usage not found.", 404);
    if (row.status !== "UNKNOWN" || row.revision !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "Only current uncertain usage can be reconciled.",
        409,
      );
    const value = costMicros(
      input,
      output,
      row.pricing as {
        inputMicrosPerMillion: string;
        outputMicrosPerMillion: string;
      },
    );
    await tx.aIUsage.update({
      where: { id },
      data: {
        status: "RECONCILED",
        revision: { increment: 1 },
        accountedMicros: value,
        estimatedCostMicros: value,
        accountingSource: "MANUAL",
        reconciledBy: actor.userId,
        reconciledAt: new Date(),
        reconciliation: {
          resolution: String(body.resolution),
          inputTokens: input,
          outputTokens: output,
        },
        resultCiphertext: null,
      },
    });
    await adjustQuota(
      tx,
      actor.workspaceId,
      "aiMicros",
      `${row.runId}:${row.nodeId}`,
      value,
    );
    await tx.aIBudgetEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        usageId: id,
        kind: "USAGE_RECONCILED",
        data: {
          accountedMicros: value.toString(),
          resolution: String(body.resolution),
          revision: row.revision + 1,
        },
      },
    });
    return {
      id,
      accountedMicros: value.toString(),
      accountingSource: "MANUAL",
    };
  });
}
