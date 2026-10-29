import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { listWorkflows } from "@/lib/engine/service";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Workflows" };
export default async function Page() {
  const { user, member } = await requireWorkspace();
  const workflows = await listWorkflows({
    userId: user.id,
    workspaceId: member.workspaceId,
  });
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
        Your automations
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Workflows</h1>
      <p className="mt-3 text-sm leading-7 text-stone-500">
        Design, publish, and run workflows manually or through signed webhooks.
        Use approved HTTPS actions. Scheduling and other provider integrations
        are Coming Soon.
      </p>
      <section className="mt-8 grid gap-4 md:grid-cols-2">
        {workflows.map((w) => (
          <Link
            key={w.id}
            href={`/workflows/${w.id}`}
            className="rounded-xl border border-border bg-white p-5 hover:border-teal-700"
          >
            <h2 className="font-semibold">{w.name}</h2>
            <p className="mt-3 text-xs text-stone-500">
              Draft {w.revision} ·{" "}
              {w.versions[0]
                ? `Published v${w.versions[0].number}`
                : "Not published"}
            </p>
          </Link>
        ))}
      </section>
      {workflows.length === 0 && (
        <p className="mt-8 rounded-xl border border-dashed border-border p-6 text-sm text-stone-500">
          No workflows yet. Create your first visual workflow.
        </p>
      )}
      {["OWNER", "ADMIN", "EDITOR"].includes(member.role) && (
        <Button asChild className="mt-6">
          <Link href="/workflows/new">New workflow</Link>
        </Button>
      )}
    </>
  );
}
