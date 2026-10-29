-- AlterTable
ALTER TABLE "WorkspaceIntegration" ADD COLUMN     "accountEmail" TEXT,
ADD COLUMN     "accountSubject" TEXT;

-- CreateTable
CREATE TABLE "GoogleOAuthAttempt" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "GoogleOAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleOAuthAttempt_stateHash_key" ON "GoogleOAuthAttempt"("stateHash");

-- CreateIndex
CREATE INDEX "GoogleOAuthAttempt_integrationId_idx" ON "GoogleOAuthAttempt"("integrationId");

-- AddForeignKey
ALTER TABLE "GoogleOAuthAttempt" ADD CONSTRAINT "GoogleOAuthAttempt_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WorkspaceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
