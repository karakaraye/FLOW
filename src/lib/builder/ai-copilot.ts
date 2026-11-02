import { normalizeDocument, nodeTitles } from "./document";
import type { BuilderDocument } from "./document";
import type { Definition, NodeType, WorkflowNode, Json, Data } from "../engine/definition";
import { initialAIConfig } from "@/components/builder/ai-fields";

export type CopilotPreset = {
  label: string;
  description: string;
  prompt: string;
};

export const COPILOT_PRESETS: CopilotPreset[] = [
  {
    label: "Lead Capture & WhatsApp Alert",
    description: "Summarize inbound leads and send an immediate team alert",
    prompt:
      "When a new lead fills our website form, summarize their request with AI, add a row to Google Sheets, and send an alert via WhatsApp.",
  },
  {
    label: "VIP Order Notification",
    description: "Check order value and send custom Gmail receipts for VIPs",
    prompt:
      "When an order is received, check if the amount is greater than 100, then send a thank you email with Gmail and log the event.",
  },
  {
    label: "Customer Sentiment Triage",
    description: "Analyze customer satisfaction sentiment and save to spreadsheet",
    prompt:
      "When customer feedback arrives, detect customer sentiment with AI, save the feedback into Google Sheets, and record an audit log.",
  },
  {
    label: "WhatsApp Auto-Responder",
    description: "Categorize incoming WhatsApp messages and reply inside the window",
    prompt:
      "When a WhatsApp message is received, classify the inquiry category with AI and send a text reply.",
  },
];

