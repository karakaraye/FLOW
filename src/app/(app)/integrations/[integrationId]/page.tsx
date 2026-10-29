import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { getConnection, listEvents } from "@/lib/integrations/service";
import { EngineError } from "@/lib/engine/definition";
import { ConnectionDetail } from "@/components/integrations/detail";
export default async function Page({
  params,
}: {
  params: Promise<{ integrationId: string }>;
}) {
  const { user, member } = await requireWorkspace();
  const { integrationId } = await params;
  const actor = { userId: user.id, workspaceId: member.workspaceId };
  const connection = await getConnection(actor, integrationId).catch(
    (error) => {
      if (error instanceof EngineError && error.status === 404) notFound();
      throw error;
    },
  );
  const events = await listEvents(actor, integrationId);
  return (
    <>
      <Link href="/integrations" className="text-sm text-teal-800 underline">
        All integrations
      </Link>
      <ConnectionDetail
        role={member.role}
        initial={JSON.parse(JSON.stringify(connection))}
        initialEvents={JSON.parse(JSON.stringify(events))}
      />
    </>
  );
}
