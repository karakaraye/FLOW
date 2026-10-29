import { api, body } from "@/lib/engine/http";
import { workflowState } from "@/lib/webhooks/service";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; workflowId: string }> },
) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) =>
    workflowState(actor, p.workflowId, await body(request)),
  );
}
