import { googleConfig } from "../google/config";
import { httpConfig } from "../http-actions/config";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export type NodeType =
  | "google_sheets_read_rows"
  | "google_sheets_append_row"
  | "google_sheets_update_row"
  | "gmail_send_email"
  | "manual_trigger"
  | "webhook_trigger"
  | "http_request"
  | "set_data"
  | "condition"
  | "log_event";
export type WorkflowNode = { id: string; type: NodeType; config: Data };
export type Edge = { from: string; to: string; branch?: "true" | "false" };
export type Definition = {
  schemaVersion: 1;
  nodes: WorkflowNode[];
  edges: Edge[];
};
export const LIMITS = {
  nodes: 32,
  edges: 64,
  definitionBytes: 32768,
  inputBytes: 16384,
  bodyBytes: 65536,
  executionMs: 1000,
  pendingPerWorkspace: 100,
} as const;
export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function invalid(message: string): never {
  throw new EngineError("INVALID_DEFINITION", message);
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function assertJson(
  value: unknown,
  maxBytes: number,
): asserts value is Json {
  let count = 0;
  function visit(v: unknown, depth: number) {
    if (++count > 3000 || depth > 12)
      throw new EngineError("INVALID_JSON", "JSON is too complex.");
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (isObject(v)) {
      for (const [key, x] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new EngineError(
            "INVALID_JSON",
            "Reserved object keys are not allowed.",
          );
        visit(x, depth + 1);
      }
      return;
    }
    throw new EngineError("INVALID_JSON", "Only JSON data is supported.");
  }
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes)
    throw new EngineError("SIZE_LIMIT", "JSON exceeds the allowed size.", 413);
}
function exact(object: Record<string, unknown>, keys: string[]) {
  if (Object.keys(object).some((k) => !keys.includes(k)))
    invalid("Unexpected definition field.");
}
export function validateDefinition(value: unknown): Definition {
  assertJson(value, LIMITS.definitionBytes);
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  )
    invalid("Expected a schemaVersion 1 graph with nodes and edges.");
  exact(value, ["schemaVersion", "nodes", "edges"]);
  if (
    value.nodes.length < 1 ||
    value.nodes.length > LIMITS.nodes ||
    value.edges.length > LIMITS.edges
  )
    invalid("Graph size is outside the supported limits.");
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (
      !isObject(node) ||
      typeof node.id !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(node.id) ||
      ids.has(node.id)
    )
      invalid("Node IDs must be unique safe identifiers.");
    if (["constructor", "prototype", "__proto__"].includes(node.id))
      invalid("Reserved node ID.");
    ids.add(node.id);
    exact(node, ["id", "type", "config"]);
    if (!isObject(node.config)) invalid("Every node requires a config object.");
    const config = node.config;
    switch (node.type) {
      case "google_sheets_read_rows":
      case "google_sheets_append_row":
      case "google_sheets_update_row":
      case "gmail_send_email":
        googleConfig(String(node.type), config as Data);
        break;
      case "http_request":
        httpConfig(config as Data);
        break;
      case "webhook_trigger":
      case "manual_trigger":
        exact(config, []);
        break;
      case "set_data":
        exact(config, ["values"]);
        if (!isObject(config.values))
          invalid("set_data requires an object of values.");
        break;
      case "condition":
        exact(config, ["path", "operator", "value"]);
        if (
          typeof config.path !== "string" ||
          config.path.length > 128 ||
          !config.path
            .split(".")
            .every(
              (p) =>
                /^[a-zA-Z0-9_-]+$/.test(p) &&
                !["__proto__", "prototype", "constructor"].includes(p),
            )
        )
          invalid("Invalid condition path.");
        if (
          !["equals", "not_equals", "gt", "exists"].includes(
            String(config.operator),
          )
        )
          invalid("Unsupported condition operator.");
        if (config.operator !== "exists" && !Object.hasOwn(config, "value"))
          invalid("Condition requires a comparison value.");
        if (config.operator === "gt" && typeof config.value !== "number")
          invalid("gt requires a numeric comparison value.");
        break;
      case "log_event":
        exact(config, ["message"]);
        if (typeof config.message !== "string" || config.message.length > 200)
          invalid("log_event requires a message of up to 200 characters.");
        break;
      default:
        invalid("Unsupported node type.");
    }
  }
  const definition = value as unknown as Definition;
  const triggers = definition.nodes.filter((n) =>
    ["manual_trigger", "webhook_trigger"].includes(n.type),
  );
  if (triggers.length !== 1)
    invalid("Exactly one manual or webhook trigger is required.");
  const edges = new Set<string>();
  for (const edge of definition.edges) {
    if (!isObject(edge)) invalid("Invalid edge.");
    exact(edge, ["from", "to", "branch"]);
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
      invalid("Edges must connect distinct existing nodes.");
    const key = `${edge.from}:${edge.to}`;
    if (edges.has(key)) invalid("Duplicate connection.");
    edges.add(key);
    const source = definition.nodes.find((n) => n.id === edge.from)!;
    if (
      source.type === "condition"
        ? !["true", "false"].includes(String(edge.branch))
        : edge.branch !== undefined
    )
      invalid("Only condition edges require true/false branches.");
  }
  for (const node of definition.nodes) {
    const incoming = definition.edges.filter((e) => e.to === node.id);
    if (
      ["manual_trigger", "webhook_trigger"].includes(node.type)
        ? incoming.length !== 0
        : incoming.length === 0
    )
      invalid("Every non-trigger node must have an incoming connection.");
    if (node.type === "condition") {
      const outgoing = definition.edges.filter((e) => e.from === node.id);
      if (
        outgoing.length !== 2 ||
        outgoing.filter((e) => e.branch === "true").length !== 1 ||
        outgoing.filter((e) => e.branch === "false").length !== 1
      )
        invalid("Conditions need exactly one true and one false connection.");
    }
  }
  topologicalOrder(definition);
  const reachable = new Set([triggers[0].id]);
  for (const node of topologicalOrder(definition))
    if (reachable.has(node.id))
      for (const edge of definition.edges.filter((e) => e.from === node.id))
        reachable.add(edge.to);
  if (reachable.size !== ids.size)
    invalid("All nodes must be reachable from the trigger.");
  return definition;
}
export function topologicalOrder(definition: Definition): WorkflowNode[] {
  const remaining = new Map(
    definition.nodes.map((n) => [
      n.id,
      definition.edges.filter((e) => e.to === n.id).length,
    ]),
  );
  const order: WorkflowNode[] = [];
  while (remaining.size) {
    const next = [...remaining]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort()[0];
    if (!next) invalid("Cyclic graphs are not supported.");
    remaining.delete(next);
    order.push(definition.nodes.find((n) => n.id === next)!);
    for (const edge of definition.edges.filter((e) => e.from === next))
      if (remaining.has(edge.to))
        remaining.set(edge.to, remaining.get(edge.to)! - 1);
  }
  return order;
}
// Audit records contain shape only, never submitted values, keys, or messages.
export function audit(value: Json): Data {
  return {
    kind:
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    ...(Array.isArray(value)
      ? { length: value.length }
      : isObject(value)
        ? { fields: Object.keys(value).length }
        : {}),
  };
}
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k] as Json)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
