"use client";
import { useState } from "react";
import { Button } from "../ui/button";
import type { ConnectionView } from "./catalog";
export function GoogleControls({
  connection,
  canManage,
  reload,
}: {
  connection: ConnectionView;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function action(kind: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(
        `/api/workspaces/${connection.workspaceId}/integrations/${connection.id}/google/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: connection.revision }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (kind === "start") {
        window.location.assign(data.authorizationUrl);
        return;
      }
      await reload();
      setMessage(
        kind === "disconnect"
          ? `Local access removed. Google revocation: ${data.remoteRevocation}.`
          : "Google credential refreshed.",
      );
    } catch (e) {
      await reload();
      setMessage(e instanceof Error ? e.message : "Google operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-6 space-y-4 rounded-xl border border-border bg-white p-5">
      <h2 className="text-lg font-semibold">Google authorization</h2>
      <p className="text-sm">
        {connection.googleAvailable
          ? "Connect your Google account through Google’s consent screen. Only the permissions for this provider are requested. Tokens remain encrypted on the server."
          : "Google OAuth is not configured by the operator. Live Google authorization is unavailable; this is not a simulated connection."}
      </p>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="font-semibold">Authorized account</dt>
          <dd>{connection.accountEmail ?? "No verified Google account"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Granted permissions</dt>
          <dd className="break-all">
            {connection.scopes.length
              ? connection.scopes.join(", ")
              : "No permissions granted"}
          </dd>
        </div>
      </dl>
      {canManage && (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || !connection.googleAvailable}
            onClick={() => action("start")}
          >
            {connection.hasCredential
              ? "Reconnect Google account"
              : "Connect Google account"}
          </Button>
          <Button
            variant="outline"
            disabled={
              busy || !connection.googleAvailable || !connection.hasCredential
            }
            onClick={() => action("refresh")}
          >
            Refresh Google authorization
          </Button>
          <Button
            variant="outline"
            disabled={busy || connection.status === "REVOKED"}
            onClick={() => action("disconnect")}
          >
            Disconnect Google account
          </Button>
        </div>
      )}
      <p className="text-xs leading-6">
        Sheets permission covers spreadsheets you can access; no Drive-wide
        scope is requested. Gmail requests send-only access, not inbox reading.
        Email sends require operator approval of recipients. Disconnecting a
        Google grant can affect other connections using that grant.
      </p>
      <p role="status" className="text-xs">
        {message}
      </p>
    </section>
  );
}
