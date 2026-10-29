import { api } from "@/lib/engine/http";
import { getVersion } from "@/lib/engine/service";
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceId: string;
      workflowId: string;
      versionId: string;
    }>;
  },
) {
  const { workspaceId, workflowId, versionId } = await params;
  return api(request, workspaceId, (actor) =>
    getVersion(actor, workflowId, versionId),
  );
}
