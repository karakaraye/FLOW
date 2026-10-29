import type { Definition } from "./definition";
// An editable starter definition, not an installed template or fabricated run.
export const starterDefinition: Definition = {
  schemaVersion: 1,
  nodes: [
    { id: "start", type: "manual_trigger", config: {} },
    { id: "prepare", type: "set_data", config: { values: { ready: true } } },
    {
      id: "record",
      type: "log_event",
      config: { message: "Manual workflow completed" },
    },
  ],
  edges: [
    { from: "start", to: "prepare" },
    { from: "prepare", to: "record" },
  ],
};
