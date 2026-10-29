import { WebhookControls } from "@/components/webhook-controls";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { getWorkflow } from "@/lib/engine/service";
import { EngineError, validateDefinition } from "@/lib/engine/definition";
import type { TemplateContent } from "@/lib/templates/contracts";
import { WorkflowEditor } from "@/components/workflow-editor";
export default async function Page({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { user, member } = await requireWorkspace();
  const { workflowId } = await params;
  const workflow = await getWorkflow(
    { userId: user.id, workspaceId: member.workspaceId },
    workflowId,
  ).catch((error) => {
    if (error instanceof EngineError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link href="/workflows" className="text-sm text-teal-800 underline">
        All workflows
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        {workflow.name}
      </h1>
      <p className="mt-3 text-sm text-stone-500">
        Published versions are immutable. Signed webhooks and approved HTTPS
        actions are available. Scheduling and other provider integrations are
        Coming Soon.
      </p>
      {workflow.installation && (
        <p className="mt-4 rounded-xl border border-teal-800/15 bg-teal-50 p-4 text-xs leading-6 text-teal-900">
          Installed from{" "}
          {
            (
              workflow.installation.version
                .content as unknown as TemplateContent
            ).name
          }{" "}
          · Source v{workflow.installation.version.number}. This is your
          independent editable copy; catalog updates do not change it.
        </p>
      )}
      <WorkflowEditor
        workspaceId={member.workspaceId}
        role={member.role}
        workflow={workflow}
      />
      <WebhookControls
        workspaceId={member.workspaceId}
        workflowId={workflowId}
        role={member.role}
        published={workflow.versions
          .filter((v) =>
            validateDefinition(v.definition).nodes.some(
              (n) => n.type === "webhook_trigger",
            ),
          )
          .map((v) => ({ id: v.id, number: v.number }))}
      />
      <details className="mt-8 rounded-xl border border-border bg-white p-5">
        <summary className="cursor-pointer text-sm font-semibold">
          Published snapshots (latest 25)
        </summary>
        {workflow.versions.map((v) => (
          <details key={v.id} className="mt-4">
            <summary className="cursor-pointer text-sm">
              Version {v.number} · ID: {v.id} · {v.publishedAt.toISOString()}
            </summary>
            <pre className="mt-3 overflow-x-auto p-3 text-xs">
              {JSON.stringify(v.definition, null, 2)}
            </pre>
          </details>
        ))}
      </details>
    </>
  );
}
