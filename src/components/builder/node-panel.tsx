"use client";
import { WhatsAppFields } from "./whatsapp-fields";
import { isWhatsAppType } from "@/lib/whatsapp/config";
import { AIFields } from "./ai-fields";
import { isAIType } from "@/lib/ai/config";
import { GoogleFields } from "./google-fields";
import { isGoogleType } from "@/lib/google/config";
import { HttpFields } from "./http-fields";
import { useState } from "react";
import type { WorkflowNode, Data, Json } from "@/lib/engine/definition";
import { Button } from "../ui/button";
import { nodeTitles } from "@/lib/builder/document";
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
  const [path, setPath] = useState(String(node.config.path ?? ""));
  const [operator, setOperator] = useState(
    String(node.config.operator ?? "equals"),
  );
  const [operand, setOperand] = useState(
    JSON.stringify(node.config.value ?? null),
  );
  const [message, setMessage] = useState(String(node.config.message ?? ""));
  const [httpValid, setHttpValid] = useState(true);
  const [http, setHttp] = useState<Data>(node.config);
  const [error, setError] = useState("");
  function dirty() {
    onDirty(true);
    setError("");
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
        <p className="text-xs leading-6">
          Publish this workflow, then use Webhook setup below the builder to
          create a signed endpoint. Adding this trigger replaces the manual
          trigger.
        </p>
      )}
      {node.type === "set_data" && (
        <div>
          <label
            htmlFor="node-values"
            className="mb-1 block text-xs font-medium"
          >
            Set Data values (JSON object)
          </label>
          <textarea
            id="node-values"
            className={area}
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
        <>
          <div>
            <label
              htmlFor="condition-path"
              className="mb-1 block text-xs font-medium"
            >
              Input field path
            </label>
            <input
              id="condition-path"
              value={path}
              disabled={readOnly}
              onChange={(e) => {
                setPath(e.target.value);
                dirty();
              }}
              placeholder="customer.score"
            />
          </div>
          <div>
            <label
              htmlFor="condition-operator"
              className="mb-1 block text-xs font-medium"
            >
              Comparison operator
            </label>
            <select
              id="condition-operator"
              value={operator}
              disabled={readOnly}
              onChange={(e) => {
                setOperator(e.target.value);
                dirty();
              }}
              className="w-full rounded-lg border border-border bg-white p-2 text-sm"
            >
              {["equals", "not_equals", "gt", "exists"].map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>
          {operator !== "exists" && (
            <div>
              <label
                htmlFor="condition-value"
                className="mb-1 block text-xs font-medium"
              >
                Comparison value (literal JSON)
              </label>
              <textarea
                id="condition-value"
                className={area}
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
        </>
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
