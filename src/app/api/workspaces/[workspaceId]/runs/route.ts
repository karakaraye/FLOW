import { api } from "@/lib/engine/http";
import { listRuns } from "@/lib/engine/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  return api(request, workspaceId, listRuns);
}
