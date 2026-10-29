import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { getRun, getVersion } from "@/lib/engine/service";
import { EngineError } from "@/lib/engine/definition";
import { RunDetail } from "@/components/run-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { user, member } = await requireWorkspace();
  const { runId } = await params;
  const run = await getRun(
    { userId: user.id, workspaceId: member.workspaceId },
    runId,
  ).catch((error) => {
    if (error instanceof EngineError && error.status === 404) notFound();
    throw error;
  });
  const snapshot = await getVersion(
    { userId: user.id, workspaceId: member.workspaceId },
    run.workflowId,
    run.versionId,
  );
  return (
    <>
      <Link href="/history" className="text-sm text-teal-800 underline">
        Execution history
      </Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">
        {run.workflow.name}
      </h1>
      <p className="mt-3 break-all font-mono text-xs text-stone-500">
        Run {run.id}
      </p>
      <RunDetail
        canCancel={member.role !== "VIEWER"}
        snapshot={{
          definition: snapshot.definition,
          editor: snapshot.editor,
          number: snapshot.number,
        }}
        workspaceId={member.workspaceId}
        initial={JSON.parse(JSON.stringify(run))}
      />
    </>
  );
}
