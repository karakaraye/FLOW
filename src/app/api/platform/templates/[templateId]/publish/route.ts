import { api, body } from "@/lib/engine/http";
import { publishTemplate } from "@/lib/templates/service";
import { EngineError, isObject } from "@/lib/engine/definition";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  return api(request, "", async (actor) => {
    const data = await body(request);
    if (!isObject(data))
      throw new EngineError("INVALID_BODY", "Supply revision.");
    return publishTemplate(actor.userId, templateId, data.revision);
  });
}
