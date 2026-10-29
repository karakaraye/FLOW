"use client";
import { useState } from "react";
import { Button } from "../ui/button";
export function HttpCredentialForm({
  url,
  revision,
  onSaved,
}: {
  url: string;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const [token, setToken] = useState(""),
    [healthUrl, setHealthUrl] = useState(""),
    [expires, setExpires] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="my-6 space-y-3 rounded-xl border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const r = await fetch(url + "/http-credential", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              revision,
              token,
              healthUrl,
              expiresAt: new Date(expires).toISOString(),
            }),
          });
          setToken("");
          const data = await r.json();
          if (!r.ok) throw Error(data.error);
          await onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Verification failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-semibold">
        Verify a destination-bound bearer credential
      </h3>
      <p className="text-xs leading-6">
        Your administrator must first approve the HTTPS origin. We send a GET to
        this verification URL and store the token only after a successful JSON
        response. The token can then be used only for this exact origin. Use a
        read-only verification endpoint.
      </p>
      <label className="block text-xs">
        Verification HTTPS URL
        <input
          required
          type="url"
          value={healthUrl}
          onChange={(e) => setHealthUrl(e.target.value)}
        />
      </label>
      <label className="block text-xs">
        Bearer token
        <input
          required
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label className="block text-xs">
        Credential expiry (within 90 days)
        <input
          required
          type="datetime-local"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
      </label>
      <Button disabled={busy}>Verify and encrypt credential</Button>
      <p role="alert" className="text-xs text-red-700">
        {error}
      </p>
    </form>
  );
}
