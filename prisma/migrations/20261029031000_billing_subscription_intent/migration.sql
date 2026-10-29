-- AlterTable
ALTER TABLE "BillingCheckout" ADD COLUMN     "subscriptionAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_subscriptionCode_key" ON "BillingCheckout"("subscriptionCode");

