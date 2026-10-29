import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import {
  listConnections,
  listEvents,
  listProviders,
} from "@/lib/integrations/service";
import { IntegrationCatalog } from "@/components/integrations/catalog";
export const metadata = { title: "Integrations" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const googleResult = (await searchParams).google;
  const { user, member } = await requireWorkspace();
  const actor = { userId: user.id, workspaceId: member.workspaceId };
  const [providers, connections, events] = await Promise.all([
    listProviders(actor),
    listConnections(actor),
    listEvents(actor),
  ]);
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Secure connection foundation
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Integrations
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-500">
        Manage workspace connection metadata, local access, and sanitized audit
        history. Google Sheets and send-only Gmail require operator OAuth setup.
        Approved HTTPS actions are available. WhatsApp has controlled developer
        onboarding. Customer Embedded Signup remains unavailable.
      </p>
      {googleResult === "authorization-failed" && (
        <p role="alert" className="mt-5 text-sm text-amber-800">
          Google authorization was not completed. Check the connection status,
          then reconnect. No provider details or tokens are included in this
          message.
        </p>
      )}
      <Link
        href="/integrations/whatsapp"
        className="mt-5 inline-flex rounded-lg border px-4 py-3 text-sm font-semibold"
      >
        Open WhatsApp Business
      </Link>
      <IntegrationCatalog
        workspaceId={member.workspaceId}
        role={member.role}
        providers={providers}
        connections={JSON.parse(JSON.stringify(connections))}
        events={JSON.parse(JSON.stringify(events))}
      />
    </>
  );
}
