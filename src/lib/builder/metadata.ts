import {
  assertJson,
  Definition,
  EngineError,
  isObject,
} from "../engine/definition";
export type EditorMetadata = {
  schemaVersion: 1;
  nodes: Record<string, { x: number; y: number; label: string }>;
};
export function validateEditor(
  value: unknown,
  definition: Definition,
): EditorMetadata {
  if (
    value === undefined ||
    (isObject(value) && Object.keys(value).length === 0)
  )
    return { schemaVersion: 1, nodes: {} };
  assertJson(value, 12288);
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !isObject(value.nodes) ||
    Object.keys(value).some((k) => !["schemaVersion", "nodes"].includes(k))
  )
    throw new EngineError("INVALID_EDITOR", "Invalid canvas metadata.");
  const ids = new Set(definition.nodes.map((n) => n.id));
  for (const [id, position] of Object.entries(value.nodes)) {
    if (
      !ids.has(id) ||
      !isObject(position) ||
      Object.keys(position).some((k) => !["x", "y", "label"].includes(k)) ||
      typeof position.x !== "number" ||
      typeof position.y !== "number" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      Math.abs(position.x) > 100000 ||
      Math.abs(position.y) > 100000 ||
      typeof position.label !== "string" ||
      !position.label.trim() ||
      position.label.length > 80
    )
      throw new EngineError(
        "INVALID_EDITOR",
        "Canvas labels and positions must match the workflow nodes and stay within limits.",
      );
  }
  return value as unknown as EditorMetadata;
}
