import type { TemplateContent, Category } from "./contracts";
import { normalizeDocument } from "../builder/document";
import type { Definition, Json } from "../engine/definition";
const limitations = [
  "Manual trigger only; processes supplied JSON data.",
  "No external apps, notifications, approval actions, payments, or persistent business records are created.",
  "Execution audits show data shape, statuses, and fixed error codes, not raw output values. Inspect and customize rules before use.",
];
function rule(
  path: string,
  operator: "gt" | "exists" | "equals",
  value: Json | undefined,
  yes: Record<string, Json>,
  no: Record<string, Json>,
): Definition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "manual_trigger", config: {} },
      {
        id: "check",
        type: "condition",
        config: {
          path,
          operator,
          ...(operator === "exists" ? {} : { value: value! }),
        },
      },
      { id: "yes", type: "set_data", config: { values: yes } },
      { id: "no", type: "set_data", config: { values: no } },
      {
        id: "audit",
        type: "log_event",
        config: { message: "Decision recorded (sanitized audit)" },
      },
    ],
    edges: [
      { from: "start", to: "check" },
      { from: "check", to: "yes", branch: "true" },
      { from: "check", to: "no", branch: "false" },
      { from: "yes", to: "audit" },
      { from: "no", to: "audit" },
    ],
  };
}
function entry(
  slug: string,
  name: string,
  category: Category,
  description: string,
  inputs: string,
  outputs: string,
  exampleInput: Json,
  definition: Definition,
  tags: string[],
): { slug: string; content: TemplateContent } {
  const normalized = normalizeDocument(name, definition);
  if (normalized.editor.nodes.check) {
    normalized.editor.nodes.start = { x: 0, y: 160, label: "Manual input" };
    normalized.editor.nodes.check = {
      x: 310,
      y: 160,
      label: "Evaluate supplied data",
    };
    normalized.editor.nodes.yes = { x: 620, y: 30, label: "TRUE result" };
    normalized.editor.nodes.no = { x: 620, y: 300, label: "FALSE result" };
    normalized.editor.nodes.audit = {
      x: 930,
      y: 160,
      label: "Record sanitized event",
    };
  }
  return {
    slug,
    content: {
      name,
      description,
      category,
      tags,
      schemaVersion: 1,
      definition,
      editor: normalized.editor,
      source: "FlowPilot AI · Built-in",
      requirements: limitations,
      inputs,
      outputs,
      exampleInput,
    },
  };
}
export const seedCatalog = [
  entry(
    "data-normalization",
    "Data Defaults and Standardization",
    "Data Processing",
    "Merge configurable, literal defaults into a supplied object. This does not rename fields, trim strings, transform case, or coerce types.",
    "Any JSON object. Configure Set Data values before publication; configured keys overwrite matching input keys.",
    "Passes the merged object to a sanitized event; does not store a transformed business record.",
    { recordId: "example-001" },
    {
      schemaVersion: 1,
      nodes: [
        { id: "start", type: "manual_trigger", config: {} },
        {
          id: "defaults",
          type: "set_data",
          config: {
            values: { source: "manual", status: "new", reviewed: false },
          },
        },
        {
          id: "audit",
          type: "log_event",
          config: { message: "Defaults applied" },
        },
      ],
      edges: [
        { from: "start", to: "defaults" },
        { from: "defaults", to: "audit" },
      ],
    },
    ["defaults", "supplied data"],
  ),
  entry(
    "record-classification",
    "Conditional Record Classification",
    "Business Operations",
    "Classify one supplied record using a configurable numeric threshold. No bulk import or external data lookup.",
    "An object with numeric score. The default rule is score > 50.",
    "Adds classification = high or standard, then records a sanitized event.",
    { score: 72 },
    rule(
      "score",
      "gt",
      50,
      { classification: "high" },
      { classification: "standard" },
    ),
    ["classification", "threshold"],
  ),
  entry(
    "lead-qualification",
    "Lead Qualification Prototype",
    "Sales Operations",
    "Evaluate a supplied lead score and mark it qualified or nurture. This is not a CRM connection or outreach automation.",
    "An object with numeric leadScore. The default rule is leadScore > 70.",
    "Adds qualification = qualified or nurture to the supplied data; sends no messages.",
    { leadScore: 85 },
    rule(
      "leadScore",
      "gt",
      70,
      { qualification: "qualified" },
      { qualification: "nurture" },
    ),
    ["prototype", "lead score"],
  ),
  entry(
    "expense-approval",
    "Expense Approval Decision Prototype",
    "Finance Operations",
    "Compare a supplied expense amount against a threshold. This is a decision prototype; it neither approves a real payment nor contacts an approver.",
    "An object with numeric amount in your chosen units. The default rule is amount > 1000; currency conversion is not provided.",
    "Adds decision = review_required or within_threshold. No financial records, approval permissions, or payments change.",
    { amount: 1500 },
    rule(
      "amount",
      "gt",
      1000,
      { decision: "review_required" },
      { decision: "within_threshold" },
    ),
    ["prototype", "expense"],
  ),
  entry(
    "customer-priority",
    "Customer Priority Routing Prototype",
    "Customer Support",
    "Categorize a supplied priority string. The prototype labels data; it does not assign tickets or send notifications.",
    "An object with priority. The default rule is priority equals the exact string urgent.",
    "Adds queue = priority or standard to the supplied object and records a sanitized event.",
    { priority: "urgent" },
    rule(
      "priority",
      "equals",
      "urgent",
      { queue: "priority" },
      { queue: "standard" },
    ),
    ["prototype", "priority"],
  ),
  entry(
    "data-validation-audit",
    "Field Presence and Audit",
    "Developer Tools",
    "Check whether a configured field exists and record a sanitized decision. This is a presence check, not type or schema validation.",
    "Any object. The default path is recordId; a present null still counts as existing.",
    "Adds presence = present or missing, then records a sanitized event. Missing fields do not fail this existence check.",
    { recordId: "sample-001" },
    rule(
      "recordId",
      "exists",
      undefined,
      { presence: "present" },
      { presence: "missing" },
    ),
    ["presence", "audit"],
  ),
  entry(
    "daily-task-defaults",
    "Task Intake Defaults",
    "Productivity",
    "Prepare supplied task data with a configurable literal stage and review flag. This does not create a task in any external service.",
    "An object containing your task data. Configure literal defaults in Set Data.",
    "Adds stage = inbox and needsReview = true, then records a sanitized event.",
    { title: "Prepare weekly notes" },
    {
      schemaVersion: 1,
      nodes: [
        { id: "start", type: "manual_trigger", config: {} },
        {
          id: "defaults",
          type: "set_data",
          config: { values: { stage: "inbox", needsReview: true } },
        },
        {
          id: "audit",
          type: "log_event",
          config: { message: "Task defaults recorded" },
        },
      ],
      edges: [
        { from: "start", to: "defaults" },
        { from: "defaults", to: "audit" },
      ],
    },
    ["tasks", "defaults"],
  ),
];
