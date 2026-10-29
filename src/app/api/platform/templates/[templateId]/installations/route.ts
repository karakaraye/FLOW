import { api } from "@/lib/engine/http";
import { managedInstallations } from "@/lib/templates/service";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  return api(request, "", (actor) =>
    managedInstallations(actor.userId, templateId),
  );
}
