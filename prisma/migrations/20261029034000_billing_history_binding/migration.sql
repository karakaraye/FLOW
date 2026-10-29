-- DropForeignKey
ALTER TABLE "BillingPayment" DROP CONSTRAINT "billing_payment_tenant";

-- CreateIndex
CREATE UNIQUE INDEX "billing_checkout_workspace_code" ON "BillingCheckout"("subscriptionCode", "workspaceId");

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_subscriptionCode_workspaceId_fkey" FOREIGN KEY ("subscriptionCode", "workspaceId") REFERENCES "BillingCheckout"("subscriptionCode", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

