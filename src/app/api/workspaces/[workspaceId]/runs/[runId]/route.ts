import { api } from "@/lib/engine/http";
import { getRun } from "@/lib/engine/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const { workspaceId, runId } = await params;
  return api(request, workspaceId, (actor) => getRun(actor, runId));
}
