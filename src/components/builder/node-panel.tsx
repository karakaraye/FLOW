"use client";
import { WhatsAppFields } from "./whatsapp-fields";
import { isWhatsAppType } from "@/lib/whatsapp/config";
import { AIFields } from "./ai-fields";
import { isAIType } from "@/lib/ai/config";
import { GoogleFields } from "./google-fields";
import { isGoogleType } from "@/lib/google/config";
import { HttpFields } from "./http-fields";
import { useState, useId } from "react";
import type { WorkflowNode, Data, Json } from "@/lib/engine/definition";
import { Button } from "../ui/button";
import { nodeTitles } from "@/lib/builder/document";
import { VariablePicker } from "./variable-picker";
import { Plus, Trash2, Code2, SlidersHorizontal, Sparkles, HelpCircle } from "lucide-react";

type KVRow = {
  id: string;
  key: string;
  type: "string" | "number" | "boolean";
  value: string;
};

function parseInitialKV(raw: unknown): KVRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return [];
  return entries.map(([k, v], i) => {
    let type: "string" | "number" | "boolean" = "string";
    let valStr = "";
    if (typeof v === "number") {
      type = "number";
      valStr = String(v);
    } else if (typeof v === "boolean") {
      type = "boolean";
      valStr = String(v);
    } else {
      type = "string";
      valStr = typeof v === "string" ? v : JSON.stringify(v);
    }
    return {
      id: `row_${i}_${k}`,
      key: k,
      type,
      value: valStr,
    };
  });
}

function parseInitialConditionValue(rawVal: unknown): {
  type: "string" | "number" | "boolean";
  value: string;
} {
  if (typeof rawVal === "number") return { type: "number", value: String(rawVal) };
  if (typeof rawVal === "boolean") return { type: "boolean", value: String(rawVal) };
  if (typeof rawVal === "string") return { type: "string", value: rawVal };
  return { type: "string", value: "" };
}

