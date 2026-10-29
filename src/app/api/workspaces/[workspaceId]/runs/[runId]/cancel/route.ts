import { api } from "@/lib/engine/http";
import { cancelRun } from "@/lib/engine/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const p = await params;
  return api(request, p.workspaceId, (actor) => cancelRun(actor, p.runId));
}
