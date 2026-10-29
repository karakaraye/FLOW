import { api, body } from "@/lib/engine/http";
import { checkRevision } from "@/lib/integrations/contracts";
import { beginGoogle, googleManagement } from "@/lib/google/service";
import { EngineError } from "@/lib/engine/definition";
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceId: string;
      integrationId: string;
      action: string;
    }>;
  },
) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    const revision = checkRevision(await body(request));
    if (p.action === "start")
      return beginGoogle(actor, p.integrationId, revision);
    if (p.action === "refresh" || p.action === "disconnect")
      return googleManagement(actor, p.integrationId, revision, p.action);
    throw new EngineError("NOT_FOUND", "Operation not found.", 404);
  });
}
