import { api, body } from "@/lib/engine/http";
import { createWorkflow, listWorkflows } from "@/lib/engine/service";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return api(request, workspaceId, listWorkflows);
}
export async function POST(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return api(
    request,
    workspaceId,
    async (actor) => createWorkflow(actor, await body(request)),
    201,
  );
}
