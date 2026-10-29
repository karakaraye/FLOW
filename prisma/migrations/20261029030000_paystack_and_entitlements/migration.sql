-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "amountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "credentialCiphertext" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "customerCode" TEXT,
ADD COLUMN     "interval" TEXT NOT NULL DEFAULT 'monthly',
ADD COLUMN     "lastPaidAt" TIMESTAMP(3),
ADD COLUMN     "lastReconciledAt" TIMESTAMP(3),
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "paidVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerCode" TEXT,
ADD COLUMN     "providerPlanCode" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BillingCheckout" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "providerPlanCode" TEXT NOT NULL,
    "providerPlanId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIALIZING',
    "providerTransactionId" TEXT,
    "customerCode" TEXT,
    "customerId" INTEGER,
    "paidAt" TIMESTAMP(3),
    "urlCiphertext" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastReconciledAt" TIMESTAMP(3),

    CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "workspaceId" TEXT,
    "kind" TEXT NOT NULL,
    "reference" TEXT,
    "subscriptionCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "reference" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "subscriptionCode" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("reference")
);

-- CreateTable
CREATE TABLE "QuotaEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLease" (
    "runId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLease_pkey" PRIMARY KEY ("runId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_reference_key" ON "BillingCheckout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_providerTransactionId_key" ON "BillingCheckout"("providerTransactionId");

-- CreateIndex
CREATE INDEX "BillingCheckout_workspaceId_createdAt_idx" ON "BillingCheckout"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_workspaceId_idempotencyKey_key" ON "BillingCheckout"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_digest_key" ON "BillingEvent"("digest");

-- CreateIndex
CREATE INDEX "BillingEvent_status_createdAt_idx" ON "BillingEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAudit_workspaceId_createdAt_idx" ON "BillingAudit"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_providerTransactionId_key" ON "BillingPayment"("providerTransactionId");

-- CreateIndex
CREATE INDEX "BillingPayment_workspaceId_paidAt_idx" ON "BillingPayment"("workspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "QuotaEntry_workspaceId_period_metric_idx" ON "QuotaEntry"("workspaceId", "period", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaEntry_workspaceId_metric_key_key" ON "QuotaEntry"("workspaceId", "metric", "key");

-- CreateIndex
CREATE INDEX "ExecutionLease_workspaceId_idx" ON "ExecutionLease"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerCode_key" ON "Subscription"("providerCode");

-- AddForeignKey
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAudit" ADD CONSTRAINT "BillingAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaEntry" ADD CONSTRAINT "QuotaEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLease" ADD CONSTRAINT "ExecutionLease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

