import { db } from "./db";
import type { WorkspaceRole } from "@prisma/client";
// Advisory lock serializes first-login provisioning across processes. The unique
// membership constraint also prevents duplicate membership in a workspace.
export async function ensurePersonalWorkspace(userId: string, name: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const existing = await tx.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { workspace: true },
    });
    if (existing) return existing;
    const workspace = await tx.workspace.create({
      data: {
        name: `${name}'s workspace`,
        members: { create: { userId, role: "OWNER" } },
      },
    });
    return tx.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      include: { workspace: true },
    });
  });
}
export async function authorizedMembership(
  userId: string,
  workspaceId: string,
  roles?: WorkspaceRole[],
) {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { userId, workspaceId } },
    include: { workspace: true },
  });
  return member && (!roles || roles.includes(member.role)) ? member : null;
}
