-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunId" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalMetric" (
    "bucket" TIMESTAMP(3) NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OperationalMetric_pkey" PRIMARY KEY ("bucket","route","status")
);

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");

-- CreateIndex
CREATE INDEX "OperationalMetric_bucket_idx" ON "OperationalMetric"("bucket");

