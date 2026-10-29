import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { production, runtimeIssues } from "../security/runtime";
export async function readiness() {
  try {
    if (runtimeIssues().length) return false;
    await db.$queryRaw`SELECT 1`;
    if (
      production() &&
      !(await db.workerHeartbeat.count({
        where: {
          lastSeenAt: { gte: new Date(Date.now() - 45000) },
          status: { in: ["IDLE", "BUSY"] },
        },
      }))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
export function operationsAuthorized(request: Request) {
  const secret = process.env.OPERATIONS_TOKEN,
    value = request.headers.get("authorization");
  return (
    !!secret &&
    secret.length >= 32 &&
    !!value &&
    value.length < 1024 &&
    timingSafeEqual(
      createHash("sha256").update(value).digest(),
      createHash("sha256")
        .update("Bearer " + secret)
        .digest(),
    )
  );
}
export async function operationsMetrics() {
  const hour = new Date(Date.now() - 3600000),
    month = new Date().toISOString().slice(0, 7);
  const [runs, oldest, workers, integrations, billing, api, ai] =
    await Promise.all([
      db.workflowRun.groupBy({ by: ["status"], _count: { id: true } }),
      db.workflowRun.findFirst({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      db.workerHeartbeat.count({
        where: {
          lastSeenAt: { gte: new Date(Date.now() - 45000) },
          status: { in: ["IDLE", "BUSY"] },
        },
      }),
      db.workspaceIntegration.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      db.billingEvent.groupBy({ by: ["status"], _count: { id: true } }),
      db.operationalMetric.groupBy({
        by: ["route", "status"],
        where: { bucket: { gte: hour } },
        _sum: { count: true },
      }),
      db.aIUsage.aggregate({
        where: { month },
        _sum: { accountedMicros: true, reservedMicros: true },
        _count: { id: true },
      }),
    ]);
  return {
    workflowRuns: runs.map((r) => ({ status: r.status, count: r._count.id })),
    oldestQueuedSeconds: oldest
      ? Math.max(
          0,
          Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000),
        )
      : 0,
    staleExecutions: await db.workflowRun.count({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(Date.now() - 90000) },
      },
    }),
    failedExecutionsLastHour: await db.workflowRun.count({
      where: { status: "FAILED", finishedAt: { gte: hour } },
    }),
    healthyWorkers: workers,
    integrationStates: integrations.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    billingEvents: billing.map((r) => ({
      status: r.status,
      count: r._count.id,
    })),
    apiLastHour: api.map((r) => ({
      route: r.route,
      status: r.status,
      count: r._sum.count ?? 0,
    })),
    aiCurrentMonth: {
      requests: ai._count.id,
      accountedMicros: String(ai._sum.accountedMicros ?? 0n),
      reservedMicros: String(ai._sum.reservedMicros ?? 0n),
      unknownRequests: await db.aIUsage.count({
        where: { month, status: "UNKNOWN" },
      }),
    },
  };
}
export async function operationalRetention() {
  await db.operationalMetric.deleteMany({
    where: { bucket: { lt: new Date(Date.now() - 72 * 3600000) } },
  });
  await db.workerHeartbeat.deleteMany({
    where: { lastSeenAt: { lt: new Date(Date.now() - 7 * 86400000) } },
  });
}
