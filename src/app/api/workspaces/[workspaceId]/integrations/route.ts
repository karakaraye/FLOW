import { api, body } from "@/lib/engine/http";
import { createConnection, listConnections } from "@/lib/integrations/service";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  return api(request, (await params).workspaceId, listConnections);
}
export async function POST(request: Request, { params }: Context) {
  return api(
    request,
    (await params).workspaceId,
    async (actor) => createConnection(actor, await body(request)),
    201,
  );
}
