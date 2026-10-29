import { api, body } from "@/lib/engine/http";
import { EngineError } from "@/lib/engine/definition";
import {
  aiOverview,
  updateAIBudget,
  validateAI,
  queuePlayground,
} from "@/lib/ai/service";
type Context = { params: Promise<{ workspaceId: string; action: string }> };
export async function GET(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    const overview = await aiOverview(actor);
    if (p.action === "overview") return overview;
    if (p.action === "status") return overview.provider;
    if (p.action === "models") return overview.models;
    if (p.action === "budget") return overview.budget;
    if (p.action === "usage") return overview.usage;
    throw new EngineError("NOT_FOUND", "AI endpoint not found.", 404);
  });
}
export async function POST(request: Request, { params }: Context) {
  const p = await params;
  return api(
    request,
    p.workspaceId,
    async (actor) => {
      if (p.action === "validate")
        return validateAI(actor, await body(request));
      if (p.action === "playground")
        return queuePlayground(
          actor,
          await body(request),
          request.headers.get("Idempotency-Key"),
        );
      throw new EngineError("NOT_FOUND", "AI endpoint not found.", 404);
    },
    202,
  );
}
export async function PATCH(request: Request, { params }: Context) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) => {
    if (p.action !== "budget")
      throw new EngineError("NOT_FOUND", "AI endpoint not found.", 404);
    return updateAIBudget(actor, await body(request));
  });
}
