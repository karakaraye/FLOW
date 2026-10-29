"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { AIFields, initialAIConfig, aiNodeChoices } from "./builder/ai-fields";
import { nodeTitles } from "@/lib/builder/document";
import type { Data, NodeType } from "@/lib/engine/definition";
type Usage = {
  id: string;
  runId: string;
  nodeId: string;
  model: string;
  mode: string;
  source: string;
  status: string;
  revision: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  accountedMicros: string;
  estimatedCostMicros: string | null;
  accountingSource: string;
  error: string | null;
  output?: unknown;
  resultAvailable: boolean;
};
export type AIOverview = {
  provider: { configured: boolean; mode: string; code: string | null };
  models: unknown[];
  budget: {
    revision: number;
    dailyLimitMicros: string;
    monthlyLimitMicros: string;
    dailyAccountedMicros: string;
    monthlyAccountedMicros: string;
    day: string;
    month: string;
  };
  usage: Usage[];
};
const usd = (s: string) => `$${(Number(s) / 1000000).toFixed(6)}`;
function micros(value: string) {
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(value))
    throw Error("Enter USD with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 1000000n +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
}
export function AIWorkspace({
  workspaceId,
  role,
  initial,
}: {
  workspaceId: string;
  role: string;
  initial: AIOverview;
}) {
  const [overview, setOverview] = useState(initial),
    [type, setType] = useState<NodeType>("ai_summarize"),
    [config, setConfig] = useState<Data>(initialAIConfig("ai_summarize")),
    [input, setInput] = useState('{"text":""}'),
    [valid, setValid] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [key, setKey] = useState<string | null>(null),
    [runId, setRunId] = useState(""),
    [result, setResult] = useState<{
      status: string;
      error?: string;
      usage: Usage[];
    } | null>(null),
    [daily, setDaily] = useState(
      String(Number(initial.budget.dailyLimitMicros) / 1000000),
    ),
    [monthly, setMonthly] = useState(
      String(Number(initial.budget.monthlyLimitMicros) / 1000000),
    );
  const edit = role !== "VIEWER",
    manage = ["OWNER", "ADMIN"].includes(role),
    base = `/api/workspaces/${workspaceId}/ai`;
  const reload = useCallback(async () => {
    const r = await fetch(base + "/overview", { cache: "no-store" });
    if (r.ok) setOverview(await r.json());
  }, [base]);
  useEffect(() => {
    if (!runId || (result && !["QUEUED", "RUNNING"].includes(result.status)))
      return;
    const timer = setInterval(() => {
      void fetch(base + `/requests/${runId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setResult(data);
            if (!["QUEUED", "RUNNING"].includes(data.status)) void reload();
          }
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [runId, result, base, reload]);
  async function submit() {
    if (!valid) return;
    setBusy(true);
    setMessage("");
    const requestKey = key ?? crypto.randomUUID();
    setKey(requestKey);
    try {
      const response = await fetch(base + "/playground", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          node: { id: "preview", type, config },
          input: JSON.parse(input),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setRunId(data.id);
      const persisted = await fetch(base + `/requests/${data.id}`, {
        cache: "no-store",
      });
      if (persisted.ok) setResult(await persisted.json());
      else setResult({ status: "QUEUED", usage: [] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(base + "/budget", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: overview.budget.revision,
          dailyLimitMicros: micros(daily),
          monthlyLimitMicros: micros(monthly),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      await reload();
      setMessage("AI budget saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Budget update failed.");
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(u: Usage) {
    if (
      !window.confirm(
        "Confirm you checked the provider dashboard and this request incurred no charge. This manual decision is audited.",
      )
    )
      return;
    const r = await fetch(base + `/usage/${u.id}/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: u.revision,
        resolution: "NO_CHARGE",
        confirmedInProviderDashboard: true,
      }),
    });
    if (r.ok) {
      await reload();
      setMessage("Uncertain usage reconciled manually.");
    } else setMessage("Reconciliation failed. Reload current usage.");
  }
  return (
    <div className="space-y-7">
      <section className="rounded-2xl border border-border bg-white p-6">
        <h2 className="text-xl font-semibold">Provider status</h2>
        <p className="mt-3 text-sm" data-testid="ai-provider-status">
          {overview.provider.mode === "MOCK"
            ? "MOCK — controlled test provider; no live AI verification."
            : overview.provider.configured
              ? "OpenAI configured. Requests may incur provider charges."
              : "OpenAI unconfigured. No API key or approved/priced model is available."}
        </p>
        <p className="mt-3 text-xs leading-6 text-stone-500">
          No autonomous tools or generated code are executed. Basic redaction
          and selected-field mapping minimize data, but prompt injection and
          privacy risks cannot be perfectly prevented. Do not paste credentials
          or unnecessary personal information.
        </p>
      </section>
      <section className="rounded-2xl border border-border bg-white p-6">
        <h2 className="text-xl font-semibold">Provider budget</h2>
        <p className="mt-2 text-xs leading-6">
          Amounts are estimated provider costs, not customer subscription
          charges. Zero disables AI. Reservations and uncertain requests count
          toward the limits. Budget periods use UTC.
        </p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt>Daily accounted + held</dt>
            <dd>
              {usd(overview.budget.dailyAccountedMicros)} /{" "}
              {usd(overview.budget.dailyLimitMicros)}
            </dd>
          </div>
          <div>
            <dt>Monthly accounted + held</dt>
            <dd>
              {usd(overview.budget.monthlyAccountedMicros)} /{" "}
              {usd(overview.budget.monthlyLimitMicros)}
            </dd>
          </div>
        </dl>
        {manage && (
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="text-xs">
              Daily limit (USD)
              <input
                aria-label="AI daily budget USD"
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </label>
            <label className="text-xs">
              Monthly limit (USD)
              <input
                aria-label="AI monthly budget USD"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </label>
            <Button className="self-end" disabled={busy} onClick={saveBudget}>
              Save AI budget
            </Button>
          </div>
        )}
      </section>
      <section className="rounded-2xl border border-border bg-white p-6">
        <h2 className="text-xl font-semibold">AI playground</h2>
        <p className="mt-2 text-sm leading-7">
          Test one AI node on the durable worker before publishing. It consumes
          the same workspace budget and cannot execute other workflow actions.
        </p>
        <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-5">
            <label className="block text-xs">
              AI operation
              <select
                aria-label="Playground AI operation"
                value={type}
                disabled={!edit || busy || Boolean(key)}
                className="mt-1 w-full rounded-lg border p-3"
                onChange={(e) => {
                  const t = e.target.value as NodeType;
                  setType(t);
                  setConfig(initialAIConfig(t));
                }}
              >
                {aiNodeChoices.map((t) => (
                  <option key={t} value={t}>
                    {nodeTitles[t]}
                  </option>
                ))}
              </select>
            </label>
            <AIFields
              key={type + String(key)}
              workspaceId={workspaceId}
              type={type}
              value={config}
              disabled={!edit || busy || Boolean(key)}
              onChange={setConfig}
              onValidityChange={setValid}
            />
          </div>
          <div className="min-w-0 space-y-4">
            <label className="block text-xs">
              Playground input (JSON)
              <textarea
                aria-label="AI playground input"
                rows={10}
                className="mt-2 w-full rounded-lg border p-3 font-mono text-xs"
                value={input}
                disabled={!edit || busy || Boolean(key)}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            <Button
              disabled={
                !edit ||
                busy ||
                !valid ||
                !overview.provider.configured ||
                Boolean(
                  runId && ["QUEUED", "RUNNING"].includes(result?.status ?? ""),
                )
              }
              onClick={submit}
            >
              {key ? "Retry same AI request" : "Queue AI test"}
            </Button>
            {key && (
              <Button
                variant="outline"
                onClick={() => {
                  setKey(null);
                  setRunId("");
                  setResult(null);
                }}
              >
                Start a new AI test
              </Button>
            )}
            <p className="text-xs">
              The local worker must be running. Repeated submissions with the
              same key do not create duplicate jobs.
            </p>
            {result && (
              <div className="space-y-3 rounded-xl bg-stone-50 p-4">
                <p data-testid="ai-playground-status" className="font-semibold">
                  {result.status}
                </p>
                {result.error && (
                  <p className="text-sm text-red-700">{result.error}</p>
                )}
                {result.usage.map((u) => (
                  <div key={u.id} className="space-y-2 text-xs">
                    <p>
                      {u.mode} · {u.model} ·{" "}
                      {u.totalTokens === null
                        ? "Usage not reported"
                        : `${u.totalTokens} reported tokens`}{" "}
                      · Accounted {usd(u.accountedMicros)}
                    </p>
                    {u.output !== undefined ? (
                      <pre
                        data-testid="ai-playground-output"
                        className="overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-white p-3"
                      >
                        {JSON.stringify(u.output, null, 2)}
                      </pre>
                    ) : (
                      <p>
                        Raw output is unavailable, refused, uncertain, or
                        outside its ten-minute retention window.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">AI usage audit</h2>
          <Button variant="outline" onClick={reload}>
            Reload AI usage
          </Button>
        </div>
        <p className="mt-2 text-xs">
          Latest 100 requests. Prompts and raw outputs are excluded. Provider
          token usage and manual reconciliation are labeled separately.
        </p>
        {!overview.usage.length ? (
          <p className="mt-6 text-sm text-stone-500">
            No AI requests have been recorded.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {overview.usage.map((u) => (
              <article
                className="space-y-2 rounded-xl border p-4 text-xs"
                key={u.id}
              >
                <p className="font-semibold">
                  {u.status} · {u.mode} · {u.source}
                </p>
                <p className="break-all">
                  {u.model} · Node {u.nodeId}
                </p>
                <p>
                  {u.inputTokens === null
                    ? "Input tokens unreported"
                    : `${u.inputTokens} input tokens`}{" "}
                  ·{" "}
                  {u.outputTokens === null
                    ? "Output tokens unreported"
                    : `${u.outputTokens} output tokens`}
                </p>
                <p>
                  Accounted {usd(u.accountedMicros)} · {u.accountingSource}
                  {u.error ? ` · ${u.error}` : ""}
                </p>
                <a className="underline" href={`/history/${u.runId}`}>
                  Execution details
                </a>
                {manage && u.status === "UNKNOWN" && (
                  <Button
                    className="ml-4"
                    variant="outline"
                    size="sm"
                    onClick={() => reconcile(u)}
                  >
                    Reconcile as no charge
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <p role="alert" className="text-sm text-red-700">
        {message}
      </p>
    </div>
  );
}
