import { api, body } from "@/lib/engine/http";
import { reconcileAI } from "@/lib/ai/service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; usageId: string }> },
) {
  const p = await params;
  return api(request, p.workspaceId, async (actor) =>
    reconcileAI(actor, p.usageId, await body(request)),
  );
}