export function generateWorkflowFromPrompt(rawPrompt: string): BuilderDocument {
  const prompt = rawPrompt.trim().toLowerCase();

  // 1. Determine Trigger
  let triggerType: NodeType = "manual_trigger";
  let triggerLabel = "Manual Button Trigger";
  let triggerConfig: Data = {};

  if (
    prompt.includes("whatsapp message") ||
    prompt.includes("incoming whatsapp") ||
    prompt.includes("whatsapp received")
  ) {
    triggerType = "whatsapp_message_received";
    triggerLabel = "Incoming WhatsApp Message";
    triggerConfig = {
      connectionId: "conn_meta_demo",
      phoneNumberId: "10987654321",
      contains: "",
    };
  } else if (
    prompt.includes("webhook") ||
    prompt.includes("form") ||
    prompt.includes("api") ||
    prompt.includes("lead") ||
    prompt.includes("signup") ||
    prompt.includes("order") ||
    prompt.includes("stripe")
  ) {
    triggerType = "webhook_trigger";
    triggerLabel = "Incoming Webhook Trigger";
    triggerConfig = {};
  }

  // 2. Determine Action Steps
  type PlannedStep = {
    id: string;
    type: NodeType;
    label: string;
    config: Data;
    isCondition?: boolean;
    trueBranchLabel?: string;
    falseBranchLabel?: string;
  };

  const steps: PlannedStep[] = [];

  // Data Preparation / Defaults if relevant
  if (
    prompt.includes("set data") ||
    prompt.includes("customer") ||
    prompt.includes("order") ||
    prompt.includes("lead")
  ) {
    steps.push({
      id: "prepare_data",
      type: "set_data",
      label: "Set Initial Data",
      config: {
        values: prompt.includes("order")
          ? { order_id: "ORD-9481", amount: 150, customer_name: "Alex Smith", status: "completed" }
          : { customer_name: "Sarah Connor", email: "sarah@example.com", score: 85, inquiry: "Interested in enterprise plan" },
      },
    });
  }

  // AI Step
  if (
    prompt.includes("summarize") ||
    prompt.includes("summary")
  ) {
    steps.push({
      id: "ai_summarize_step",
      type: "ai_summarize",
      label: "AI Summarize Request",
      config: initialAIConfig("ai_summarize"),
    });
  } else if (
    prompt.includes("classify") ||
    prompt.includes("category") ||
    prompt.includes("triage")
  ) {
    steps.push({
      id: "ai_classify_step",
      type: "ai_classify",
      label: "AI Classify Inquiry",
      config: initialAIConfig("ai_classify"),
    });
  } else if (
    prompt.includes("sentiment") ||
    prompt.includes("feedback") ||
    prompt.includes("satisfaction")
  ) {
    steps.push({
      id: "ai_sentiment_step",
      type: "ai_sentiment",
      label: "AI Sentiment Analysis",
      config: initialAIConfig("ai_sentiment"),
    });
  } else if (
    prompt.includes("extract") ||
    prompt.includes("fields")
  ) {
    steps.push({
      id: "ai_extract_step",
      type: "ai_extract",
      label: "AI Extract Key Data",
      config: initialAIConfig("ai_extract"),
    });
  } else if (
    prompt.includes("ai") ||
    prompt.includes("generate text") ||
    prompt.includes("draft")
  ) {
    steps.push({
      id: "ai_generate_step",
      type: "ai_generate_text",
      label: "AI Draft Response",
      config: initialAIConfig("ai_generate_text"),
    });
  }

  // Condition Check (If / Else)
  const hasCondition =
    prompt.includes("if ") ||
    prompt.includes("check if") ||
    prompt.includes("greater than") ||
    prompt.includes("score") ||
    prompt.includes("amount >") ||
    prompt.includes("vip");

  let conditionStep: PlannedStep | null = null;
  if (hasCondition) {
    conditionStep = {
      id: "check_condition",
      type: "condition",
      label: prompt.includes("order") ? "Check If Order > 100" : "Check If Score > 50",
      config: {
        path: prompt.includes("order") ? "amount" : "score",
        operator: "gt",
        value: prompt.includes("order") ? 100 : 50,
      },
      isCondition: true,
    };
  }

  // Integrations / Outputs
  const hasSheets =
    prompt.includes("sheet") ||
    prompt.includes("spreadsheet") ||
    prompt.includes("excel") ||
    prompt.includes("row");

  const hasEmail =
    prompt.includes("email") ||
    prompt.includes("gmail") ||
    prompt.includes("receipt");

  const hasWhatsApp =
    prompt.includes("whatsapp") &&
    triggerType !== "whatsapp_message_received";

  const hasWhatsAppReply =
    triggerType === "whatsapp_message_received" ||
    prompt.includes("reply");

  const actionSteps: PlannedStep[] = [];

  if (hasSheets) {
    actionSteps.push({
      id: "sheets_append",
      type: "google_sheets_append_row",
      label: "Append Google Sheet Row",
      config: {
        connectionId: "conn_google_demo",
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!A1:D1",
        values: ["{{data.customer_name}}", "{{data.email}}", "{{data.score}}"],
        valuePaths: [null, null, null],
      },
    });
  }

  if (hasEmail) {
    actionSteps.push({
      id: "send_email",
      type: "gmail_send_email",
      label: "Send Gmail Message",
      config: {
        connectionId: "conn_google_demo",
        to: ["customer@example.com"],
        subject: prompt.includes("order")
          ? "Your Order Confirmation & Receipt"
          : "Welcome to FlowPilot!",
        body: "Thank you for connecting with us. Your request has been received and prioritized.",
        mappings: {},
      },
    });
  }

  if (hasWhatsApp) {
    actionSteps.push({
      id: "whatsapp_alert",
      type: "whatsapp_send_message",
      label: "Send WhatsApp Alert",
      config: {
        connectionId: "conn_meta_demo",
        toPath: "from",
        body: "New lead arrived and prioritized by FlowPilot AI.",
      },
    });
  } else if (hasWhatsAppReply) {
    actionSteps.push({
      id: "whatsapp_reply",
      type: "whatsapp_send_message",
      label: "Send WhatsApp Reply",
      config: {
        connectionId: "conn_meta_demo",
        toPath: "from",
        body: "Thanks for your message! Our AI is reviewing your request.",
      },
    });
  }

  if (prompt.includes("http") || prompt.includes("api call")) {
    actionSteps.push({
      id: "call_external_api",
      type: "http_request",
      label: "Call External API",
      config: {
        method: "POST",
        url: "https://api.your-company.com/events",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 5000,
        maxAttempts: 1,
      },
    });
  }

  // Fallback if no specific action was requested
  if (actionSteps.length === 0 && steps.length === 0 && !conditionStep) {
    steps.push({
      id: "prepare_lead",
      type: "set_data",
      label: "Set Sample Lead Data",
      config: {
        values: {
          lead_name: "Jordan Lee",
          lead_email: "jordan@company.com",
          inquiry_type: "demo_request",
        },
      },
    });
    actionSteps.push({
      id: "ai_triage",
      type: "ai_summarize",
      label: "AI Summarize Request",
      config: initialAIConfig("ai_summarize"),
    });
  }

  // Always end with a clean log event for audit
  const auditStep: PlannedStep = {
    id: "record_audit",
    type: "log_event",
    label: "Record Audit Log",
    config: { message: "Workflow step completed successfully" },
  };

  // 3. Assemble all nodes
  const nodes: WorkflowNode[] = [
    {
      id: "trigger",
      type: triggerType,
      config: triggerConfig,
    },
  ];

  const editorNodes: Record<string, { x: number; y: number; label: string }> = {
    trigger: { x: 40, y: 150, label: triggerLabel },
  };

  const edges: Definition["edges"] = [];

  let previousNodeId = "trigger";
  let xOffset = 360;

  // Append sequential pre-steps (set_data, ai)
  for (const step of steps) {
    nodes.push({ id: step.id, type: step.type, config: step.config });
    editorNodes[step.id] = { x: xOffset, y: 150, label: step.label };
    edges.push({ from: previousNodeId, to: step.id });
    previousNodeId = step.id;
    xOffset += 320;
  }

  if (conditionStep) {
    nodes.push({
      id: conditionStep.id,
      type: conditionStep.type,
      config: conditionStep.config,
    });
    editorNodes[conditionStep.id] = {
      x: xOffset,
      y: 150,
      label: conditionStep.label,
    };
    edges.push({ from: previousNodeId, to: conditionStep.id });

    // TRUE branch action
    const trueAction = actionSteps[0] ?? {
      id: "action_true",
      type: "set_data",
      label: "Handle High Value",
      config: { values: { priority: "HIGH", routed_to: "VIP Queue" } },
    };
    nodes.push({ id: trueAction.id, type: trueAction.type, config: trueAction.config });
    editorNodes[trueAction.id] = { x: xOffset + 320, y: 50, label: trueAction.label };
    edges.push({ from: conditionStep.id, to: trueAction.id, branch: "true" });

    // FALSE branch action
    const falseAction: PlannedStep = {
      id: "action_standard",
      type: "set_data",
      label: "Handle Standard Value",
      config: { values: { priority: "STANDARD", routed_to: "General Queue" } },
    };
    nodes.push({ id: falseAction.id, type: falseAction.type, config: falseAction.config });
    editorNodes[falseAction.id] = { x: xOffset + 320, y: 280, label: falseAction.label };
    edges.push({ from: conditionStep.id, to: falseAction.id, branch: "false" });

    // Both converge to audit
    nodes.push({ id: auditStep.id, type: auditStep.type, config: auditStep.config });
    editorNodes[auditStep.id] = { x: xOffset + 640, y: 150, label: auditStep.label };
    edges.push({ from: trueAction.id, to: auditStep.id });
    edges.push({ from: falseAction.id, to: auditStep.id });
  } else {
    // Normal linear flow for action steps
    for (const step of actionSteps) {
      nodes.push({ id: step.id, type: step.type, config: step.config });
      editorNodes[step.id] = { x: xOffset, y: 150, label: step.label };
      edges.push({ from: previousNodeId, to: step.id });
      previousNodeId = step.id;
      xOffset += 320;
    }

    nodes.push({ id: auditStep.id, type: auditStep.type, config: auditStep.config });
    editorNodes[auditStep.id] = { x: xOffset, y: 150, label: auditStep.label };
    edges.push({ from: previousNodeId, to: auditStep.id });
  }

  // Derive workflow name from prompt
  let name = "AI Generated Automation";
  if (prompt.includes("whatsapp")) name = "WhatsApp Messaging Flow";
  else if (prompt.includes("lead")) name = "Customer Lead Processing";
  else if (prompt.includes("order")) name = "Order Triage & Notifications";
  else if (prompt.includes("sheet")) name = "Spreadsheet Sync Automation";
  else if (prompt.includes("email")) name = "Automated Email Notification";

  const definition: Definition = {
    schemaVersion: 1,
    nodes,
    edges,
  };

  return {
    name,
    definition,
    editor: {
      schemaVersion: 1,
      nodes: editorNodes,
    },
  };
}
