-- AlterEnum
ALTER TYPE "ProviderState" ADD VALUE 'AVAILABLE';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "ciphertext" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookAudit" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookRate" (
    "webhookId" TEXT NOT NULL,
    "bucket" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "WebhookRate_pkey" PRIMARY KEY ("webhookId")
);

-- CreateTable
CREATE TABLE "HttpAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "HttpAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Webhook_workflowId_idx" ON "Webhook"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_runId_key" ON "WebhookDelivery"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_deliveryId_key" ON "WebhookDelivery"("webhookId", "deliveryId");

-- CreateIndex
CREATE INDEX "WebhookAudit_webhookId_createdAt_idx" ON "WebhookAudit"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HttpAttempt_runId_nodeId_number_key" ON "HttpAttempt"("runId", "nodeId", "number");

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAudit" ADD CONSTRAINT "WebhookAudit_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookRate" ADD CONSTRAINT "WebhookRate_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HttpAttempt" ADD CONSTRAINT "HttpAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
