BEGIN;
-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PlatformAdministrator" (
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdministrator_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AutomationTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateInstallation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "nodeMap" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTemplate_slug_key" ON "AutomationTemplate"("slug");

-- CreateIndex
CREATE INDEX "AutomationTemplate_status_idx" ON "AutomationTemplate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTemplateVersion_templateId_number_key" ON "AutomationTemplateVersion"("templateId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTemplateVersion_id_templateId_key" ON "AutomationTemplateVersion"("id", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInstallation_workflowId_key" ON "TemplateInstallation"("workflowId");

-- CreateIndex
CREATE INDEX "TemplateInstallation_templateVersionId_idx" ON "TemplateInstallation"("templateVersionId");

-- CreateIndex
CREATE INDEX "TemplateInstallation_workspaceId_createdAt_idx" ON "TemplateInstallation"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInstallation_workspaceId_idempotencyKey_key" ON "TemplateInstallation"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateInstallation_workflowId_workspaceId_key" ON "TemplateInstallation"("workflowId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_id_workspaceId_key" ON "Workflow"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "PlatformAdministrator" ADD CONSTRAINT "PlatformAdministrator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTemplateVersion" ADD CONSTRAINT "AutomationTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "AutomationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstallation" ADD CONSTRAINT "TemplateInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstallation" ADD CONSTRAINT "TemplateInstallation_workflowId_workspaceId_fkey" FOREIGN KEY ("workflowId", "workspaceId") REFERENCES "Workflow"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateInstallation" ADD CONSTRAINT "TemplateInstallation_templateVersionId_templateId_fkey" FOREIGN KEY ("templateVersionId", "templateId") REFERENCES "AutomationTemplateVersion"("id", "templateId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
