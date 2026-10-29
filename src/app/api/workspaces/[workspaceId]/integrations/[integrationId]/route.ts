import { api, body } from "@/lib/engine/http";
import {
  getConnection,
  updateLabel,
  operate,
} from "@/lib/integrations/service";
import { checkRevision } from "@/lib/integrations/contracts";
type Context = {
  params: Promise<{ workspaceId: string; integrationId: string }>;
};
export async function GET(request: Request, { params }: Context) {
  const { workspaceId, integrationId } = await params;
  return api(request, workspaceId, (actor) =>
    getConnection(actor, integrationId),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  const { workspaceId, integrationId } = await params;
  return api(request, workspaceId, async (actor) =>
    updateLabel(actor, integrationId, await body(request)),
  );
}
export async function DELETE(request: Request, { params }: Context) {
  const { workspaceId, integrationId } = await params;
  return api(request, workspaceId, async (actor) =>
    operate(actor, integrationId, checkRevision(await body(request)), "delete"),
  );
}
