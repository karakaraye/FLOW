import { api, body } from "@/lib/engine/http";
import { installTemplate, listInstallations } from "@/lib/templates/service";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return api(request, workspaceId, listInstallations);
}
export async function POST(request: Request, { params }: Context) {
  const { workspaceId } = await params;
  return api(
    request,
    workspaceId,
    async (actor) =>
      installTemplate(
        actor,
        await body(request),
        request.headers.get("idempotency-key"),
      ),
    201,
  );
}
