import { api } from "@/lib/engine/http";
import { listEvents } from "@/lib/integrations/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, (await params).workspaceId, (actor) =>
    listEvents(
      actor,
      new URL(request.url).searchParams.get("integrationId") ?? undefined,
    ),
  );
}
