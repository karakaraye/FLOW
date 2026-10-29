"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
type Hook = {
  id: string;
  versionId: string;
  endpoint: string;
  enabled: boolean;
  revision: number;
  revokedAt: string | null;
  deliveries: {
    id: string;
    createdAt: string;
    run: { id: string; status: string; error: string | null };
  }[];
  audit: { code: string; createdAt: string }[];
};
export function WebhookControls({
  workspaceId,
  workflowId,
  role,
  published,
}: {
  workspaceId: string;
  workflowId: string;
  role: string;
  published: { id: string; number: number }[];
}) {
  const [workflowEnabled, setWorkflowEnabled] = useState(true),
    [archived, setArchived] = useState(false);
  const [hooks, setHooks] = useState<Hook[]>([]),
    [version, setVersion] = useState(""),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const manage = ["OWNER", "ADMIN"].includes(role);
  const url = `/api/workspaces/${workspaceId}/workflows/${workflowId}/webhooks`;
  async function reload() {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) setHooks(await r.json());
  }
  useEffect(() => {
    void fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setHooks);
    void fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (w) {
          setWorkflowEnabled(w.enabled);
          setArchived(Boolean(w.archivedAt));
        }
      });
  }, [url, workspaceId, workflowId]);
  async function act(action: string, hook?: Hook) {
    setBusy(true);
    setSecret("");
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(hook
            ? { id: hook.id, revision: hook.revision }
            : { versionId: version || published[0]?.id }),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (data.secret) setSecret(data.secret);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="my-8 space-y-5 rounded-2xl border border-border bg-white p-6"
      aria-label="Webhook setup"
    >
      <h2 className="text-xl font-semibold">Webhook setup</h2>
      <p className="text-sm leading-7 text-stone-600">
        Let another service start your published workflow by sending a signed
        JSON delivery. First choose Webhook Trigger in the builder, save, and
        publish. Each endpoint stays pinned to the published version you select.
      </p>
      <Button variant="outline" onClick={reload}>
        Reload webhook setup
      </Button>
      {manage && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4! w-4! shrink-0 p-0! accent-teal-700"
              checked={workflowEnabled}
              onChange={(e) => setWorkflowEnabled(e.target.checked)}
            />
            Workflow enabled
          </label>
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4! w-4! shrink-0 p-0! accent-teal-700"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Archived
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const r = await fetch(
                `/api/workspaces/${workspaceId}/workflows/${workflowId}/state`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: workflowEnabled, archived }),
                },
              );
              setError(r.ok ? "" : "Unable to change workflow state.");
            }}
          >
            Save workflow availability
          </Button>
        </div>
      )}
      {manage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("create");
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            Published webhook version
            <select
              aria-label="Webhook published version"
              value={version || published[0]?.id || ""}
              onChange={(e) => setVersion(e.target.value)}
              className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm"
              required
              disabled={!published.length}
            >
              <option value="" disabled>
                Select a published webhook version
              </option>
              {published.map((v) => (
                <option key={v.id} value={v.id}>
                  Published version {v.number}
                </option>
              ))}
            </select>
          </label>
          {!published.length && (
            <p className="text-xs">
              Save and publish a workflow with a Webhook Trigger, then return
              here.
            </p>
          )}
          <Button disabled={busy || !published.length}>
            Generate signed webhook
          </Button>
        </form>
      )}
      {secret && (
        <div className="space-y-3 rounded-xl bg-amber-50 p-4">
          <p className="text-sm font-semibold">
            Save this signing secret now. It is shown only in this creation or
            rotation response.
          </p>
          <input
            aria-label="New webhook signing secret"
            readOnly
            value={secret}
          />
          <Button variant="outline" onClick={() => setSecret("")}>
            Dismiss secret
          </Button>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Signature instructions
        </summary>
        <p className="mt-3 text-xs leading-6">
          POST application/json. Set X-FlowPilot-Timestamp to Unix seconds and
          X-FlowPilot-Delivery-Id to a unique 8–100 character identifier
          (letters, numbers, underscores, hyphens). Set X-FlowPilot-Signature to
          v1= followed by lowercase hex HMAC-SHA256 of the exact bytes
          v1.TIMESTAMP.DELIVERY_ID. followed by the raw JSON body. Use the
          displayed secret as the UTF-8 HMAC key. Timestamp must be within five
          minutes. Never reuse a delivery ID. Maximum body: 16 KiB; maximum
          rate: 60 requests per minute per endpoint. A 202 response means
          queued, not completed.
        </p>
      </details>
      {hooks.map((h) => (
        <article key={h.id} className="space-y-3 rounded-xl border p-4">
          <p className="text-xs font-semibold">
            {h.revokedAt ? "REVOKED" : h.enabled ? "ENABLED" : "DISABLED"} ·
            Revision {h.revision}
          </p>
          <input
            aria-label="Webhook endpoint URL"
            readOnly
            value={h.endpoint}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigator.clipboard.writeText(h.endpoint)}
          >
            Copy URL
          </Button>
          <p className="break-all text-xs">Version: {h.versionId}</p>
          {manage && !h.revokedAt && (
            <div className="flex flex-wrap gap-2">
              {[
                "rotate",
                "rotate-key",
                h.enabled ? "disable" : "enable",
                "revoke",
              ].map((a) => (
                <Button
                  key={a}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => act(a, h)}
                >
                  {a === "rotate"
                    ? "Rotate signing secret"
                    : a === "rotate-key"
                      ? "Rotate storage key"
                      : a === "revoke"
                        ? "Revoke webhook"
                        : a === "disable"
                          ? "Disable webhook"
                          : "Enable webhook"}
                </Button>
              ))}
            </div>
          )}
          <h3 className="text-sm font-semibold">Recent deliveries</h3>
          {h.deliveries.length ? (
            h.deliveries.map((d) => (
              <p key={d.id} className="text-xs">
                <a className="underline" href={`/history/${d.run.id}`}>
                  {d.run.status}
                </a>{" "}
                · {d.createdAt}
                {d.run.error ? ` · ${d.run.error}` : ""}
              </p>
            ))
          ) : (
            <p className="text-xs">No accepted deliveries.</p>
          )}
          <details>
            <summary className="text-xs">Sanitized delivery audit</summary>
            {h.audit.map((a, i) => (
              <p className="mt-2 text-xs" key={i}>
                {a.code} · {a.createdAt}
              </p>
            ))}
          </details>
        </article>
      ))}
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    </section>
  );
}
