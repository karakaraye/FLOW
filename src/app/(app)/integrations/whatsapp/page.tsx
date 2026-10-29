import { requireWorkspace } from "@/lib/session";
import { WhatsAppWorkspace } from "@/components/whatsapp-workspace";
export const metadata = { title: "WhatsApp Business" };
export default async function Page() {
  const { member } = await requireWorkspace();
  return (
    <WhatsAppWorkspace workspaceId={member.workspaceId} role={member.role} />
  );
}
