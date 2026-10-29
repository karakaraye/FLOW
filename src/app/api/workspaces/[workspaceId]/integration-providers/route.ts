import { api } from "@/lib/engine/http";
import { listProviders } from "@/lib/integrations/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return api(request, (await params).workspaceId, listProviders);
}
