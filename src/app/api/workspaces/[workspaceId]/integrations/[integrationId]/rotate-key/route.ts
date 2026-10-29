import { api, body } from "@/lib/engine/http";
import { operate } from "@/lib/integrations/service";
import { checkRevision } from "@/lib/integrations/contracts";
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; integrationId: string }> },
) {
  const { workspaceId, integrationId } = await params;
  return api(request, workspaceId, async (actor) =>
    operate(
      actor,
      integrationId,
      checkRevision(await body(request)),
      "rotate-key",
    ),
  );
}
