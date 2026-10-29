import { api, body } from "@/lib/engine/http";
import { listWebhooks, manageWebhook } from "@/lib/webhooks/service";
type Context = { params: Promise<{ workspaceId: string; workflowId: string }> };
export async function GET(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, (actor) =>
    listWebhooks(actor, p.workflowId),
  );
}
export async function POST(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) =>
    manageWebhook(actor, p.workflowId, await body(request)),
  );
}
