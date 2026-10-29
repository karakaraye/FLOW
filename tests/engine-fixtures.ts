import type { Definition } from "../src/lib/engine/definition";
export const branching: Definition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "manual_trigger", config: {} },
    {
      id: "check",
      type: "condition",
      config: { path: "score", operator: "gt", value: 10 },
    },
    { id: "yes", type: "set_data", config: { values: { accepted: true } } },
    { id: "no", type: "set_data", config: { values: { accepted: false } } },
    {
      id: "join",
      type: "log_event",
      config: { message: "Do not persist this message" },
    },
  ],
  edges: [
    { from: "start", to: "check" },
    { from: "check", to: "yes", branch: "true" },
    { from: "check", to: "no", branch: "false" },
    { from: "yes", to: "join" },
    { from: "no", to: "join" },
  ],
};
