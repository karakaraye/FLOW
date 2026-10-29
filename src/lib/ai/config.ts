import {
  EngineError,
  isObject,
  assertJson,
  type Data,
  type Json,
} from "../engine/definition";
export const aiTypes = [
  "ai_classify",
  "ai_summarize",
  "ai_extract",
  "ai_sentiment",
  "ai_generate_text",
] as const;
export type AIType = (typeof aiTypes)[number];
export function isAIType(t: string): t is AIType {
  return (aiTypes as readonly string[]).includes(t);
}
function invalid(message: string): never {
  throw new EngineError("AI_INVALID_CONFIG", message);
}
export function inputPath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length <= 128 &&
    p
      .split(".")
      .every(
        (s) =>
          /^[A-Za-z0-9_-]{1,40}$/.test(s) &&
          !["__proto__", "prototype", "constructor"].includes(s),
      )
  );
}
export function validateOutputSchema(value: unknown): asserts value is Data {
  assertJson(value, 4096);
  let count = 0;
  function visit(v: unknown, depth: number) {
    if (++count > 40 || depth > 4 || !isObject(v))
      invalid("Output schema is too complex.");
    const allowed = [
      "type",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "maxLength",
      "minLength",
      "maxItems",
      "minItems",
      "enum",
      "description",
    ];
    if (Object.keys(v).some((k) => !allowed.includes(k)))
      invalid(
        "Unsupported schema keyword. References, patterns, and executable extensions are not allowed.",
      );
    const types = Array.isArray(v.type) ? v.type : [v.type];
    if (
      !types.length ||
      types.length > 2 ||
      types.some(
        (t) =>
          ![
            "object",
            "array",
            "string",
            "number",
            "integer",
            "boolean",
            "null",
          ].includes(String(t)),
      ) ||
      new Set(types).size !== types.length ||
      (types.length === 2 && !types.includes("null"))
    )
      invalid("Use a scalar/object/array type with optional null.");
    const type = types.find((t) => t !== "null") ?? "null";
    if (
      v.description !== undefined &&
      (typeof v.description !== "string" || v.description.length > 200)
    )
      invalid("Field descriptions are limited to 200 characters.");
    if (
      v.enum !== undefined &&
      (!Array.isArray(v.enum) ||
        v.enum.length < 1 ||
        v.enum.length > 12 ||
        v.enum.some(
          (e) =>
            e !== null && !["string", "number", "boolean"].includes(typeof e),
        ))
    )
      invalid("Use a bounded scalar enum.");
    if (type === "object") {
      if (
        !isObject(v.properties) ||
        Object.keys(v.properties).length < 1 ||
        Object.keys(v.properties).length > 12 ||
        v.additionalProperties !== false ||
        !Array.isArray(v.required) ||
        JSON.stringify([...v.required].sort()) !==
          JSON.stringify(Object.keys(v.properties).sort())
      )
        invalid(
          "Object schemas require 1–12 fields, every field required, and additionalProperties:false. Use nullable fields for missing data.",
        );
      for (const [k, child] of Object.entries(v.properties)) {
        if (
          !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) ||
          ["constructor", "prototype", "__proto__"].includes(k)
        )
          invalid("Invalid schema field.");
        visit(child, depth + 1);
      }
    } else if (
      ["properties", "required", "additionalProperties"].some((k) => k in v)
    )
      invalid("Object keywords require an object type.");
    if (type === "array") {
      if (
        !Number.isInteger(v.maxItems) ||
        Number(v.maxItems) < 1 ||
        Number(v.maxItems) > 20
      )
        invalid("Arrays require maxItems between 1 and 20.");
      visit(v.items, depth + 1);
    } else if ("items" in v || "maxItems" in v || "minItems" in v)
      invalid("Array keywords require an array.");
    if (type === "string") {
      if (
        !Number.isInteger(v.maxLength) ||
        Number(v.maxLength) < 1 ||
        Number(v.maxLength) > 4000
      )
        invalid("Strings require maxLength between 1 and 4000.");
    } else if ("maxLength" in v || "minLength" in v)
      invalid("String keywords require a string.");
    for (const [min, max] of [
      ["minItems", "maxItems"],
      ["minLength", "maxLength"],
    ])
      if (
        v[min] !== undefined &&
        (!Number.isInteger(v[min]) ||
          Number(v[min]) < 0 ||
          Number(v[min]) > Number(v[max]))
      )
        invalid("Invalid lower schema bound.");
  }
  visit(value, 0);
  if (!isObject(value) || value.type !== "object")
    invalid("Output schema must be an object.");
}
export function aiConfig(type: string, c: Data) {
  if (!isAIType(type)) invalid("Unknown AI node.");
  const common = ["modelId", "textPath", "instructions", "maxOutputTokens"];
  const fields =
    type === "ai_classify"
      ? ["categories"]
      : type === "ai_summarize"
        ? ["length", "style"]
        : type === "ai_extract"
          ? ["schema"]
          : type === "ai_sentiment"
            ? ["context"]
            : ["length", "tone", "schema"];
  if (Object.keys(c).some((k) => ![...common, ...fields].includes(k)))
    invalid("Unexpected AI configuration field.");
  if (
    typeof c.modelId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(c.modelId) ||
    !inputPath(c.textPath)
  )
    invalid("Select an approved model and a safe source-text field path.");
  if (
    !Number.isInteger(c.maxOutputTokens) ||
    Number(c.maxOutputTokens) < 16 ||
    Number(c.maxOutputTokens) > 2048
  )
    invalid("Output token limit must be between 16 and 2048.");
  for (const k of ["instructions", "context", "style", "tone"])
    if (
      c[k] !== undefined &&
      (typeof c[k] !== "string" ||
        new TextEncoder().encode(String(c[k])).length > 512)
    )
      invalid(
        "Instructions, style, tone and context are limited to 512 UTF-8 bytes.",
      );
  if (
    type === "ai_classify" &&
    (!Array.isArray(c.categories) ||
      c.categories.length < 2 ||
      c.categories.length > 12 ||
      !c.categories.every(
        (x) =>
          typeof x === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(x) &&
          !/^sk-/i.test(x),
      ) ||
      new Set(c.categories).size !== c.categories.length)
  )
    invalid("Use 2–12 distinct short categories.");
  if (
    ["ai_summarize", "ai_generate_text"].includes(type) &&
    !["short", "medium", "long"].includes(String(c.length))
  )
    invalid("Choose short, medium, or long output.");
  if (type === "ai_extract" || c.schema !== undefined)
    validateOutputSchema(c.schema);
  if (type === "ai_generate_text" && c.schema !== undefined) {
    const properties = (c.schema as Data).properties as Data;
    if (!isObject(properties.text) || properties.text.type !== "string")
      invalid("Generated output schemas must include a required text string.");
  }
  return c;
}
const str = (n: number) => ({ type: "string", maxLength: n });
export function outputSchema(type: AIType, c: Data): Data {
  if (c.schema) return c.schema as Data;
  const length =
    c.length === "short" ? 1000 : c.length === "medium" ? 2000 : 4000;
  const properties: Data =
    type === "ai_classify"
      ? {
          category: { type: "string", maxLength: 40, enum: c.categories },
          explanation: { type: ["string", "null"], maxLength: 1000 },
        }
      : type === "ai_summarize"
        ? { summary: str(length) }
        : type === "ai_sentiment"
          ? {
              label: {
                type: "string",
                maxLength: 8,
                enum: ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"],
              },
              explanation: str(1000),
            }
          : { text: str(length) };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
export function sourceText(input: Json, path: string) {
  let v = input;
  for (const key of path.split(".")) {
    if (!isObject(v) || !Object.hasOwn(v, key))
      throw new EngineError(
        "AI_INPUT_MISSING",
        "The selected source field was not found.",
      );
    v = v[key] as Json;
  }
  if (typeof v !== "string" || !v.trim())
    throw new EngineError(
      "AI_INPUT_INVALID",
      "AI input must be nonempty text.",
    );
  return v;
}
