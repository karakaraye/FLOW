import { requireSession } from "@/lib/session";
import { ensurePersonalWorkspace } from "@/lib/workspaces";
import { AppSidebar } from "@/components/app-sidebar";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireSession();
  const member = await ensurePersonalWorkspace(user.id, user.name);
  return (
    <>
      <AppSidebar workspaceName={member.workspace.name} />
      <div className="lg:ml-64">
        <header className="flex h-20 items-center justify-between gap-4 border-b border-border bg-white/70 px-6 lg:px-10">
          <span className="rounded-full border border-teal-800/15 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
            Product preview
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-stone-500">{user.name}</span>
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm font-semibold"
              aria-hidden="true"
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
          {children}
        </main>
      </div>
    </>
  );
}
