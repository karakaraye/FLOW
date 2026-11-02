import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { WorkflowEditor } from "@/components/workflow-editor";
export const metadata = { title: "New workflow" };
export default async function Page() {
  const { member } = await requireWorkspace();
  if (!["OWNER", "ADMIN", "EDITOR"].includes(member.role))
    redirect("/workflows");
  return (
    <>
      <Link href="/workflows" className="text-sm text-teal-800 underline">
        All workflows
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        Create a workflow
      </h1>
      <p className="mt-3 text-sm text-stone-500">
        Start with a Manual or Webhook Trigger and build your path.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-teal-200 bg-teal-50/70 p-4">
        <div>
          <h2 className="text-sm font-semibold text-teal-950">
            Prefer not to start from scratch?
          </h2>
          <p className="mt-1 text-xs text-teal-800">
            Browse our pre-built automation templates for WhatsApp, Google Sheets, Gmail, and AI.
          </p>
        </div>
        <Link
          href="/templates"
          className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-900"
        >
          Browse Templates →
        </Link>
      </div>

      <WorkflowEditor workspaceId={member.workspaceId} role={member.role} />
    </>
  );
}
