import { api, body } from "@/lib/engine/http";
import { storeHttpCredential } from "@/lib/http-actions/credentials";
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; integrationId: string }> },
) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) =>
    storeHttpCredential(actor, p.integrationId, await body(request)),
  );
}
