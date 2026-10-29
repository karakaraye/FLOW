import {
  assertJson,
  EngineError,
  isObject,
  LIMITS,
  validateDefinition,
  type Definition,
  type Json,
} from "../engine/definition";
import { validateEditor, type EditorMetadata } from "../builder/metadata";
export const categories = [
  "Productivity",
  "Data Processing",
  "Business Operations",
  "Sales Operations",
  "Customer Support",
  "Finance Operations",
  "Developer Tools",
] as const;
export type Category = (typeof categories)[number];
export type TemplateContent = {
  name: string;
  description: string;
  category: Category;
  tags: string[];
  schemaVersion: 1;
  definition: Definition;
  editor: EditorMetadata;
  source: string;
  requirements: string[];
  inputs: string;
  outputs: string;
  exampleInput: Json;
};
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
export function validateContent(value: unknown): TemplateContent {
  assertJson(value, LIMITS.bodyBytes - 1024);
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "name",
          "description",
          "category",
          "tags",
          "schemaVersion",
          "definition",
          "editor",
          "source",
          "requirements",
          "inputs",
          "outputs",
          "exampleInput",
        ].includes(key),
    ) ||
    !text(value.name, 100) ||
    !text(value.description, 800) ||
    !categories.includes(value.category as Category) ||
    !Array.isArray(value.tags) ||
    value.tags.length > 8 ||
    !value.tags.every((t) => text(t, 40)) ||
    value.schemaVersion !== 1 ||
    !text(value.source, 100) ||
    !Array.isArray(value.requirements) ||
    value.requirements.length > 10 ||
    !value.requirements.every((r) => text(r, 300)) ||
    !text(value.inputs, 1000) ||
    !text(value.outputs, 1000) ||
    !Object.hasOwn(value, "exampleInput")
  )
    throw new EngineError(
      "INVALID_TEMPLATE",
      "Complete all template fields within the documented limits.",
    );
  const definition = validateDefinition(value.definition);
  const editor = validateEditor(value.editor, definition);
  assertJson(value.exampleInput, LIMITS.inputBytes);
  return { ...value, definition, editor } as TemplateContent;
}
export function validateSlug(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
    value.length > 80
  )
    throw new EngineError(
      "INVALID_SLUG",
      "Use a lowercase slug of up to 80 letters, digits, and hyphens.",
    );
  return value;
}
export function parseFilters(query: string | null, category: string | null) {
  if ((query?.length ?? 0) > 100)
    throw new EngineError(
      "INVALID_SEARCH",
      "Search is limited to 100 characters.",
    );
  if (category && !categories.includes(category as Category))
    throw new EngineError("INVALID_CATEGORY", "Choose a supported category.");
  return {
    query: (query ?? "").trim().toLowerCase(),
    category: category ?? "",
  };
}
