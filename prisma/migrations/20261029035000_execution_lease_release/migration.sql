-- AlterTable
ALTER TABLE "ExecutionLease" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '90 seconds'),
ADD COLUMN     "releasedAt" TIMESTAMP(3);

