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
        Start with a Manual or Webhook Trigger and build your path. Google
        actions require a configured connection. Scheduling and unimplemented
        provider integrations are Coming Soon.
      </p>
      <WorkflowEditor workspaceId={member.workspaceId} role={member.role} />
    </>
  );
}
