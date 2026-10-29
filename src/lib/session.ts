import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { ensurePersonalWorkspace } from "./workspaces";
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

export async function requireWorkspace() {
  const session = await requireSession();
  const member = await ensurePersonalWorkspace(
    session.user.id,
    session.user.name,
  );
  return { ...session, member };
}
