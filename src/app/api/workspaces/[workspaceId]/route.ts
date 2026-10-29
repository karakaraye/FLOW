import { api } from "@/lib/engine/http";
import { authorizedMembership } from "@/lib/workspaces";
import { EngineError } from "@/lib/engine/definition";
export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  return api(request, workspaceId, async (actor) => {
    const member = await authorizedMembership(actor.userId, workspaceId);
    if (!member) throw new EngineError("NOT_FOUND", "Not found.", 404);
    return {
      workspace: { id: member.workspace.id, name: member.workspace.name },
      role: member.role,
    };
  });
}
