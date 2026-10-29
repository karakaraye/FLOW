"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Connection = {
  id: string;
  businessName: string;
  messagingAccountId: string;
  legacyWabaId: string;
  mode: string;
  dailyLimit: number;
  integration: { id: string; revision: number; status: string };
  phones: {
    id: string;
    providerPhoneId: string;
    displayLast4: string;
    verifiedName: string;
  }[];
  endpoint: string;
};
type Overview = {
  configured: boolean;
  mode: string;
  integrations: { id: string; revision: number; status: string }[];
  connections: Connection[];
  events: {
    id: string;
    kind: string;
    state: string;
    error: string | null;
    providerAt: string;
    deliveries: { runId: string }[];
  }[];
  messages: {
    id: string;
    recipientLast4: string;
    state: string;
    error: string | null;
    providerMessageId: string | null;
    reviewedAt: string | null;
    runId: string;
    statuses: { state: string; providerAt: string }[];
  }[];
  contacts: {
    id: string;
    last4: string;
    consentAt: string | null;
    optedOutAt: string | null;
    consentSource: string | null;
  }[];
  subscriptions: {
    id: string;
    workflowId: string;
    versionId: string;
    enabled: boolean;
  }[];
};
type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body: string;
  supported: boolean;
};
export function WhatsAppWorkspace({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: string;
}) {
  const base = `/api/workspaces/${workspaceId}/whatsapp`,
    manage = ["OWNER", "ADMIN"].includes(role),
    [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [templates, setTemplates] = useState<Template[]>([]),
    [workflows, setWorkflows] = useState<
      { id: string; name: string; versions: { id: string; number: number }[] }[]
    >([]);
  async function reload() {
    const r = await fetch(base + "/overview", { cache: "no-store" });
    if (r.ok) setData(await r.json());
    else setError("Unable to load WhatsApp metadata.");
  }
  useEffect(() => {
    void fetch(base + "/overview", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
    void fetch(`/api/workspaces/${workspaceId}/workflows`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setWorkflows);
  }, [base, workspaceId]);
  async function post(action: string, value: unknown) {
    const r = await fetch(base + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      }),
      d = await r.json();
    if (!r.ok) throw Error(d.code ?? "WHATSAPP_OPERATION_FAILED");
    return d;
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
      setNotice("Operation recorded. Inspect the actual status below.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const connection = data?.connections[0],
    phone = connection?.phones[0],
    cls = "mt-1 w-full rounded-lg border border-border bg-white p-3 text-sm",
    button =
      "rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50",
    card = "rounded-2xl border bg-white p-5 sm:p-7";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-teal-700 uppercase">
            Official Meta Cloud API
          </p>
          <h1 className="mt-2 text-3xl font-semibold">WhatsApp Business</h1>
        </div>
        <button className={button} onClick={() => void reload()}>
          Reload WhatsApp status
        </button>
      </div>
      <section className={card}>
        <h2 className="font-semibold">Controlled developer onboarding</h2>
        <p role="status" className="mt-3 text-sm">
          {data?.configured
            ? data.mode === "MOCK"
              ? "MOCK — controlled Meta fixture; live connectivity unverified."
              : "Developer test mode — only operator-approved assets and recipients."
            : "UNCONFIGURED — operator Meta setup required. No connection or delivery is simulated."}
        </p>
        <p className="mt-3 text-sm leading-6 text-stone-500">
          This connects a developer-owned test account, not customer Embedded
          Signup. Meta app review, business verification and production
          permissions are not assumed. Text replies require an open service
          window. Only approved text-based utility templates with recorded
          consent are supported; marketing, media and bulk messaging are
          unavailable.
        </p>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-800">
          {notice}
        </p>
      )}
      {!manage && (
        <p className="text-sm text-stone-500">
          Read-only access. Only workspace owners and admins can manage
          connections, subscriptions and consent.
        </p>
      )}
      <section className={card}>
        <h2 className="font-semibold">Verify test connection / rotate token</h2>
        <p className="mt-2 text-xs text-stone-500">
          Operator configures App ID, App Secret, stable recipient hashing key,
          verification token, Graph v26.0 and test allowlists on the server.
          Access tokens are encrypted in the existing vault and never returned
          here. Reverify within 24 hours or earlier token expiry. Rotating a
          token cannot replace the bound account or phone identity.
        </p>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form),
              accessToken = String(f.get("token"));
            (form.elements.namedItem("token") as HTMLInputElement).value = "";
            void perform(async () => {
              let integration = data?.integrations?.[0];
              if (!integration) {
                const r = await fetch(
                  `/api/workspaces/${workspaceId}/integrations`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      providerId: "whatsapp-business",
                      label: "WhatsApp developer test",
                    }),
                  },
                );
                if (!r.ok)
                  throw Error("Connection metadata could not be created");
                integration = await r.json();
              }
              await post("connect", {
                integrationId: integration!.id,
                revision: integration!.revision,
                messagingAccountId: String(f.get("account")),
                phoneNumberId: String(f.get("phone")),
                accessToken,
                dailyLimit: Number(f.get("limit")),
              });
            });
          }}
        >
          <fieldset
            disabled={!manage || busy || !data?.configured}
            className="contents"
          >
            <label className="text-sm">
              Messaging account ID (legacy WABA ID)
              <input
                aria-label="Meta messaging account ID"
                className={cls}
                name="account"
                required
                defaultValue={connection?.messagingAccountId}
              />
            </label>
            <label className="text-sm">
              Phone-number ID
              <input
                aria-label="Meta phone-number ID"
                className={cls}
                name="phone"
                required
                defaultValue={phone?.providerPhoneId}
              />
            </label>
            <label className="text-sm">
              Access token
              <input
                aria-label="Meta access token"
                className={cls}
                name="token"
                type="password"
                autoComplete="off"
                required
              />
            </label>
            <label className="text-sm">
              Workspace daily send ceiling (0 disables, max 20)
              <input
                aria-label="WhatsApp daily send limit"
                className={cls}
                name="limit"
                type="number"
                min="0"
                max="20"
                defaultValue={connection?.dailyLimit ?? 0}
              />
            </label>
            <button className={button} type="submit">
              Verify WhatsApp connection
            </button>
          </fieldset>
        </form>
      </section>
      {connection && (
        <section className={card}>
          <h2 className="font-semibold">{connection.businessName}</h2>
          <p className="mt-2 text-sm">
            Connection: <strong>{connection.integration.status}</strong> ·{" "}
            {connection.mode}
          </p>
          <p className="mt-2 text-xs">
            Messaging / template / billing account:{" "}
            {connection.messagingAccountId} · Legacy WABA:{" "}
            {connection.legacyWabaId}
          </p>
          <p className="mt-2 text-xs">
            Phone: {phone?.verifiedName} · ••••{phone?.displayLast4} ·
            Phone-number ID {phone?.providerPhoneId}
          </p>
          <p className="mt-3 text-xs break-all">
            Meta callback URL: {connection.endpoint}
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Subscribe the verified app to messages in Meta. Verification token
            validates the challenge; every delivered POST also needs the App
            Secret signature.
          </p>
          <button
            disabled={
              !manage || busy || connection.integration.status === "REVOKED"
            }
            className="mt-4 rounded border px-4 py-2 text-sm"
            onClick={() =>
              void perform(() =>
                post("manage", {
                  action: "revoke",
                  connectionId: connection.id,
                  revision: connection.integration.revision,
                }),
              )
            }
          >
            Revoke local WhatsApp access
          </button>
          <p className="mt-2 text-xs text-stone-500">
            Local revocation destroys the stored credential and disables
            subscriptions. Revoke or rotate the token in Meta separately.
          </p>
        </section>
      )}
      {connection && (
        <section className={card}>
          <h2 className="font-semibold">Provider templates</h2>
          <button
            disabled={role === "VIEWER" || busy}
            className="mt-3 rounded border px-4 py-2 text-sm"
            onClick={() =>
              void perform(async () => {
                const r = await fetch(
                  base + `/templates?connectionId=${connection.id}`,
                );
                if (!r.ok) throw Error("WHATSAPP_TEMPLATES_UNAVAILABLE");
                setTemplates(await r.json());
              })
            }
          >
            Fetch Meta templates
          </button>
          <div className="mt-4 space-y-3">
            {templates.map((t) => (
              <article className="rounded-lg border p-3 text-sm" key={t.id}>
                <strong>{t.name}</strong> · {t.language} · {t.status} ·{" "}
                {t.category}
                <p className="mt-1 text-xs">
                  {t.supported
                    ? "Supported text structure"
                    : "Unsupported structure/category — sending blocked"}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{t.body}</p>
              </article>
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Only the first bounded provider page is listed. Approval and
            structure are fetched again before every template send.
          </p>
        </section>
      )}
      {phone && (
        <section className={card}>
          <h2 className="font-semibold">Messaging consent and suppression</h2>
          <p className="mt-2 text-xs text-stone-500">
            Grant only with documented recipient authorization. An incoming
            message opens a service window but does not grant template or
            marketing consent. STOP / UNSUBSCRIBE / CANCEL / END / QUIT / OPT
            OUT suppress further sends.
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(() =>
                post("manage", {
                  action: "consent",
                  phoneId: phone.id,
                  recipient: String(f.get("recipient")),
                  decision: String(f.get("decision")),
                  source: String(f.get("source")),
                }),
              );
            }}
          >
            <fieldset disabled={!manage || busy} className="contents">
              <label className="text-sm">
                Recipient international digits
                <input
                  aria-label="Consent recipient"
                  className={cls}
                  name="recipient"
                  required
                />
              </label>
              <label className="text-sm">
                Consent source / evidence reference
                <input
                  aria-label="Consent evidence"
                  className={cls}
                  name="source"
                  required
                  maxLength={160}
                />
              </label>
              <label className="text-sm">
                Decision
                <select className={cls} name="decision">
                  <option value="SUPPRESS">Suppress all messaging</option>
                  <option value="GRANT">
                    Record explicit utility consent / unsuppress
                  </option>
                  <option value="WITHDRAW">Withdraw utility consent</option>
                </select>
              </label>
              <button className={button}>Record consent decision</button>
            </fieldset>
          </form>
          <div className="mt-4 space-y-2 text-xs">
            {data?.contacts.map((c) => (
              <p key={c.id}>
                ••••{c.last4} ·{" "}
                {c.optedOutAt
                  ? "SUPPRESSED"
                  : c.consentAt
                    ? "EXPLICIT UTILITY CONSENT"
                    : "NO TEMPLATE CONSENT"}{" "}
                · {c.consentSource ?? "No consent source"}
              </p>
            ))}
          </div>
        </section>
      )}
      {connection && phone && (
        <section className={card}>
          <h2 className="font-semibold">
            Activate a published incoming-message workflow
          </h2>
          <p className="mt-2 text-xs text-stone-500">
            The published trigger must select this exact connection and phone.
            Only this server-managed binding can choose the workflow; webhook
            payloads cannot.
          </p>
          <form
            className="mt-4 flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(() =>
                post("manage", {
                  action: "subscribe",
                  connectionId: connection.id,
                  phoneId: phone.id,
                  versionId: String(f.get("version")),
                }),
              );
            }}
          >
            <select
              aria-label="WhatsApp published version"
              className="max-w-full rounded border p-3 text-sm"
              name="version"
              required
              disabled={!manage || busy}
            >
              <option value="">Select published version</option>
              {workflows.flatMap((w) =>
                w.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {w.name} · v{v.number}
                  </option>
                )),
              )}
            </select>
            <button className={button} disabled={!manage || busy}>
              Activate WhatsApp trigger
            </button>
          </form>
          {data?.subscriptions.map((s) => (
            <div
              key={s.id}
              className="mt-3 flex flex-wrap items-center gap-3 text-xs"
            >
              <Link className="underline" href={`/workflows/${s.workflowId}`}>
                Open subscribed workflow
              </Link>
              <span>{s.enabled ? "ACTIVE" : "DISABLED"}</span>
              <button
                disabled={!manage || busy || !s.enabled}
                className="rounded border px-3 py-2"
                onClick={() =>
                  void perform(() =>
                    post("manage", { action: "unsubscribe", id: s.id }),
                  )
                }
              >
                Disable subscription
              </button>
            </div>
          ))}
        </section>
      )}
      <section className={card}>
        <h2 className="font-semibold">Recent webhook events</h2>
        {!data?.events.length && (
          <p className="mt-3 text-sm text-stone-500">
            No accepted Meta events.
          </p>
        )}
        <div className="mt-4 space-y-3">
          {data?.events.map((e) => (
            <article key={e.id} className="rounded-lg border p-3 text-xs">
              <strong>
                {e.kind} · {e.state}
              </strong>
              <p className="mt-1">
                {e.providerAt} {e.error}
              </p>
              {e.deliveries.map((d) => (
                <Link
                  key={d.runId}
                  className="mt-2 inline-block underline"
                  href={`/history/${d.runId}`}
                >
                  View WhatsApp execution
                </Link>
              ))}
            </article>
          ))}
        </div>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Outgoing messages and delivery</h2>
        <p className="mt-2 text-xs text-stone-500">
          ACCEPTED means API acceptance only. SENT, DELIVERED and READ require
          signed Meta updates. UNKNOWN requires operator review in Meta; this
          app never automatically resends an uncertain message.
        </p>
        {!data?.messages.length && (
          <p className="mt-3 text-sm text-stone-500">No outgoing messages.</p>
        )}
        <div className="mt-4 space-y-3">
          {data?.messages.map((m) => (
            <article key={m.id} className="rounded-lg border p-3 text-xs">
              <strong>
                ••••{m.recipientLast4} · {m.state}
              </strong>
              <p className="mt-1 break-all">
                {m.providerMessageId ?? "No confirmed provider message ID"}
              </p>
              {m.error && (
                <p className="mt-2 text-red-800">Attention: {m.error}</p>
              )}
              {m.state === "UNKNOWN" && !m.reviewedAt && manage && (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(() =>
                      post("manage", {
                        action: "review-unknown",
                        messageId: m.id,
                        acknowledgeNoAutomaticResend: true,
                      }),
                    );
                  }}
                >
                  <label className="flex items-start gap-2">
                    <input type="checkbox" required disabled={busy} />I reviewed
                    this uncertain request in Meta. Keep its outcome UNKNOWN;
                    allow future messages without resending this request.
                  </label>
                  <button className="rounded border px-3 py-2" disabled={busy}>
                    Record provider review; do not resend
                  </button>
                </form>
              )}
              {m.reviewedAt && (
                <p className="mt-2">
                  Operator reviewed at {m.reviewedAt}; outcome remains
                  provider-unconfirmed.
                </p>
              )}
              <Link
                className="mt-2 inline-block underline"
                href={`/history/${m.runId}`}
              >
                View send execution
              </Link>
              <p className="mt-2">
                {m.statuses
                  .map((s) => `${s.state} (${s.providerAt})`)
                  .join(" → ") || "No provider delivery updates"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
