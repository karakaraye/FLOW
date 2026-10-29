import { api, body } from "@/lib/engine/http";
import { editTemplate, managedDetail } from "@/lib/templates/service";
type Context = { params: Promise<{ templateId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { templateId } = await params;
  return api(request, "", (actor) => managedDetail(actor.userId, templateId));
}
export async function PATCH(request: Request, { params }: Context) {
  const { templateId } = await params;
  return api(request, "", async (actor) =>
    editTemplate(actor.userId, templateId, await body(request)),
  );
}
