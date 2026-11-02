import type { Definition, Json, NodeType, WorkflowNode } from "../engine/definition";
import { topologicalOrder, isObject } from "../engine/definition";

export type TestStepResult = {
  nodeId: string;
  label: string;
  type: NodeType;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  input: Json;
  output?: Json;
  branch?: "true" | "false";
  error?: string;
  durationMs: number;
};

export type TestRunReport = {
  success: boolean;
  totalSteps: number;
  succeededSteps: number;
  failedSteps: number;
  skippedSteps: number;
  durationMs: number;
  steps: TestStepResult[];
  finalOutput?: Json;
};

function getDottedValue(obj: Json, path: string): Json | undefined {
  let curr: Json | undefined = obj;
  for (const part of path.split(".")) {
    if (!isObject(curr) || !Object.hasOwn(curr, part)) return undefined;
    curr = (curr as Record<string, Json>)[part];
  }
  return curr;
}

export function runClientSimulation(
  definition: Definition,
  labels: Record<string, { label?: string }> = {},
  initialTriggerInput: Json = {
    event: "test_trigger",
    timestamp: new Date().toISOString(),
    customer: { name: "Sarah Connor", email: "sarah@example.com", score: 85 },
    order: { id: "ORD-9481", amount: 150, currency: "USD", status: "completed" },
    message: "I would like to inquire about enterprise automation features.",
  },
): TestRunReport {
  const startTime = Date.now();
  const steps: TestStepResult[] = [];
  const nodeOutputs: Record<string, Json> = {};
  const activeNodes = new Set<string>();
  const order: WorkflowNode[] = topologicalOrder(definition);

  const inEdges = new Map<string, typeof definition.edges>();
  for (const edge of definition.edges) {
    if (!inEdges.has(edge.to)) inEdges.set(edge.to, []);
    inEdges.get(edge.to)!.push(edge);
  }

  // Find root trigger
  const root = definition.nodes.find(
    (n) =>
      n.type === "manual_trigger" ||
      n.type === "webhook_trigger" ||
      n.type === "whatsapp_message_received",
  ) || definition.nodes[0];

  if (root) activeNodes.add(root.id);

  let hasFailure = false;
  let finalResult: Json | undefined;

  for (const node of order) {
    const nodeId = node.id;
    const label = labels[nodeId]?.label || node.id;
    const stepStart = Date.now();

    // Check if node is reachable / active
    const parentEdges = inEdges.get(nodeId) || [];
    let isActive = false;
    let combinedInput: Json = {};

    if (node.id === root?.id) {
      isActive = true;
      combinedInput = initialTriggerInput;
    } else {
      const activeParents = parentEdges.filter((e) => {
        if (!activeNodes.has(e.from)) return false;
        const parentStep = steps.find((s) => s.nodeId === e.from);
        if (!parentStep || parentStep.status !== "SUCCEEDED") return false;
        if (e.branch) return parentStep.branch === e.branch;
        return true;
      });

      if (activeParents.length > 0) {
        isActive = true;
        if (activeParents.length === 1) {
          combinedInput = nodeOutputs[activeParents[0].from] ?? {};
        } else {
          const joined: Record<string, Json> = {};
          for (const p of activeParents) {
            joined[p.from] = nodeOutputs[p.from] ?? null;
          }
          combinedInput = joined;
        }
      }
    }

    if (!isActive || hasFailure) {
      steps.push({
        nodeId: node.id,
        label,
        type: node.type,
        status: "SKIPPED",
        input: {},
        durationMs: 0,
      });
      continue;
    }

    // Execute node logic
    try {
      let output: Json = combinedInput;
      let branch: "true" | "false" | undefined;

      switch (node.type) {
        case "manual_trigger":
        case "webhook_trigger":
        case "whatsapp_message_received":
          output = combinedInput;
          break;

        case "set_data": {
          const configValues = (node.config.values as Record<string, Json>) || {};
          output = {
            ...(isObject(combinedInput) ? (combinedInput as Record<string, Json>) : {}),
            ...configValues,
          };
          break;
        }

        case "condition": {
          const path = String(node.config.path || "");
          const operator = String(node.config.operator || "equals");
          const targetValue = node.config.value;
          const actualValue = getDottedValue(combinedInput, path);

          let conditionMet = false;
          if (operator === "exists") {
            conditionMet = actualValue !== undefined && actualValue !== null;
          } else if (operator === "equals") {
            conditionMet = JSON.stringify(actualValue) === JSON.stringify(targetValue);
          } else if (operator === "not_equals") {
            conditionMet = JSON.stringify(actualValue) !== JSON.stringify(targetValue);
          } else if (operator === "gt") {
            conditionMet =
              typeof actualValue === "number" &&
              typeof targetValue === "number" &&
              actualValue > targetValue;
          }

          branch = conditionMet ? "true" : "false";
          output = combinedInput;
          break;
        }

        case "log_event":
          output = combinedInput;
          break;

        case "http_request": {
          const url = String(node.config.url || "https://api.example.com/data");
          const method = String(node.config.method || "POST");
          output = {
            simulated: true,
            status: 200,
            statusText: "OK",
            request: { method, url },
            data: { success: true, processedAt: new Date().toISOString() },
          };
          break;
        }

        case "ai_classify":
          output = {
            simulated: true,
            category: "High Priority Inquiry",
            confidence: 0.96,
            intent: "product_interest",
          };
          break;

        case "ai_summarize":
          output = {
            simulated: true,
            summary: "Customer requested info on enterprise plan features and integrations.",
            sentiment: "positive",
          };
          break;

        case "ai_sentiment":
          output = {
            simulated: true,
            sentiment: "POSITIVE",
            score: 0.94,
          };
          break;

        case "ai_extract":
          output = {
            simulated: true,
            entities: {
              customer_name: "Sarah Connor",
              inquiry_type: "Enterprise",
              urgency: "High",
            },
          };
          break;

        case "ai_generate_text":
          output = {
            simulated: true,
            generated_text:
              "Thank you for reaching out! A dedicated account executive will follow up with your customized demo.",
          };
          break;

        case "google_sheets_append_row":
        case "google_sheets_update_row":
          output = {
            simulated: true,
            spreadsheetId: node.config.spreadsheetId || "sheet_default",
            updatedRange: "Sheet1!A2:E2",
            updatedRows: 1,
          };
          break;

        case "google_sheets_read_rows":
          output = {
            simulated: true,
            rows: [
              ["ID", "Name", "Email", "Status"],
              ["101", "Alex Smith", "alex@example.com", "Active"],
              ["102", "Sarah Connor", "sarah@example.com", "Active"],
            ],
          };
          break;

        case "gmail_send_email":
          output = {
            simulated: true,
            messageId: `msg_${Date.now()}`,
            recipient: node.config.to || "recipient@example.com",
            status: "SENT",
          };
          break;

        case "whatsapp_send_message":
        case "whatsapp_send_template":
          output = {
            simulated: true,
            messageId: `wamid.HBgL${Date.now()}`,
            status: "ACCEPTED",
          };
          break;

        default:
          output = combinedInput;
      }

      nodeOutputs[node.id] = output;
      activeNodes.add(node.id);
      finalResult = output;

      steps.push({
        nodeId: node.id,
        label,
        type: node.type,
        status: "SUCCEEDED",
        input: combinedInput,
        output,
        branch,
        durationMs: Math.max(1, Date.now() - stepStart),
      });
    } catch (err) {
      hasFailure = true;
      steps.push({
        nodeId: node.id,
        label,
        type: node.type,
        status: "FAILED",
        input: combinedInput,
        error: err instanceof Error ? err.message : "Node execution failed",
        durationMs: Math.max(1, Date.now() - stepStart),
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const succeededSteps = steps.filter((s) => s.status === "SUCCEEDED").length;
  const failedSteps = steps.filter((s) => s.status === "FAILED").length;
  const skippedSteps = steps.filter((s) => s.status === "SKIPPED").length;

  return {
    success: !hasFailure,
    totalSteps: steps.length,
    succeededSteps,
    failedSteps,
    skippedSteps,
    durationMs,
    steps,
    finalOutput: finalResult,
  };
}
