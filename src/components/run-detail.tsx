"use client";
import Link from "next/link";
import { AIRunResults } from "./ai-run-results";
import dynamic from "next/dynamic";
import type { Snapshot } from "./builder/run-canvas";
const RunCanvas = dynamic(() => import("./builder/run-canvas"), { ssr: false });
import { useEffect, useState } from "react";
type RunView = {
  whatsappMessages?: {
    id: string;
    nodeId: string;
    state: string;
    kind: string;
    providerMessageId: string | null;
    recipientLast4: string;
    error: string | null;
    reviewedAt: string | null;
    attempts: {
      number: number;
      state: string;
      statusCode: number | null;
      error: string | null;
    }[];
    statuses: { state: string; providerAt: string }[];
  }[];
  attempts?: {
    id: string;
    nodeId: string;
    number: number;
    state: string;
    statusCode: number | null;
    error: string | null;
  }[];
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflow: { name: string };
  version: { number: number };
  nodes: {
    id: string;
    nodeId: string;
    type: string;
    status: string;
    error: string | null;
    input: unknown;
    output: unknown;
    startedAt: string | null;
    finishedAt: string;
  }[];
};
export function RunDetail({
  initial,
  workspaceId,
  snapshot,
  canCancel = false,
}: {
  initial: RunView;
  workspaceId: string;
  snapshot: Snapshot;
  canCancel?: boolean;
}) {
  const [run, setRun] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!["QUEUED", "RUNNING"].includes(run.status)) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/runs/${run.id}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          setError("Unable to refresh this run. Check your session or reload.");
          return;
        }
        setRun(await response.json());
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("Unable to refresh this run.");
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [run.id, run.status, workspaceId]);
  return (
    <>
      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <span
          className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-800"
          role="status"
        >
          {run.status}
        </span>
        <span>Published v{run.version.number}</span>
      </div>
      {canCancel && ["QUEUED", "RUNNING"].includes(run.status) && (
        <div className="mt-4 space-y-2">
          <button
            className="text-sm underline"
            onClick={async () => {
              const r = await fetch(
                `/api/workspaces/${workspaceId}/runs/${run.id}/cancel`,
                { method: "POST" },
              );
              if (r.ok) {
                const current = await fetch(
                  `/api/workspaces/${workspaceId}/runs/${run.id}`,
                );
                if (current.ok) setRun(await current.json());
              } else setError("Cancellation failed.");
            }}
          >
            Cancel run
          </button>
          <p className="text-xs text-stone-500">
            Stops further actions. An external request already sent may still
            finish remotely.
          </p>
        </div>
      )}
      {Boolean(run.whatsappMessages?.length) && (
        <section className="mt-5 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">
            WhatsApp send accounting and delivery
          </h2>
          <p className="mt-2 text-xs text-stone-500">
            ACCEPTED is not delivery. Provider receipts are separate from
            workflow success; reload for later delivery updates. UNKNOWN is
            never automatically resent.
          </p>
          {run.whatsappMessages?.map((m) => (
            <article className="mt-3 rounded border p-3 text-xs" key={m.id}>
              <strong>
                {m.nodeId} · {m.state} · ••••{m.recipientLast4}
              </strong>
              <p className="mt-2 break-all">
                {m.providerMessageId ?? "No confirmed provider message ID"}
              </p>
              {m.error && <p className="mt-2 text-red-800">{m.error}</p>}
              <p className="mt-2">
                Attempts:{" "}
                {m.attempts.map((a) => `${a.number}: ${a.state}`).join(", ")}
              </p>
              <p className="mt-2">
                {m.statuses
                  .map((s) => `${s.state} (${s.providerAt})`)
                  .join(" → ") || "Delivery unconfirmed"}
              </p>
            </article>
          ))}
          <Link
            className="mt-3 inline-block text-xs underline"
            href="/integrations/whatsapp"
          >
            Open WhatsApp audit and operator review
          </Link>
        </section>
      )}
      {Boolean(run.attempts?.length) && (
        <section className="mt-5 rounded-xl border p-4">
          <h2 className="font-semibold">HTTP attempts</h2>
          {run.attempts?.map((a) => (
            <p key={a.id} className="mt-2 break-all text-xs">
              {a.nodeId} · Attempt {a.number} · {a.state}
              {a.statusCode ? ` · HTTP ${a.statusCode}` : ""}
              {a.error ? ` · ${a.error}` : ""} · ID {a.id}
            </p>
          ))}
          <p className="mt-3 text-xs">
            AMBIGUOUS means the remote service may have acted. Check that
            service before starting another run.
          </p>
        </section>
      )}
      <AIRunResults workspaceId={workspaceId} runId={run.id} />
      <dl className="mt-6 grid gap-3 text-xs text-stone-500">
        <div>
          <dt className="inline font-semibold">Queued: </dt>
          <dd className="inline">{run.createdAt}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Started: </dt>
          <dd className="inline">{run.startedAt ?? "Not started"}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Finished: </dt>
          <dd className="inline">{run.finishedAt ?? "Pending"}</dd>
        </div>
      </dl>
      {run.status === "QUEUED" && (
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          Your run is safely queued. The local background worker must be running
          to process it. It is safe to close this page.
        </p>
      )}
      {run.error && (
        <p role="alert" className="mt-5 text-sm text-red-700">
          Execution failed: {run.error}
        </p>
      )}
      <p className="mt-6 text-xs leading-6 text-stone-500">
        Audit snapshots show data shape only. Submitted values, keys, event
        messages, and credentials are never included.
      </p>
      <RunCanvas snapshot={snapshot} status={run.status} nodes={run.nodes} />
      <div className="mt-5 space-y-4">
        {run.nodes.map((node) => (
          <article
            key={node.id}
            className="rounded-xl border border-border bg-white p-5"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="font-semibold">
                {node.nodeId}{" "}
                <span className="font-normal text-stone-500">
                  · {node.type}
                </span>
              </h2>
              <span className="text-xs font-semibold">{node.status}</span>
            </div>
            {node.error && (
              <p className="mt-3 text-xs text-amber-800">{node.error}</p>
            )}
            <p className="mt-3 text-xs text-stone-500">
              {node.startedAt ?? "Skipped"} → {node.finishedAt}
            </p>
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer font-semibold">
                Sanitized input / output
              </summary>
              <pre className="mt-3 overflow-auto rounded-lg bg-stone-50 p-3">
                {JSON.stringify(
                  { input: node.input, output: node.output },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
      </div>
      <p role="alert" className="mt-4 text-sm text-red-700">
        {error}
      </p>
    </>
  );
}
