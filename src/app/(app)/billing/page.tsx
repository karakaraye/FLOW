import { requireWorkspace } from "@/lib/session";
import { BillingWorkspace } from "@/components/billing-workspace";
export const metadata = { title: "Billing and usage" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const { member } = await requireWorkspace(),
    query = await searchParams;
  return (
    <BillingWorkspace
      workspaceId={member.workspaceId}
      role={member.role}
      returned={Boolean(query.reference || query.trxref)}
    />
  );
}