export function NodePanel({
  node,
  workspaceId = "",
  label,
  readOnly,
  onApply,
  onDirty,
}: {
  node: WorkflowNode;
  workspaceId?: string;
  label: string;
  readOnly: boolean;
  onApply: (label: string, config: Data) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(label);
  const [values, setValues] = useState(
    JSON.stringify(node.config.values ?? {}, null, 2),
  );
  const [setDataMode, setSetDataMode] = useState<"visual" | "json">("visual");
  const [kvRows, setKvRows] = useState<KVRow[]>(() =>
    parseInitialKV(node.config.values),
  );

  const [path, setPath] = useState(String(node.config.path ?? ""));
  const [operator, setOperator] = useState(
    String(node.config.operator ?? "equals"),
  );
  const [operand, setOperand] = useState(
    JSON.stringify(node.config.value ?? null),
  );
  const [conditionMode, setConditionMode] = useState<"visual" | "json">("visual");
  const [condType, setCondType] = useState<"string" | "number" | "boolean">(
    () => parseInitialConditionValue(node.config.value).type,
  );
  const [condVal, setCondVal] = useState<string>(
    () => parseInitialConditionValue(node.config.value).value,
  );

  const [message, setMessage] = useState(String(node.config.message ?? ""));
  const [httpValid, setHttpValid] = useState(true);
  const [http, setHttp] = useState<Data>(node.config);
  const [error, setError] = useState("");
  const [showHelper, setShowHelper] = useState(false);

  function dirty() {
    onDirty(true);
    setError("");
  }

  function syncRowsToValues(updatedRows: KVRow[]) {
    setKvRows(updatedRows);
    const obj: Record<string, unknown> = {};
    for (const r of updatedRows) {
      const k = r.key.trim();
      if (!k) continue;
      if (r.type === "number") {
        const num = Number(r.value);
        obj[k] = isNaN(num) ? 0 : num;
      } else if (r.type === "boolean") {
        obj[k] = r.value === "true";
      } else {
        obj[k] = r.value;
      }
    }
    setValues(JSON.stringify(obj, null, 2));
    dirty();
  }

  function handleAddRow() {
    const newRow: KVRow = {
      id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      key: "",
      type: "string",
      value: "",
    };
    syncRowsToValues([...kvRows, newRow]);
  }

  function handleRemoveRow(id: string) {
    syncRowsToValues(kvRows.filter((r) => r.id !== id));
  }

  function handleUpdateRow(id: string, updates: Partial<KVRow>) {
    syncRowsToValues(
      kvRows.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  }

  function handleConditionValChange(newVal: string, newType = condType) {
    setCondVal(newVal);
    setCondType(newType);
    if (newType === "number") {
      const num = Number(newVal);
      setOperand(JSON.stringify(isNaN(num) ? 0 : num));
    } else if (newType === "boolean") {
      setOperand(newVal === "true" ? "true" : "false");
    } else {
      setOperand(JSON.stringify(newVal));
    }
    dirty();
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (
        (node.type === "http_request" ||
          isGoogleType(node.type) ||
          isAIType(node.type) ||
          isWhatsAppType(node.type)) &&
        !httpValid
      )
        throw new Error("Enter valid configuration JSON before applying.");
      const config: Data =
        node.type === "http_request" ||
        isGoogleType(node.type) ||
        isAIType(node.type) ||
        isWhatsAppType(node.type)
          ? http
          : node.type === "set_data"
            ? { values: JSON.parse(values) as Json }
            : node.type === "condition"
              ? {
                  path,
                  operator,
                  ...(operator === "exists"
                    ? {}
                    : { value: JSON.parse(operand) as Json }),
                }
              : node.type === "log_event"
                ? { message }
                : {};
      if (!name.trim() || name.trim().length > 80)
        throw new Error("Use a label of 1–80 characters.");
      onApply(name.trim(), config);
      onDirty(false);
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "Enter valid literal JSON. Strings need double quotes."
          : cause instanceof Error
            ? cause.message
            : "Invalid configuration.",
      );
    }
  }

  const area =
    "w-full rounded-lg border border-border bg-white p-3 font-mono text-xs leading-5 disabled:bg-stone-50";

  return (
    <form onSubmit={apply} className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">
          {nodeTitles[node.type] ?? "Unsupported node"}
        </h3>
        <p className="mt-1 break-all font-mono text-[10px] text-stone-500">
          ID: {node.id} (preserved)
        </p>
      </div>

      <div>
        <label htmlFor="node-label" className="mb-1 block text-xs font-medium">
          Node label
        </label>
        <input
          id="node-label"
          className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-stone-800 disabled:bg-stone-50"
          value={name}
          maxLength={80}
          disabled={readOnly}
          onChange={(e) => {
            setName(e.target.value);
            dirty();
          }}
        />
      </div>

      {isWhatsAppType(node.type) && (
        <WhatsAppFields
          workspaceId={workspaceId}
          type={node.type}
          value={http}
          disabled={readOnly}
          onValidityChange={setHttpValid}
          onChange={(v) => {
            setHttp(v);
            dirty();
          }}
        />
      )}

      {isAIType(node.type) && (
        <AIFields
          workspaceId={workspaceId}
          type={node.type}
          value={http}
          disabled={readOnly}
          onValidityChange={setHttpValid}
          onChange={(v) => {
            setHttp(v);
            dirty();
          }}
        />
      )}

      {isGoogleType(node.type) && (
        <GoogleFields
          type={node.type}
          workspaceId={workspaceId}
          value={http}
          disabled={readOnly}
          onValidityChange={setHttpValid}
          onChange={(v) => {
            setHttp(v);
            dirty();
          }}
        />
      )}

      {node.type === "http_request" && (
        <HttpFields
          onValidityChange={setHttpValid}
          workspaceId={workspaceId}
          value={http}
          disabled={readOnly}
          onChange={(v) => {
            setHttp(v);
            dirty();
          }}
        />
      )}

      {node.type === "webhook_trigger" && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 text-xs leading-5 text-teal-900">
          <p className="font-semibold text-teal-950">Incoming Webhook Trigger</p>
          <p className="mt-1 text-[11px] text-teal-800">
            Publish this workflow, then use the Webhook setup below the builder to
            create a signed endpoint. Adding this trigger replaces the manual
            trigger.
          </p>
        </div>
      )}

      {node.type === "manual_trigger" && (
        <div className="rounded-xl border border-stone-200 bg-stone-100/60 p-3 text-xs leading-5 text-stone-700">
          <p className="font-semibold text-stone-900">Manual Execution</p>
          <p className="mt-1 text-[11px]">
            Starts this workflow when you or a teammate click <strong>Run workflow</strong> or send a test payload.
          </p>
        </div>
      )}

      {node.type === "set_data" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label
              htmlFor="node-values"
              className="text-xs font-semibold text-stone-900"
            >
              Set Data values
            </label>
            <div className="flex rounded-md border border-border bg-stone-100 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(values);
                    setKvRows(parseInitialKV(parsed));
                  } catch {}
                  setSetDataMode("visual");
                }}
                className={`rounded px-2 py-0.5 font-medium transition ${
                  setDataMode === "visual"
                    ? "bg-white text-teal-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Visual (No-Code)
              </button>
              <button
                type="button"
                onClick={() => setSetDataMode("json")}
                className={`rounded px-2 py-0.5 font-medium transition ${
                  setDataMode === "json"
                    ? "bg-white text-teal-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Raw JSON
              </button>
            </div>
          </div>

          {setDataMode === "visual" ? (
            <div className="space-y-2">
              <p className="text-[11px] text-stone-500">
                Add fields to pass into downstream steps. Values are formatted automatically.
              </p>
              {kvRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-stone-500">
                  No fields yet. Click <strong>+ Add Field</strong> below.
                </div>
              ) : (
                <div className="space-y-2">
                  {kvRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-white p-1.5 shadow-xs"
                    >
                      <input
                        placeholder="Field name"
                        disabled={readOnly}
                        value={row.key}
                        onChange={(e) =>
                          handleUpdateRow(row.id, { key: e.target.value })
                        }
                        className="w-1/3 rounded border border-border px-2 py-1 text-xs"
                      />
                      <select
                        disabled={readOnly}
                        value={row.type}
                        onChange={(e) =>
                          handleUpdateRow(row.id, {
                            type: e.target.value as "string" | "number" | "boolean",
                            value:
                              e.target.value === "boolean"
                                ? "true"
                                : e.target.value === "number"
                                  ? "0"
                                  : row.value,
                          })
                        }
                        className="rounded border border-border bg-stone-50 px-1 py-1 text-[11px]"
                      >
                        <option value="string">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">Yes / No</option>
                      </select>
                      {row.type === "boolean" ? (
                        <select
                          disabled={readOnly}
                          value={row.value}
                          onChange={(e) =>
                            handleUpdateRow(row.id, { value: e.target.value })
                          }
                          className="flex-1 rounded border border-border px-2 py-1 text-xs"
                        >
                          <option value="true">True (Yes)</option>
                          <option value="false">False (No)</option>
                        </select>
                      ) : (
                        <input
                          placeholder={
                            row.type === "number" ? "e.g. 100" : "Value or {{data.prop}}"
                          }
                          type={row.type === "number" ? "number" : "text"}
                          disabled={readOnly}
                          value={row.value}
                          onChange={(e) =>
                            handleUpdateRow(row.id, { value: e.target.value })
                          }
                          className="flex-1 rounded border border-border px-2 py-1 text-xs"
                        />
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          className="p-1 text-stone-400 hover:text-red-600"
                          title="Remove field"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="flex items-center gap-1 rounded-md border border-border bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
                >
                  <Plus size={13} /> Add Field
                </button>
              )}
            </div>
          ) : null}

          <textarea
            id="node-values"
            className={`${area} ${setDataMode === "visual" ? "sr-only" : ""}`}
            rows={7}
            value={values}
            disabled={readOnly}
            onChange={(e) => {
              setValues(e.target.value);
              dirty();
            }}
          />
        </div>
      )}

      {node.type === "condition" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-900">
              Condition Rule (If / Else)
            </span>
            <div className="flex rounded-md border border-border bg-stone-100 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setConditionMode("visual")}
                className={`rounded px-2 py-0.5 font-medium transition ${
                  conditionMode === "visual"
                    ? "bg-white text-teal-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Visual
              </button>
              <button
                type="button"
                onClick={() => setConditionMode("json")}
                className={`rounded px-2 py-0.5 font-medium transition ${
                  conditionMode === "json"
                    ? "bg-white text-teal-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Raw JSON
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="condition-path"
              className="mb-1 block text-xs font-medium text-stone-700"
            >
              When this field:
            </label>
            <div className="my-1.5">
              <VariablePicker onSelectVariable={(v) => { setPath(v); dirty(); }} />
            </div>
            <input
              id="condition-path"
              value={path}
              disabled={readOnly}
              onChange={(e) => {
                setPath(e.target.value);
                dirty();
              }}
              placeholder="e.g. status or customer.score"
              className="w-full rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-stone-800 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label
              htmlFor="condition-operator"
              className="mb-1 block text-xs font-medium text-stone-700"
            >
              Matches condition:
            </label>
            <select
              id="condition-operator"
              value={operator}
              disabled={readOnly}
              onChange={(e) => {
                setOperator(e.target.value);
                dirty();
              }}
              className="w-full rounded-lg border border-border bg-white p-2 text-xs"
            >
              <option value="equals">equals (is equal to)</option>
              <option value="not_equals">not_equals (is not equal to)</option>
              <option value="gt">gt (is greater than &gt;)</option>
              <option value="exists">exists (has any value / not empty)</option>
            </select>
          </div>

          {operator !== "exists" && (
            <div>
              <label
                htmlFor="condition-value"
                className="mb-1 block text-xs font-medium text-stone-700"
              >
                Comparison value:
              </label>

              {conditionMode === "visual" ? (
                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <select
                      disabled={readOnly}
                      value={condType}
                      onChange={(e) =>
                        handleConditionValChange(
                          e.target.value === "boolean"
                            ? "true"
                            : e.target.value === "number"
                              ? "0"
                              : condVal,
                          e.target.value as "string" | "number" | "boolean",
                        )
                      }
                      className="rounded border border-border bg-stone-50 px-2 py-1 text-xs"
                    >
                      <option value="string">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Yes / No</option>
                    </select>
                    {condType === "boolean" ? (
                      <select
                        disabled={readOnly}
                        value={condVal}
                        onChange={(e) => handleConditionValChange(e.target.value)}
                        className="flex-1 rounded border border-border px-2 py-1 text-xs"
                      >
                        <option value="true">True (Yes)</option>
                        <option value="false">False (No)</option>
                      </select>
                    ) : (
                      <input
                        type={condType === "number" ? "number" : "text"}
                        placeholder={
                          condType === "number" ? "e.g. 50" : "e.g. active"
                        }
                        disabled={readOnly}
                        value={condVal}
                        onChange={(e) => handleConditionValChange(e.target.value)}
                        className="flex-1 rounded border border-border px-2 py-1 text-xs"
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-stone-500">
                    Text values are quoted automatically behind the scenes.
                  </p>
                </div>
              ) : null}

              <textarea
                id="condition-value"
                className={`${area} ${conditionMode === "visual" ? "sr-only" : "mt-1"}`}
                rows={3}
                value={operand}
                disabled={readOnly}
                onChange={(e) => {
                  setOperand(e.target.value);
                  dirty();
                }}
              />
            </div>
          )}

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-[11px] leading-4 text-stone-600">
            <p className="font-semibold text-stone-800">Branching paths:</p>
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span><strong>TRUE branch</strong>: runs if condition passes</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                <span><strong>FALSE branch</strong>: runs if condition fails</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {node.type === "log_event" && (
        <div>
          <label
            htmlFor="event-message"
            className="mb-1 block text-xs font-medium"
          >
            Event message
          </label>
          <textarea
            id="event-message"
            className={area}
            rows={4}
            value={message}
            maxLength={200}
            disabled={readOnly}
            placeholder="e.g. Customer signed up successfully"
            onChange={(e) => {
              setMessage(e.target.value);
              dirty();
            }}
          />
          <p className="mt-2 text-[10px] leading-5 text-stone-500">
            Saved in the definition; execution audits omit message contents. Do
            not enter secrets.
          </p>
        </div>
      )}

      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowHelper(!showHelper)}
          className="flex items-center gap-1 text-[11px] text-teal-800 hover:underline"
        >
          <HelpCircle size={12} />
          {showHelper ? "Hide variable guide" : "How do I reference step data?"}
        </button>
        {showHelper && (
          <div className="mt-2 rounded-lg border border-border bg-stone-100/70 p-2.5 text-[11px] text-stone-600 leading-5">
            <p className="font-medium text-stone-800">Available references:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li><code className="bg-white px-1 py-0.5 rounded text-[10px]">data.&lt;field&gt;</code> — current workflow data</li>
              <li><code className="bg-white px-1 py-0.5 rounded text-[10px]">steps.&lt;id&gt;.output</code> — result from an earlier step</li>
            </ul>
          </div>
        )}
      </div>

      {!readOnly && (
        <Button type="submit" size="sm" className="w-full">
          Apply configuration
        </Button>
      )}

      <p role="alert" className="text-xs text-red-700">
        {error}
      </p>
    </form>
  );
}

