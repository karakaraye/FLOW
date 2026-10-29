-- DropForeignKey
ALTER TABLE "BillingPayment" DROP CONSTRAINT "BillingPayment_subscriptionCode_workspaceId_fkey";

-- AlterTable
ALTER TABLE "BillingPayment" ADD COLUMN     "checkoutId" TEXT NOT NULL,
ALTER COLUMN "subscriptionCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ExecutionLease" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '90 seconds');

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_id_workspaceId_key" ON "BillingCheckout"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_checkoutId_workspaceId_fkey" FOREIGN KEY ("checkoutId", "workspaceId") REFERENCES "BillingCheckout"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

