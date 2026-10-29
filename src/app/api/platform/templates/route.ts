import { api, body } from "@/lib/engine/http";
import { createTemplate, listManaged } from "@/lib/templates/service";
export async function GET(request: Request) {
  return api(request, "", (actor) => listManaged(actor.userId));
}
export async function POST(request: Request) {
  return api(
    request,
    "",
    async (actor) => createTemplate(actor.userId, await body(request)),
    201,
  );
}
