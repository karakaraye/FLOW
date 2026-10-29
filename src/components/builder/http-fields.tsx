"use client";
import { useEffect, useState } from "react";
import type { Data } from "@/lib/engine/definition";
export function HttpFields({
  workspaceId,
  value,
  onChange,
  disabled,
  onValidityChange,
}: {
  workspaceId: string;
  value: Data;
  onChange: (v: Data) => void;
  disabled: boolean;
  onValidityChange: (valid: boolean) => void;
}) {
  const [connections, setConnections] = useState<
    { id: string; label: string }[]
  >([]);
  const [headers, setHeaders] = useState(
      JSON.stringify(value.headers ?? {}, null, 2),
    ),
    [body, setBody] = useState(JSON.stringify(value.body ?? {}, null, 2)),
    [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/workspaces/${workspaceId}/integrations`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) =>
        setConnections(
          rows.filter(
            (r: { providerId: string; status: string }) =>
              r.providerId === "https-bearer" && r.status === "CONNECTED",
          ),
        ),
      )
      .catch(() => setConnections([]));
  }, [workspaceId]);
  useEffect(() => {
    try {
      JSON.parse(headers);
      if (value.method !== "GET") JSON.parse(body);
      onValidityChange(true);
    } catch {
      onValidityChange(false);
    }
  }, [headers, body, value.method, onValidityChange]);
  function field(k: string, v: Data[string]) {
    onChange({ ...value, [k]: v });
  }
  const style = "w-full rounded-lg border border-border bg-white p-2 text-xs";
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-xs font-semibold">Secure HTTP action</legend>
      <p className="text-xs leading-6">
        Call an administrator-approved public HTTPS service. Store tokens in an
        HTTPS Bearer Connection in Integrations. Never paste secrets into a URL,
        header, or body.
      </p>
      <label className="block text-xs">
        Method
        <select
          aria-label="HTTP method"
          className={style}
          value={String(value.method)}
          onChange={(e) => {
            const next: Data = { ...value, method: e.target.value };
            if (e.target.value === "GET") {
              delete next.body;
              delete next.bodyFromInput;
            }
            onChange(next);
          }}
        >
          {["GET", "POST", "PATCH", "PUT"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        HTTPS URL
        <input
          aria-label="HTTP URL"
          value={String(value.url ?? "")}
          onChange={(e) => field("url", e.target.value)}
        />
      </label>
      <label className="block text-xs">
        Connection
        <select
          aria-label="HTTP connection"
          className={style}
          value={String(value.connectionId ?? "")}
          onChange={(e) => {
            const next = { ...value };
            if (e.target.value) next.connectionId = e.target.value;
            else delete next.connectionId;
            onChange(next);
          }}
        >
          <option value="">No authentication</option>
          {connections.map((c) => (
            <option value={c.id} key={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        Approved headers (JSON)
        <textarea
          aria-label="HTTP headers"
          className={style}
          value={headers}
          rows={3}
          onChange={(e) => {
            setHeaders(e.target.value);
            try {
              field("headers", JSON.parse(e.target.value));
              setError("");
            } catch {
              setError("Enter valid header JSON before applying.");
            }
          }}
        />
      </label>
      <p className="text-[10px]">
        Allowed: Accept, Content-Type, X-Requested-With, X-Client-Version.
      </p>
      {value.method !== "GET" && (
        <>
          <label className="block text-xs">
            JSON body
            <textarea
              aria-label="HTTP body"
              className={style}
              value={body}
              rows={4}
              onChange={(e) => {
                setBody(e.target.value);
                try {
                  field("body", JSON.parse(e.target.value));
                  setError("");
                } catch {
                  setError("Enter valid body JSON before applying.");
                }
              }}
            />
          </label>
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4! w-4! shrink-0 p-0! accent-teal-700"
              checked={Boolean(value.bodyFromInput)}
              onChange={(e) => field("bodyFromInput", e.target.checked)}
            />
            Use incoming node data as the body
          </label>
        </>
      )}
      <label className="block text-xs">
        Timeout (milliseconds)
        <input
          aria-label="HTTP timeout"
          type="number"
          min={100}
          max={10000}
          value={Number(value.timeoutMs)}
          onChange={(e) => field("timeoutMs", Number(e.target.value))}
        />
      </label>
      <label className="block text-xs">
        Maximum attempts (1–3)
        <input
          aria-label="HTTP attempts"
          type="number"
          min={1}
          max={3}
          value={Number(value.maxAttempts ?? 1)}
          onChange={(e) => field("maxAttempts", Number(e.target.value))}
        />
      </label>
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          className="h-4! w-4! shrink-0 p-0! accent-teal-700"
          checked={Boolean(value.retrySafe)}
          onChange={(e) => field("retrySafe", e.target.checked)}
        />
        Destination supports idempotency keys
      </label>
      <p className="text-[10px] leading-5">
        GET may retry. Other methods retry only when an administrator also
        approves the destination’s idempotency guarantee. An unknown remote
        outcome is recorded explicitly.
      </p>
      <label className="block text-xs">
        Response field (optional dotted path)
        <input
          aria-label="HTTP response mapping"
          value={String(value.responsePath ?? "")}
          onChange={(e) => {
            const next = { ...value };
            if (e.target.value) next.responsePath = e.target.value;
            else delete next.responsePath;
            onChange(next);
          }}
        />
      </label>
      <p className="text-[10px]">
        Next nodes receive {"{status, data}"}. Leave blank for the complete JSON
        response. Execution history records shapes, not response values.
      </p>
      <p role="alert" className="text-xs text-red-700">
        {error}
      </p>
    </fieldset>
  );
}
