import { api, body } from "@/lib/engine/http";
import { editWorkflow, getWorkflow } from "@/lib/engine/service";
type Context = { params: Promise<{ workspaceId: string; workflowId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { workspaceId, workflowId } = await params;
  return api(request, workspaceId, (actor) => getWorkflow(actor, workflowId));
}
export async function PATCH(request: Request, { params }: Context) {
  const { workspaceId, workflowId } = await params;
  return api(request, workspaceId, async (actor) =>
    editWorkflow(actor, workflowId, await body(request)),
  );
}
