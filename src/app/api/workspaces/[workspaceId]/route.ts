import { auth } from "@/lib/auth";
import { authorizedMembership } from "@/lib/workspaces";
import { headers } from "next/headers";
export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const member = await authorizedMembership(session.user.id, workspaceId);
  if (!member) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    workspace: { id: member.workspace.id, name: member.workspace.name },
    role: member.role,
  });
}
