"use client";
import ReadonlyCanvas from "./readonly-canvas";
export type Snapshot = { definition: unknown; editor: unknown; number: number };
export default function RunCanvas({
  snapshot,
  status,
  nodes,
}: {
  snapshot: Snapshot;
  status: string;
  nodes: { nodeId: string; status: string; error: string | null }[];
}) {
  return (
    <section className="mt-7 overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">
          Executed version {snapshot.number} · {status}
        </h2>
        <p className="mt-2 text-xs leading-6 text-stone-500">
          Read-only published snapshot. Node colors come only from recorded
          NodeRuns. Unrecorded nodes have no execution status. Pure-node runs
          commit atomically. HTTP runs persist intent before sending; an unknown
          remote outcome requires review.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-[10px]">
          <span className="text-emerald-800">● SUCCEEDED</span>
          <span className="text-red-700">● FAILED</span>
          <span className="text-stone-500">● SKIPPED</span>
        </div>
      </div>
      <div className="h-[460px] bg-stone-50" data-testid="execution-canvas">
        <ReadonlyCanvas
          definition={snapshot.definition}
          editor={snapshot.editor}
          statuses={Object.fromEntries(
            nodes.map((n) => [n.nodeId, { status: n.status, error: n.error }]),
          )}
        />
      </div>
    </section>
  );
}
