import { isGoogleType } from "../google/config";
import {
  audit,
  canonical,
  Definition,
  EngineError,
  isObject,
  Json,
  LIMITS,
  topologicalOrder,
  validateDefinition,
  WorkflowNode,
} from "./definition";
export type Result = { output: Json; branch?: "true" | "false" };
type Executor = (input: Json, config: WorkflowNode["config"]) => Result;
function pathValue(input: Json, path: string): Json | undefined {
  let value: Json | undefined = input;
  for (const part of path.split(".")) {
    if (!isObject(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part] as Json;
  }
  return value;
}
const externalOnly: Executor = () => {
  throw new EngineError(
    "ASYNC_EXECUTOR_REQUIRED",
    "Use the background worker.",
  );
};
export const executors: Record<WorkflowNode["type"], Executor> = {
  google_sheets_read_rows: externalOnly,
  google_sheets_append_row: externalOnly,
  google_sheets_update_row: externalOnly,
  gmail_send_email: externalOnly,
  webhook_trigger: (input) => ({ output: input }),
  http_request: () => {
    throw new EngineError(
      "ASYNC_EXECUTOR_REQUIRED",
      "HTTP requires the background worker.",
    );
  },
  manual_trigger: (input) => ({ output: input }),
  set_data: (input, config) => ({
    output: {
      ...(isObject(input) ? (input as Record<string, Json>) : {}),
      ...(config.values as Record<string, Json>),
    },
  }),
  condition: (input, config) => {
    const value = pathValue(input, config.path as string);
    let passed: boolean;
    if (config.operator === "exists") passed = value !== undefined;
    else {
      if (value === undefined)
        throw new EngineError("MISSING_VALUE", "Condition field is missing.");
      if (config.operator === "gt") {
        if (typeof value !== "number")
          throw new EngineError(
            "TYPE_MISMATCH",
            "Condition field must be numeric.",
          );
        passed = value > (config.value as number);
      } else {
        passed = canonical(value) === canonical(config.value);
        if (config.operator === "not_equals") passed = !passed;
      }
    }
    return { output: input, branch: passed ? "true" : "false" };
  },
  // Events are represented by the NodeRun audit row; never write user messages to stdout.
  log_event: (input) => ({ output: input }),
};
export type ExecutedNode = {
  nodeId: string;
  type: string;
  position: number;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  input: ReturnType<typeof audit>;
  output?: ReturnType<typeof audit>;
  error?: string;
  startedAt?: Date;
  finishedAt: Date;
};
function* execution(
  definition: Definition,
  input: Json,
  options: { now?: () => number; maxMs?: number } = {},
) {
  validateDefinition(definition);
  const now = options.now ?? Date.now;
  const start = now();
  const maxMs = options.maxMs ?? LIMITS.executionMs;
  const results = new Map<string, Result>();
  const nodes: ExecutedNode[] = [];
  let failure: string | undefined;
  const order = topologicalOrder(definition);
  for (const [position, node] of order.entries()) {
    const incoming = definition.edges
      .filter((e) => e.to === node.id)
      .filter((e) => {
        const r = results.get(e.from);
        return r && (!e.branch || e.branch === r.branch);
      })
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (
      failure ||
      (!["manual_trigger", "webhook_trigger"].includes(node.type) &&
        incoming.length === 0)
    ) {
      nodes.push({
        nodeId: node.id,
        type: node.type,
        position,
        status: "SKIPPED",
        input: audit(null),
        error: failure ? "UPSTREAM_FAILURE" : "INACTIVE_BRANCH",
        finishedAt: new Date(),
      });
      continue;
    }
    const data = ["manual_trigger", "webhook_trigger"].includes(node.type)
      ? input
      : incoming.length === 1
        ? results.get(incoming[0].from)!.output
        : Object.fromEntries(
            incoming.map((e) => [e.from, results.get(e.from)!.output]),
          );
    const startedAt = new Date();
    try {
      if (now() - start >= maxMs)
        throw new EngineError(
          "EXECUTION_TIMEOUT",
          "Execution time limit exceeded.",
        );
      const result: Result =
        node.type === "http_request" || isGoogleType(node.type)
          ? yield { node, input: data }
          : executors[node.type](data, node.config);
      // Shallow merges cannot grow without bound across graph joins.
      if (
        Buffer.byteLength(JSON.stringify(result.output)) >
        LIMITS.definitionBytes
      )
        throw new EngineError(
          "OUTPUT_LIMIT",
          "Node output exceeded its limit.",
        );
      if (now() - start >= maxMs)
        throw new EngineError(
          "EXECUTION_TIMEOUT",
          "Execution time limit exceeded.",
        );
      results.set(node.id, result);
      nodes.push({
        nodeId: node.id,
        type: node.type,
        position,
        status: "SUCCEEDED",
        input: audit(data),
        output: audit(result.output),
        startedAt,
        finishedAt: new Date(),
      });
    } catch (error) {
      failure = error instanceof EngineError ? error.code : "NODE_FAILED";
      nodes.push({
        nodeId: node.id,
        type: node.type,
        position,
        status: "FAILED",
        input: audit(data),
        error: failure,
        startedAt,
        finishedAt: new Date(),
      });
    }
  }
  return {
    status: failure ? ("FAILED" as const) : ("SUCCEEDED" as const),
    error: failure,
    nodes,
    output: audit([...results.values()].at(-1)?.output ?? null),
  };
}

export function execute(
  definition: Definition,
  input: Json,
  options: { now?: () => number; maxMs?: number } = {},
) {
  const engine = execution(definition, input, options);
  let step = engine.next();
  while (!step.done) {
    step = engine.throw(
      new EngineError(
        "ASYNC_EXECUTOR_REQUIRED",
        "HTTP requires the background worker.",
      ),
    );
  }
  return step.value;
}
export async function executeAsync(
  definition: Definition,
  input: Json,
  external: (node: WorkflowNode, input: Json) => Promise<Result>,
  options: { now?: () => number; maxMs?: number } = {},
) {
  const engine = execution(definition, input, options);
  let step = engine.next();
  while (!step.done) {
    try {
      const result = await external(step.value.node, step.value.input);
      step = engine.next(result);
    } catch (error) {
      step = engine.throw(error);
    }
  }
  return step.value;
}
