-- CreateEnum
CREATE TYPE "ProviderState" AS ENUM ('COMING_SOON', 'TEST_ONLY', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationEventKind" AS ENUM ('CREATED', 'LABEL_UPDATED', 'AUTHENTICATION_STARTED', 'AUTHENTICATION_SUCCEEDED', 'HEALTH_VERIFIED', 'REFRESHED', 'EXPIRED', 'REVOKED', 'DELETED', 'FAILED', 'KEY_ROTATED');

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL,
    "requiredScopes" TEXT[],
    "capabilities" TEXT[],
    "configurationSchema" JSONB NOT NULL,
    "state" "ProviderState" NOT NULL DEFAULT 'COMING_SOON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "connectionKey" TEXT DEFAULT 'primary',
    "label" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "authAttemptId" TEXT,
    "authInitiatedBy" TEXT,
    "authStateHash" TEXT,
    "authStateCiphertext" TEXT,
    "authExpiresAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "destroyedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "IntegrationEventKind" NOT NULL,
    "status" "IntegrationStatus" NOT NULL,
    "revision" INTEGER NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceIntegration_workspaceId_deletedAt_idx" ON "WorkspaceIntegration"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceIntegration_workspaceId_providerId_connectionKey_key" ON "WorkspaceIntegration"("workspaceId", "providerId", "connectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceIntegration_id_workspaceId_providerId_key" ON "WorkspaceIntegration"("id", "workspaceId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_integrationId_key" ON "IntegrationCredential"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_integrationId_workspaceId_providerId_key" ON "IntegrationCredential"("integrationId", "workspaceId", "providerId");

-- CreateIndex
CREATE INDEX "IntegrationAuditEvent_workspaceId_integrationId_createdAt_idx" ON "IntegrationAuditEvent"("workspaceId", "integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IntegrationProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_integrationId_workspaceId_providerId_fkey" FOREIGN KEY ("integrationId", "workspaceId", "providerId") REFERENCES "WorkspaceIntegration"("id", "workspaceId", "providerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAuditEvent" ADD CONSTRAINT "IntegrationAuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAuditEvent" ADD CONSTRAINT "IntegrationAuditEvent_integrationId_workspaceId_providerId_fkey" FOREIGN KEY ("integrationId", "workspaceId", "providerId") REFERENCES "WorkspaceIntegration"("id", "workspaceId", "providerId") ON DELETE CASCADE ON UPDATE CASCADE;
