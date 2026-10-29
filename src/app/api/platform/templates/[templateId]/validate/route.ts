import { api } from "@/lib/engine/http";
import { validateTemplate } from "@/lib/templates/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  return api(request, "", (actor) =>
    validateTemplate(actor.userId, templateId),
  );
}
