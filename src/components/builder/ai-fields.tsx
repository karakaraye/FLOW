"use client";
import { useEffect, useState } from "react";
import type { Data, NodeType } from "@/lib/engine/definition";
import { aiTypes } from "@/lib/ai/config";
export const defaultExtraction = {
  type: "object",
  properties: { name: { type: ["string", "null"], maxLength: 200 } },
  required: ["name"],
  additionalProperties: false,
};
export function initialAIConfig(type: string): Data {
  return {
    modelId: "default",
    textPath: "text",
    instructions: "",
    maxOutputTokens: 256,
    ...(type === "ai_classify" ? { categories: ["general", "review"] } : {}),
    ...(["ai_summarize", "ai_generate_text"].includes(type)
      ? { length: "short" }
      : {}),
    ...(type === "ai_extract" ? { schema: defaultExtraction } : {}),
  };
}
export function AIFields({
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
  const [models, setModels] = useState<
      { id: string; model: string; capabilities: string[] }[]
    >([]),
    [schema, setSchema] = useState(
      JSON.stringify(value.schema ?? defaultExtraction, null, 2),
    ),
    [custom, setCustom] = useState(Boolean(value.schema));
  useEffect(() => {
    void fetch(`/api/workspaces/${workspaceId}/ai/models`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setModels)
      .catch(() => setModels([]));
  }, [workspaceId]);
  useEffect(() => {
    try {
      if (custom || type === "ai_extract") JSON.parse(schema);
      onValidityChange(true);
    } catch {
      onValidityChange(false);
    }
  }, [custom, type, schema, onValidityChange]);
  const field = (k: string, v: Data[string]) => onChange({ ...value, [k]: v });
  const cls =
    "mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs";
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="text-xs font-semibold">AI configuration</legend>
      <label className="block text-xs">
        Approved model
        <select
          aria-label="AI approved model"
          className={cls}
          value={String(value.modelId)}
          onChange={(e) => field("modelId", e.target.value)}
        >
          <option value="default">Administrator default</option>
          {models
            .filter((m) => m.capabilities.includes(type))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.model}
              </option>
            ))}
        </select>
      </label>
      {!models.length && (
        <p className="text-xs text-amber-800">
          No approved AI models are configured. An operator must configure the
          OpenAI key, model allowlist, current pricing, and approved origin.
          Draft configuration does not simulate an AI response.
        </p>
      )}
      <label className="block text-xs">
        Source text field path
        <input
          aria-label="AI source path"
          value={String(value.textPath ?? "text")}
          onChange={(e) => field("textPath", e.target.value)}
        />
      </label>
      <p className="text-[10px]">
        Only this text field is sent. Source content is untrusted data; it
        cannot authorize tools or change the graph.
      </p>
      <label className="block text-xs">
        Author instructions (optional)
        <textarea
          aria-label="AI instructions"
          className={cls}
          rows={3}
          value={String(value.instructions ?? "")}
          onChange={(e) => field("instructions", e.target.value)}
        />
      </label>
      {type === "ai_classify" && (
        <label className="block text-xs">
          Allowed categories (comma-separated)
          <input
            aria-label="AI categories"
            value={((value.categories as string[]) ?? []).join(", ")}
            onChange={(e) =>
              field(
                "categories",
                e.target.value.split(",").map((s) => s.trim()),
              )
            }
          />
        </label>
      )}
      {["ai_summarize", "ai_generate_text"].includes(type) && (
        <label className="block text-xs">
          Output length
          <select
            aria-label="AI output length"
            className={cls}
            value={String(value.length ?? "short")}
            onChange={(e) => field("length", e.target.value)}
          >
            {["short", "medium", "long"].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {type === "ai_summarize" && (
        <label className="block text-xs">
          Summary style
          <input
            aria-label="AI summary style"
            value={String(value.style ?? "")}
            onChange={(e) => field("style", e.target.value)}
          />
        </label>
      )}
      {type === "ai_sentiment" && (
        <label className="block text-xs">
          Business context
          <input
            aria-label="AI business context"
            value={String(value.context ?? "")}
            onChange={(e) => field("context", e.target.value)}
          />
        </label>
      )}
      {type === "ai_generate_text" && (
        <>
          <label className="block text-xs">
            Desired tone
            <input
              aria-label="AI tone"
              value={String(value.tone ?? "")}
              onChange={(e) => field("tone", e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="h-4! w-4! shrink-0 p-0!"
              checked={custom}
              onChange={(e) => {
                setCustom(e.target.checked);
                const next = { ...value };
                if (e.target.checked)
                  next.schema = {
                    type: "object",
                    properties: { text: { type: "string", maxLength: 4000 } },
                    required: ["text"],
                    additionalProperties: false,
                  };
                else delete next.schema;
                setSchema(
                  JSON.stringify(next.schema ?? defaultExtraction, null, 2),
                );
                onChange(next);
              }}
            />
            Use a custom output schema (must include text)
          </label>
        </>
      )}
      {(type === "ai_extract" || custom) && (
        <label className="block text-xs">
          Strict output JSON Schema
          <textarea
            aria-label="AI output schema"
            className={`${cls} font-mono`}
            rows={9}
            value={schema}
            onChange={(e) => {
              setSchema(e.target.value);
              try {
                field("schema", JSON.parse(e.target.value));
              } catch {
                /* Apply is disabled until valid JSON. */
              }
            }}
          />
          <span className="mt-1 block text-[10px]">
            All fields must be required; use nullable types for missing values.
            Objects forbid extra fields. No references or executable
            expressions.
          </span>
        </label>
      )}
      <label className="block text-xs">
        Maximum output tokens
        <input
          aria-label="AI maximum output tokens"
          type="number"
          min={16}
          max={2048}
          value={Number(value.maxOutputTokens)}
          onChange={(e) => field("maxOutputTokens", Number(e.target.value))}
        />
      </label>
      <p className="text-[10px]">
        The approved model limit also applies. Confidence probabilities are not
        generated. Basic redaction helps minimize secrets and personal data but
        is not a complete privacy filter.
      </p>
    </fieldset>
  );
}
export const aiNodeChoices = [...aiTypes];
