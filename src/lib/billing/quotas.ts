import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { EngineError } from "../engine/definition";
import { planFor, period, type Limits } from "./config";
export type Metric = "executions" | "aiMicros" | "messages";
export async function quotaLock(
  tx: Prisma.TransactionClient,
  workspaceId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`entitlement:${workspaceId}`},720))`;
}
export async function effectivePlan(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  now = new Date(),
) {
  const s = await tx.subscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  const paid =
    !!s &&
    s.provider === "PAYSTACK" &&
    s.mode === "TEST" &&
    !!s.providerCode &&
    !!s.paidVerifiedAt &&
    !!s.currentPeriodEnd &&
    s.currentPeriodEnd > now &&
    ["ACTIVE", "PAST_DUE", "CANCELED"].includes(s.status);
  return { plan: planFor(paid ? s.plan.code : "FREE"), subscription: s, paid };
}
function exhausted(metric: string): never {
  throw new EngineError(
    "PLAN_QUOTA_EXCEEDED",
    `The workspace plan allowance for ${metric} is exhausted. Review Billing and usage.`,
    429,
  );
}
export async function resourceLimit(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  resource: "activeWorkflows" | "integrations",
  additional = 1,
) {
  await quotaLock(tx, workspaceId);
  const { plan } = await effectivePlan(tx, workspaceId);
  const count =
    resource === "activeWorkflows"
      ? await tx.workflow.count({
          where: {
            workspaceId,
            enabled: true,
            archivedAt: null,
            internalKind: null,
          },
        })
      : await tx.workspaceIntegration.count({
          where: { workspaceId, deletedAt: null },
        });
  if (count + additional > plan.limits[resource]) exhausted(resource);
}
export async function consumeQuota(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  metric: Metric,
  key: string,
  amount = 1n,
) {
  await quotaLock(tx, workspaceId);
  const old = await tx.quotaEntry.findUnique({
    where: { workspaceId_metric_key: { workspaceId, metric, key } },
  });
  if (old) return old;
  const { plan } = await effectivePlan(tx, workspaceId),
    bucket = period();
  const used = await tx.quotaEntry.aggregate({
    where: { workspaceId, metric, period: bucket },
    _sum: { amount: true },
  });
  if (
    amount < 0n ||
    (used._sum.amount ?? 0n) + amount > BigInt(plan.limits[metric])
  )
    exhausted(metric);
  return tx.quotaEntry.create({
    data: {
      id: randomUUID(),
      workspaceId,
      metric,
      key,
      period: bucket,
      amount,
    },
  });
}
export async function adjustQuota(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  metric: Metric,
  key: string,
  amount: bigint,
) {
  if (amount < 0n) throw Error("Invalid quota accounting");
  await quotaLock(tx, workspaceId);
  await tx.quotaEntry.updateMany({
    where: { workspaceId, metric, key },
    data: { amount },
  });
}
export async function claimEntitledRun(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  const run = await tx.workflowRun.findUniqueOrThrow({
    where: { id: runId },
    include: { workflow: true },
  });
  if (run.status !== "QUEUED") return false;
  const workspaceId = run.workflow.workspaceId;
  await quotaLock(tx, workspaceId);
  const { plan } = await effectivePlan(tx, workspaceId);
  const running = await tx.executionLease.count({
    where: { workspaceId, releasedAt: null, expiresAt: { gt: new Date() } },
  });
  if (running >= plan.limits.concurrency) return false;
  const claimed = await tx.workflowRun.updateMany({
    where: { id: runId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (!claimed.count) return false;
  await tx.executionLease.upsert({
    where: { runId },
    create: { runId, workspaceId },
    update: { releasedAt: null, expiresAt: new Date(Date.now() + 90000) },
  });
  return true;
}
export async function usageView(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  limits: Limits,
) {
  const groups = await tx.quotaEntry.groupBy({
    by: ["metric"],
    where: { workspaceId, period: period() },
    _sum: { amount: true },
  });
  const used: Record<string, number> = {
    activeWorkflows: await tx.workflow.count({
      where: {
        workspaceId,
        enabled: true,
        archivedAt: null,
        internalKind: null,
      },
    }),
    integrations: await tx.workspaceIntegration.count({
      where: { workspaceId, deletedAt: null },
    }),
    concurrency: await tx.executionLease.count({
      where: { workspaceId, releasedAt: null, expiresAt: { gt: new Date() } },
    }),
  };
  for (const metric of ["executions", "aiMicros", "messages"])
    used[metric] = Number(
      groups.find((g) => g.metric === metric)?._sum.amount ?? 0n,
    );
  return Object.entries(limits).map(([metric, limit]) => ({
    metric,
    used: used[metric] ?? 0,
    limit,
    remaining: Math.max(0, limit - (used[metric] ?? 0)),
  }));
}

export async function releaseRunLease(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  await tx.executionLease.updateMany({
    where: { runId, releasedAt: null },
    data: { releasedAt: new Date() },
  });
}
