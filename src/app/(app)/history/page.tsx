import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { listRuns } from "@/lib/engine/service";
export const metadata = { title: "Execution history" };
export default async function Page() {
  const { user, member } = await requireWorkspace();
  const runs = await listRuns({
    userId: user.id,
    workspaceId: member.workspaceId,
  });
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Execution history
      </h1>
      <p className="mt-3 text-sm leading-7 text-stone-500">
        Latest 100 real runs in your workspace. Refresh to see new activity.
        Signed webhook and HTTP action runs appear here. Scheduling is Coming
        Soon.
      </p>
      <div className="mt-8 space-y-3">
        {runs.map((run) => (
          <Link
            href={`/history/${run.id}`}
            key={run.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-white p-5"
          >
            <div>
              <h2 className="font-semibold">{run.workflow.name}</h2>
              <p className="mt-2 text-xs text-stone-500">
                v{run.version.number} · {run.createdAt.toISOString()}
              </p>
            </div>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">
              {run.status}
            </span>
          </Link>
        ))}
        {runs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-sm text-stone-500">
            No runs yet. Publish a workflow and queue a manual execution.
          </div>
        )}
      </div>
    </>
  );
}
