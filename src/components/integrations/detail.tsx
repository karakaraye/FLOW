"use client";
import { GoogleControls } from "./google-controls";
import { HttpCredentialForm } from "./http-credential-form";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { AuditList, type ConnectionView, type EventView } from "./catalog";
export function ConnectionDetail({
  initial,
  initialEvents,
  role,
}: {
  initial: ConnectionView;
  initialEvents: EventView[];
  role: string;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState(initial);
  const [events, setEvents] = useState(initialEvents);
  const [name, setName] = useState(initial.label);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const canManage = ["OWNER", "ADMIN"].includes(role);
  const url = `/api/workspaces/${connection.workspaceId}/integrations/${connection.id}`;
  async function reload() {
    const [metadata, audit] = await Promise.all([
      fetch(url, { cache: "no-store" }),
      fetch(
        `/api/workspaces/${connection.workspaceId}/integration-events?integrationId=${connection.id}`,
        { cache: "no-store" },
      ),
    ]);
    if (metadata.ok) {
      const data = await metadata.json();
      setConnection(data);
      setName(data.label);
    }
    if (audit.ok) setEvents(await audit.json());
  }
  async function action(kind: string) {
    if (busy.current) return;
    if (
      kind === "delete" &&
      !window.confirm(
        "Remove this connection record and erase local credentials? Sanitized audit history is retained. No external provider revocation is performed.",
      )
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const path =
        kind === "label" || kind === "delete" ? url : `${url}/${kind}`;
      const response = await fetch(path, {
        method:
          kind === "label" ? "PATCH" : kind === "delete" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: connection.revision,
          ...(kind === "label" ? { label: name } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        await reload();
        throw new Error(data.error ?? "Integration operation failed.");
      }
      if (kind === "delete") {
        router.push("/integrations");
        router.refresh();
        return;
      }
      setConnection(data);
      setName(data.label);
      await reload();
      setMessage(
        kind === "revoke"
          ? "Local access revoked and encrypted credential material erased."
          : kind === "test/complete"
            ? "Local test authentication verified. No third-party service was connected."
            : "Connection updated.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Request failed. Reload the connection before retrying.",
      );
    } finally {
      setPending(false);
      busy.current = false;
    }
  }
  const hasUsableSecret =
    connection.hasCredential &&
    ["CONNECTED", "EXPIRED", "ERROR"].includes(connection.status);
  return (
    <>
      <section className="mt-7 rounded-2xl border border-border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="break-words text-2xl font-semibold">
              {connection.label}
            </h1>
            <p className="mt-2 text-sm text-stone-500">
              {connection.provider.name} ·{" "}
              {connection.provider.authMethod.replaceAll("_", " ")}
            </p>
          </div>
          <span
            className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800"
            data-testid="connection-status"
          >
            {connection.status}
          </span>
        </div>
        <p
          className={`mt-5 rounded-xl p-4 text-sm leading-7 ${connection.testOnly ? "bg-amber-50 text-amber-900" : "bg-stone-50 text-stone-600"}`}
        >
          {connection.testOnly
            ? "LOCAL TEST ONLY. This provider validates signed local test credentials. It is not OAuth and does not authenticate Gmail, WhatsApp, or any third-party service."
            : connection.googleAvailable
              ? "Google OAuth connection. Account identity and permissions are verified before connection; no local test adapter is used."
              : connection.providerId === "https-bearer"
                ? "HTTPS action credentials are verified against an approved public origin and encrypted server-side. No stored token is returned by read APIs."
                : "Coming Soon. This is a disconnected metadata record; external authentication and provider actions are not implemented."}
        </p>
        <dl className="mt-6 grid gap-4 text-xs sm:grid-cols-2">
          {[
            ["Revision", String(connection.revision)],
            [
              "Credential storage",
              connection.hasCredential
                ? "Authenticated encryption · values never displayed"
                : "No usable credential stored",
            ],
            ["Last verified", connection.lastVerifiedAt ?? "Not verified"],
            ["Credential expiry", connection.expiresAt ?? "Not available"],
            ["Revoked at", connection.revokedAt ?? "Not revoked"],
            ["Pending until", connection.authExpiresAt ?? "No pending attempt"],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="font-semibold text-stone-500">{term}</dt>
              <dd className="mt-1 break-words leading-6">{value}</dd>
            </div>
          ))}
        </dl>
        {connection.lastErrorCode && (
          <p className="mt-4 text-xs text-amber-800">
            Last verified error code: {connection.lastErrorCode}
          </p>
        )}
      </section>
      {["gmail", "google-sheets"].includes(connection.providerId) && (
        <GoogleControls
          connection={connection}
          canManage={canManage}
          reload={reload}
        />
      )}
      {connection.providerId === "https-bearer" && canManage && (
        <HttpCredentialForm
          url={url}
          revision={connection.revision}
          onSaved={reload}
        />
      )}
      <section className="mt-6 rounded-2xl border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Connection controls</h2>
        <label
          htmlFor="connection-label"
          className="mt-5 mb-2 block text-xs font-semibold"
        >
          Display label (non-secret metadata)
        </label>
        <input
          id="connection-label"
          value={name}
          maxLength={80}
          disabled={!canManage || pending}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="mt-2 text-[10px] leading-5 text-stone-500">
          Do not put tokens, API keys, or secrets in display labels.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || name === connection.label}
                onClick={() => action("label")}
              >
                Save display label
              </Button>
              {connection.testOnly && (
                <>
                  <Button
                    size="sm"
                    disabled={
                      pending ||
                      !connection.operationsAvailable ||
                      connection.status === "PENDING"
                    }
                    onClick={() => action("test/start")}
                  >
                    Start local test
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      pending ||
                      !connection.operationsAvailable ||
                      connection.status !== "PENDING"
                    }
                    onClick={() => action("test/complete")}
                  >
                    Complete local test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      pending ||
                      !connection.operationsAvailable ||
                      !hasUsableSecret
                    }
                    onClick={() => action("health")}
                  >
                    Verify connection health
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      pending ||
                      !connection.operationsAvailable ||
                      !hasUsableSecret
                    }
                    onClick={() => action("refresh")}
                  >
                    Refresh test credential
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={
                  pending ||
                  (!connection.hasCredential && connection.status !== "PENDING")
                }
                onClick={() => action("rotate-key")}
              >
                Rotate to active storage key
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || connection.status === "REVOKED"}
                onClick={() => action("revoke")}
              >
                Revoke local access
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => action("delete")}
              >
                Remove connection
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              void reload().catch(() =>
                setError("Could not reload connection metadata."),
              );
            }}
          >
            Reload metadata
          </Button>
        </div>
        {!canManage && (
          <p className="mt-4 text-sm text-stone-500">
            {role} · Metadata-only access. Only OWNER and ADMIN may manage
            connections.
          </p>
        )}
        <p role="status" className="mt-5 text-sm text-teal-800">
          {pending ? "Working…" : message}
        </p>
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      </section>
      <AuditList events={events} />
    </>
  );
}
