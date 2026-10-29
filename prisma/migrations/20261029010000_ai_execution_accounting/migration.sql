-- CreateEnum
CREATE TYPE "AIRequestStatus" AS ENUM ('RESERVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REFUSED', 'UNKNOWN', 'RECONCILED');

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "internalKind" TEXT;

-- CreateTable
CREATE TABLE "AIWorkspaceBudget" (
    "workspaceId" TEXT NOT NULL,
    "dailyLimitMicros" BIGINT NOT NULL DEFAULT 0,
    "monthlyLimitMicros" BIGINT NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIWorkspaceBudget_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AIRequestStatus" NOT NULL DEFAULT 'RESERVED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "inputTokenBound" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageDetails" JSONB,
    "reservedMicros" BIGINT NOT NULL,
    "accountedMicros" BIGINT NOT NULL,
    "estimatedCostMicros" BIGINT,
    "accountingSource" TEXT NOT NULL DEFAULT 'RESERVATION',
    "pricing" JSONB NOT NULL,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "requestId" TEXT,
    "responseId" TEXT,
    "error" TEXT,
    "resultCiphertext" TEXT,
    "resultExpiresAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "reconciliation" JSONB,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIBudgetEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "usageId" TEXT,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIBudgetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIUsage_workspaceId_day_idx" ON "AIUsage"("workspaceId", "day");

-- CreateIndex
CREATE INDEX "AIUsage_workspaceId_month_idx" ON "AIUsage"("workspaceId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsage_runId_nodeId_key" ON "AIUsage"("runId", "nodeId");

-- CreateIndex
CREATE INDEX "AIBudgetEvent_workspaceId_createdAt_idx" ON "AIBudgetEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_workspaceId_internalKind_key" ON "Workflow"("workspaceId", "internalKind");

-- AddForeignKey
ALTER TABLE "AIWorkspaceBudget" ADD CONSTRAINT "AIWorkspaceBudget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIBudgetEvent" ADD CONSTRAINT "AIBudgetEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

