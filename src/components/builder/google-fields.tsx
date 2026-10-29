"use client";
import { useEffect, useState } from "react";
import type { Data, NodeType } from "@/lib/engine/definition";
export function GoogleFields({
  workspaceId,
  type,
  value,
  onChange,
  disabled,
  onValidityChange,
}: {
  workspaceId: string;
  type: NodeType;
  value: Data;
  onChange: (c: Data) => void;
  disabled: boolean;
  onValidityChange: (v: boolean) => void;
}) {
  const gmail = type === "gmail_send_email";
  const [connections, setConnections] = useState<
      { id: string; label: string; accountEmail: string }[]
    >([]),
    [values, setValues] = useState(
      JSON.stringify(value.values ?? [""], null, 2),
    ),
    [paths, setPaths] = useState(
      JSON.stringify(value.valuePaths ?? [null], null, 2),
    ),
    [maps, setMaps] = useState(JSON.stringify(value.mappings ?? {}, null, 2));
  useEffect(() => {
    void fetch(`/api/workspaces/${workspaceId}/integrations`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) =>
        setConnections(
          rows.filter(
            (r: { providerId: string; status: string }) =>
              r.providerId === (gmail ? "gmail" : "google-sheets") &&
              r.status === "CONNECTED",
          ),
        ),
      )
      .catch(() => setConnections([]));
  }, [workspaceId, gmail]);
  useEffect(() => {
    try {
      if (gmail) JSON.parse(maps);
      else {
        JSON.parse(values);
        JSON.parse(paths);
      }
      onValidityChange(true);
    } catch {
      onValidityChange(false);
    }
  }, [gmail, maps, values, paths, onValidityChange]);
  function field(k: string, v: Data[string]) {
    onChange({ ...value, [k]: v });
  }
  const cls =
    "mt-1 w-full rounded-lg border border-border bg-white p-2 font-mono text-xs";
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="text-xs font-semibold">
        {gmail ? "Send a plain-text email" : "Google Sheets operation"}
      </legend>
      <label className="block text-xs">
        Google connection
        <select
          aria-label="Google node connection"
          className={cls}
          value={String(value.connectionId ?? "")}
          onChange={(e) => field("connectionId", e.target.value)}
        >
          <option value="">Choose a verified connection</option>
          {connections.map((c) => (
            <option value={c.id} key={c.id}>
              {c.label} · {c.accountEmail}
            </option>
          ))}
        </select>
      </label>
      {!connections.length && (
        <p className="text-xs leading-6">
          No connected {gmail ? "Gmail" : "Google Sheets"} account. Connect it
          in Integrations first. OAuth must be configured by your operator.
        </p>
      )}
      {gmail ? (
        <>
          <label className="block text-xs">
            To (comma-separated, at most 10)
            <input
              aria-label="Gmail recipients"
              value={((value.to as string[]) ?? []).join(", ")}
              onChange={(e) =>
                field(
                  "to",
                  e.target.value.split(",").map((v) => v.trim()),
                )
              }
            />
          </label>
          <label className="block text-xs">
            Subject
            <input
              aria-label="Gmail subject"
              value={String(value.subject ?? "")}
              onChange={(e) => field("subject", e.target.value)}
            />
          </label>
          <label className="block text-xs">
            Plain-text body
            <textarea
              aria-label="Gmail body"
              className={cls}
              rows={5}
              value={String(value.body ?? "")}
              onChange={(e) => field("body", e.target.value)}
            />
          </label>
          <label className="block text-xs">
            Variable mappings (JSON)
            <textarea
              aria-label="Gmail mappings"
              className={cls}
              rows={3}
              value={maps}
              onChange={(e) => {
                setMaps(e.target.value);
                try {
                  field("mappings", JSON.parse(e.target.value));
                } catch {
                  /* Apply is blocked until JSON is valid. */
                }
              }}
            />
          </label>
          <p className="text-[10px] leading-5">
            Example:{" "}
            {'{"subject":"customer.subject","body":"customer.message"}'}. Paths
            read incoming node data. Recipients are explicit and must be
            approved by the operator. No attachments or HTML are supported.
            Writes and sends are never retried after an uncertain outcome.
          </p>
        </>
      ) : (
        <>
          <label className="block text-xs">
            Spreadsheet ID
            <input
              aria-label="Sheets spreadsheet ID"
              value={String(value.spreadsheetId ?? "")}
              onChange={(e) => field("spreadsheetId", e.target.value)}
            />
          </label>
          <label className="block text-xs">
            Sheet and A1 range
            <input
              aria-label="Sheets range"
              value={String(value.range ?? "")}
              onChange={(e) => field("range", e.target.value)}
            />
          </label>
          <p className="text-[10px]">
            Read: Sheet1!A1:D100. Writes target one row, for example
            Sheet1!A1:D1. Values use RAW input, avoiding formula interpretation.
          </p>
          {type !== "google_sheets_read_rows" && (
            <>
              <label className="block text-xs">
                Column values (JSON array)
                <textarea
                  aria-label="Sheets values"
                  className={cls}
                  rows={3}
                  value={values}
                  onChange={(e) => {
                    setValues(e.target.value);
                    try {
                      field("values", JSON.parse(e.target.value));
                    } catch {
                      /* Apply blocked. */
                    }
                  }}
                />
              </label>
              <label className="block text-xs">
                Column input paths (JSON array)
                <textarea
                  aria-label="Sheets mappings"
                  className={cls}
                  rows={3}
                  value={paths}
                  onChange={(e) => {
                    setPaths(e.target.value);
                    try {
                      field("valuePaths", JSON.parse(e.target.value));
                    } catch {
                      /* Apply blocked. */
                    }
                  }}
                />
              </label>
              <p className="text-[10px]">
                Use one null (literal) or input field path per column. Example:
                {'["customer.name", null]'}. No columns or spreadsheets are
                deleted.
              </p>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
