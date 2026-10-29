"use client";
import { useEffect, useRef, useState } from "react";
type Plan = {
  code: string;
  name: string;
  monthly: number;
  annually: number | null;
  currency: string;
  monthlyAvailable: boolean;
  annualAvailable: boolean;
  limits: Record<string, number>;
};
type Overview = {
  mode: string;
  configured: boolean;
  period: string;
  effectivePlan: Plan;
  plans: Plan[];
  subscription: {
    status: string;
    plan: string;
    paidThrough: string | null;
    nextPaymentDue: string | null;
    cancelAtPeriodEnd: boolean;
    revision: number;
    lastVerifiedAt: string | null;
  } | null;
  usage: { metric: string; used: number; limit: number; remaining: number }[];
  checkouts: {
    id: string;
    reference: string;
    tier: string;
    interval: string;
    amountMinor: number;
    currency: string;
    status: string;
    error: string | null;
    createdAt: string;
  }[];
  payments: {
    reference: string;
    amountMinor: number;
    currency: string;
    paidAt: string;
    periodEnd: string;
    source: string;
  }[];
  audits: { code: string; source: string; createdAt: string }[];
};
const labels: Record<string, string> = {
  activeWorkflows: "Active workflows",
  executions: "Workflow executions",
  aiMicros: "AI provider spend allowance (USD)",
  integrations: "Integration slots",
  messages: "Outgoing messages",
  concurrency: "Concurrent worker executions",
};
function ngn(minor: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
function units(metric: string, v: number) {
  return metric === "aiMicros"
    ? `$${(v / 1000000).toFixed(6)}`
    : v.toLocaleString();
}
export function BillingWorkspace({
  workspaceId,
  role,
  returned,
}: {
  workspaceId: string;
  role: string;
  returned: boolean;
}) {
  const [data, setData] = useState<Overview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [url, setUrl] = useState(""),
    [interval, setInterval] = useState<"monthly" | "annually">("monthly"),
    keys = useRef<Record<string, string>>({});
  const manage = ["OWNER", "ADMIN"].includes(role),
    base = `/api/workspaces/${workspaceId}/billing`;
  async function reload() {
    const r = await fetch(base + "/overview", { cache: "no-store" });
    if (!r.ok) throw Error("BILLING_OVERVIEW_UNAVAILABLE");
    setData(await r.json());
  }
  useEffect(() => {
    void fetch(base + "/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError("Billing information is unavailable."));
  }, [base]);
  async function post(action: string, body: unknown, key?: string) {
    const r = await fetch(base + "/" + action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.code ?? "BILLING_OPERATION_UNVERIFIED");
    return d;
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Billing operation unverified.",
      );
    } finally {
      setBusy(false);
    }
  }
  const card = "rounded-2xl border border-border bg-white p-5 sm:p-7",
    button =
      "rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50",
    sub = data?.subscription;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
            Workspace commercial controls
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Billing and usage</h1>
        </div>
        <button
          className={button}
          disabled={busy}
          onClick={() => void perform(reload)}
        >
          Reload billing status
        </button>
      </div>
      <section className={card}>
        <h2 className="font-semibold">Test billing only</h2>
        <p role="status" className="mt-3 text-sm">
          {data?.mode === "MOCK"
            ? "MOCK — controlled Paystack fixture; no actual Paystack test API verification."
            : data?.configured
              ? "PAYSTACK TEST — hosted test-card checkout only; no real-money billing."
              : "UNCONFIGURED — Paystack test setup is required. No payment is simulated."}
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-500">
          Only workspace owners and admins can create test checkouts, reconcile
          payments and cancel renewals. All members may read plan and usage
          metadata. A payment redirect does not activate a plan. Signed events
          and server-side verification establish payment and subscription
          status. Never use real card details in this test environment.
        </p>
      </section>
      {returned && (
        <p className="rounded-lg border bg-amber-50 p-4 text-sm">
          Returned from checkout. This is not proof of payment. Reconcile the
          matching pending checkout or wait for signed provider verification.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-teal-50 p-4 text-sm">
          {notice}
        </p>
      )}
      <section className={card}>
        <h2 className="font-semibold">
          Current plan:{" "}
          <span data-testid="billing-effective-plan">
            {data?.effectivePlan.code ?? "Loading"}
          </span>
        </h2>
        <p className="mt-3 text-sm">
          Payment status:{" "}
          {sub?.status ?? "FREE — no verified paid subscription"}
        </p>
        {sub && (
          <>
            <p className="mt-2 text-sm">
              Recorded subscription: {sub.plan} · Paid through{" "}
              {sub.paidThrough ?? "Not verified"}
            </p>
            <p className="mt-2 text-sm">
              Renewal due: {sub.nextPaymentDue ?? "No confirmed future renewal"}
            </p>
            <p className="mt-2 text-xs">
              {sub.cancelAtPeriodEnd
                ? sub.status === "CANCELED"
                  ? "Cancellation confirmed. Paid access remains until the paid-through date."
                  : "Cancellation requested; provider confirmation remains pending. Renewal may still occur until confirmed."
                : "Renewal remains subject to successful provider payment."}
            </p>
          </>
        )}
        <p className="mt-3 text-xs leading-5 text-stone-500">
          No grace extension is granted for unpaid renewals. Expiry returns
          entitlements to FREE without deleting workflows/history. Usage resets
          each UTC calendar month. Existing usage carries through plan changes.
          Paid-tier changes require confirmed cancellation and the end of the
          paid period before a new checkout; there is no automatic proration or
          annual discount.
        </p>
        {manage && sub && sub.status !== "CANCELED" && (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await post("cancel", { revision: sub.revision });
                setNotice(
                  "Provider cancellation verified. Existing paid time is retained.",
                );
              });
            }}
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4! w-4! shrink-0 p-0!"
                required
                disabled={busy}
              />
              Cancel future renewal; keep the already verified paid period.
            </label>
            <button
              className="rounded-lg border px-4 py-2 text-sm"
              disabled={busy || !data?.configured}
            >
              Cancel subscription renewal
            </button>
          </form>
        )}
      </section>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Plan proposals</h2>
          <label className="text-sm">
            Billing interval
            <select
              aria-label="Billing interval"
              className="ml-3 rounded border p-2"
              value={interval}
              onChange={(e) =>
                setInterval(e.target.value as "monthly" | "annually")
              }
            >
              <option value="monthly">Monthly</option>
              <option value="annually">Annual (separate configuration)</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          NGN prices and allowances are configurable starting proposals. Annual
          checkout is unavailable until an explicit annual price and matching
          Paystack plan are configured.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data?.plans.map((p) => (
            <article key={p.code} className="rounded-xl border p-4">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-3 text-xl font-semibold">
                {p.code === "FREE"
                  ? ngn(0)
                  : interval === "monthly"
                    ? ngn(p.monthly)
                    : p.annually === null
                      ? "Not configured"
                      : ngn(p.annually)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {interval === "monthly" ? "per month" : "per year"}
              </p>
              <ul className="mt-4 space-y-2 text-xs">
                {Object.entries(p.limits).map(([k, v]) => (
                  <li key={k}>
                    {labels[k]}: {units(k, v)}
                  </li>
                ))}
              </ul>
              <button
                aria-label={`Create ${p.code} test checkout`}
                className={"mt-5 w-full " + button}
                disabled={
                  !manage ||
                  busy ||
                  !data.configured ||
                  p.code === "FREE" ||
                  !(interval === "monthly"
                    ? p.monthlyAvailable
                    : p.annualAvailable)
                }
                onClick={() =>
                  void perform(async () => {
                    const k = p.code + interval;
                    keys.current[k] ??= crypto.randomUUID();
                    const d = await post(
                      "checkout",
                      { plan: p.code, interval },
                      keys.current[k],
                    );
                    setUrl(d.url ?? "");
                    setNotice(
                      `Checkout ${d.status}. No paid entitlement is granted until verification completes.`,
                    );
                  })
                }
              >
                {p.code === "FREE" ? "Default plan" : "Create test checkout"}
              </button>
            </article>
          ))}
        </div>
        {url && (
          <a
            className="mt-5 inline-block rounded border px-4 py-3 text-sm font-semibold text-teal-800"
            data-testid="paystack-checkout-link"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Paystack test checkout
          </a>
        )}
      </section>
      <section className={card}>
        <h2 className="font-semibold">
          Actual usage · {data?.period ?? "UTC month"}
        </h2>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Execution and message allowances count logical admissions, including
          failures and uncertain outcomes. Retries do not consume another unit.
          AI shows estimated provider USD cost/reservations; it is not an NGN
          subscription charge. Integration slots include reserved/disconnected
          records. Provider-specific safety limits can be stricter.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.usage.map((u) => (
            <div
              key={u.metric}
              className="rounded-lg border p-4"
              data-testid={`billing-usage-${u.metric}`}
            >
              <h3 className="text-xs font-semibold">{labels[u.metric]}</h3>
              <p className="mt-2 text-sm">
                {units(u.metric, u.used)} / {units(u.metric, u.limit)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Remaining: {units(u.metric, u.remaining)}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Checkout and payment history</h2>
        <div className="mt-4 space-y-3">
          {!data?.checkouts.length && (
            <p className="text-sm text-stone-500">No checkout attempts.</p>
          )}
          {data?.checkouts.map((c) => (
            <article key={c.id} className="rounded-lg border p-4 text-xs">
              <strong>
                {c.tier} · {c.interval} · {ngn(c.amountMinor)} · {c.status}
              </strong>
              <p className="mt-2 break-all">Reference: {c.reference}</p>
              {c.error && (
                <p className="mt-2 text-amber-900">Attention: {c.error}</p>
              )}
              <button
                aria-label={`Reconcile checkout ${c.id}`}
                className="mt-3 rounded border px-3 py-2"
                disabled={!manage || busy || !data.configured}
                onClick={() =>
                  void perform(async () => {
                    await post("reconcile", { checkoutId: c.id });
                    setNotice(
                      "Provider facts reconciled. Inspect the verified state.",
                    );
                  })
                }
              >
                Reconcile payment
              </button>
            </article>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {!data?.payments.length && (
            <p className="text-sm text-stone-500">No verified payments.</p>
          )}
          {data?.payments.map((p) => (
            <p
              className="rounded border p-3 text-xs break-all"
              key={p.reference}
            >
              {ngn(p.amountMinor)} · Paid {p.paidAt} · Through {p.periodEnd} ·{" "}
              {p.source}
            </p>
          ))}
        </div>
        <button
          className="mt-4 rounded border px-4 py-2 text-sm"
          disabled={!manage || busy || !data?.configured}
          onClick={() =>
            void perform(async () => {
              await post("reconcile", {});
              setNotice("Subscription reconciled with current provider facts.");
            })
          }
        >
          Reconcile subscription status
        </button>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Billing audit</h2>
        <div className="mt-4 space-y-2">
          {data?.audits.map((a, i) => (
            <p key={i} className="text-xs break-all">
              {a.createdAt} · {a.code} · {a.source}
            </p>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-stone-500">
          Subscription fees do not settle OpenAI, WhatsApp, Google or other
          provider bills. Operator keys, budgets, approved recipients, consent
          and provider policies remain independently enforced. No card details
          or provider authorization secrets are stored in billing history.
        </p>
      </section>
    </div>
  );
}
