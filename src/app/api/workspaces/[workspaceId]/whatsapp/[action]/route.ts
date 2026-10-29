import { api, body } from "@/lib/engine/http";
import { isObject } from "@/lib/engine/definition";
import {
  whatsappOverview,
  connectWhatsApp,
  manageWhatsApp,
  templatesWhatsApp,
} from "@/lib/whatsapp/service";
import { waError } from "@/lib/whatsapp/config";
type Context = { params: Promise<{ workspaceId: string; action: string }> };
export async function GET(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    if (p.action === "overview") return whatsappOverview(actor);
    if (p.action === "templates")
      return templatesWhatsApp(
        actor,
        new URL(request.url).searchParams.get("connectionId") ?? "",
      );
    waError("NOT_FOUND", 404);
  });
}
export async function POST(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    const value = await body(request);
    if (p.action === "connect") {
      if (!isObject(value) || typeof value.integrationId !== "string")
        waError("WHATSAPP_CONNECT_BODY");
      const { integrationId, ...rest } = value;
      return connectWhatsApp(actor, integrationId, rest);
    }
    if (p.action === "manage") return manageWhatsApp(actor, value);
    waError("NOT_FOUND", 404);
  });
}
