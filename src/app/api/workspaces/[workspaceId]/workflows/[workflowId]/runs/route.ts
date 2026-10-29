import { api, body } from "@/lib/engine/http";
import { enqueue } from "@/lib/engine/service";
type Context = { params: Promise<{ workspaceId: string; workflowId: string }> };
export async function POST(request: Request, { params }: Context) {
  const { workspaceId, workflowId } = await params;
  return api(
    request,
    workspaceId,
    async (actor) =>
      enqueue(
        actor,
        workflowId,
        await body(request),
        request.headers.get("idempotency-key"),
      ),
    202,
  );
}
