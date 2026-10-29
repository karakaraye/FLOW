"use client";
import { useState } from "react";
import { Button } from "./ui/button";
export function AIRunResults({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const [data, setData] = useState<{
      usage: {
        id: string;
        model: string;
        status: string;
        mode: string;
        totalTokens: number | null;
        accountedMicros: string;
        output?: unknown;
      }[];
    } | null>(null),
    [error, setError] = useState("");
  return (
    <section className="mt-5 rounded-xl border p-4">
      <h2 className="font-semibold">AI accounting and retained results</h2>
      <p className="mt-2 text-xs">
        Raw results are available only to the requesting member with edit
        access, for ten minutes. Routine node audits remain sanitized.
      </p>
      <Button
        className="mt-3"
        variant="outline"
        size="sm"
        onClick={async () => {
          const r = await fetch(
            `/api/workspaces/${workspaceId}/ai/requests/${runId}`,
          );
          if (r.ok) setData(await r.json());
          else setError("AI details could not be loaded.");
        }}
      >
        Load AI details
      </Button>
      {data?.usage.length === 0 && (
        <p className="mt-3 text-xs">No AI requests in this run.</p>
      )}
      {data?.usage.map((u) => (
        <article key={u.id} className="mt-3 space-y-2 text-xs">
          <p>
            {u.mode} · {u.model} · {u.status} · {u.totalTokens ?? "Unreported"}{" "}
            tokens · {u.accountedMicros} micro-USD accounted
          </p>
          {u.output !== undefined && (
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3">
              {JSON.stringify(u.output, null, 2)}
            </pre>
          )}
        </article>
      ))}
      <p role="alert" className="text-xs text-red-700">
        {error}
      </p>
    </section>
  );
}
