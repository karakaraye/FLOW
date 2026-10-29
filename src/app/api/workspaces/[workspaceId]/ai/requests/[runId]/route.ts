import { api } from "@/lib/engine/http";
import { aiRequestResult } from "@/lib/ai/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const p = await params;
  return api(request, p.workspaceId, (actor) =>
    aiRequestResult(actor, p.runId),
  );
}
