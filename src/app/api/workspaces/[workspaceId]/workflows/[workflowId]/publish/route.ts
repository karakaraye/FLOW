import { api, body } from "@/lib/engine/http";
import { publishWorkflow } from "@/lib/engine/service";
import { EngineError, isObject } from "@/lib/engine/definition";
type Context = { params: Promise<{ workspaceId: string; workflowId: string }> };
export async function POST(request: Request, { params }: Context) {
  const { workspaceId, workflowId } = await params;
  return api(request, workspaceId, async (actor) => {
    const data = await body(request);
    if (!isObject(data))
      throw new EngineError("INVALID_BODY", "Expected a revision.");
    return publishWorkflow(actor, workflowId, data.revision);
  });
}
