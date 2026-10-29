import type { Edge as FlowEdge, Node } from "@xyflow/react";
import {
  canonical,
  type Definition,
  type Json,
  type NodeType,
  type Data,
} from "../engine/definition";
import { validateEditor, type EditorMetadata } from "./metadata";
export type BuilderDocument = {
  name: string;
  definition: Definition;
  editor: EditorMetadata;
};
export type EngineNodeData = {
  label: string;
  kind: NodeType;
  config: Data;
  status?: string;
  error?: string;
} & Record<string, unknown>;
export type CanvasNode = Node<EngineNodeData, "engineNode">;
export type History = {
  present: BuilderDocument;
  past: BuilderDocument[];
  future: BuilderDocument[];
};
export type HistoryAction =
  | { type: "change" | "preview"; document: BuilderDocument }
  | { type: "undo" | "redo" | "checkpoint" };
export function fingerprint(document: BuilderDocument) {
  return canonical(document as unknown as Json);
}
export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous
      ? {
          present: previous,
          past: state.past.slice(0, -1),
          future: [state.present, ...state.future].slice(0, 50),
        }
      : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next
      ? {
          present: next,
          past: [...state.past, state.present].slice(-50),
          future: state.future.slice(1),
        }
      : state;
  }
  if (action.type === "checkpoint")
    return {
      ...state,
      past: [...state.past, state.present].slice(-50),
      future: [],
    };
  if (!("document" in action)) return state;
  if (fingerprint(state.present) === fingerprint(action.document)) return state;
  return {
    present: action.document,
    past:
      action.type === "change"
        ? [...state.past, state.present].slice(-50)
        : state.past,
    future: action.type === "change" ? [] : state.future,
  };
}
export const nodeTitles: Record<NodeType, string> = {
  google_sheets_read_rows: "Sheets Read Rows",
  google_sheets_append_row: "Sheets Append Row",
  google_sheets_update_row: "Sheets Update Row",
  gmail_send_email: "Gmail Send Email",
  manual_trigger: "Manual Trigger",
  webhook_trigger: "Webhook Trigger",
  http_request: "HTTP Request",
  set_data: "Set Data",
  condition: "Condition",
  log_event: "Log Event",
};
export const purposes: Record<NodeType, string> = {
  google_sheets_read_rows: "Read a bounded spreadsheet range",
  google_sheets_append_row: "Append one row to a spreadsheet",
  google_sheets_update_row: "Update one bounded spreadsheet row",
  gmail_send_email: "Send email from your authorized account",
  manual_trigger: "Start with your manual input",
  webhook_trigger: "Start from a verified signed delivery",
  http_request: "Call an approved public HTTPS service",
  set_data: "Merge literal values into your data",
  condition: "Choose a TRUE or FALSE path",
  log_event: "Record a sanitized event",
};
export function normalizeDocument(
  name: string,
  definition: Definition,
  editor?: unknown,
): BuilderDocument {
  const metadata = validateEditor(editor, definition);
  return {
    name,
    definition,
    editor: {
      schemaVersion: 1,
      nodes: Object.fromEntries(
        definition.nodes.map((n, index) => [
          n.id,
          metadata.nodes[n.id] ?? {
            x: (index % 3) * 310,
            y: Math.floor(index / 3) * 220,
            label: nodeTitles[n.type] ?? n.type,
          },
        ]),
      ),
    },
  };
}
export function toCanvas(
  document: BuilderDocument,
  statuses: Record<string, { status: string; error?: string | null }> = {},
) {
  const nodes: CanvasNode[] = document.definition.nodes.map((n, index) => ({
    id: n.id,
    type: "engineNode",
    // Fixed custom-node dimensions keep the minimap and initial handle geometry
    // correct even though selection/measurement events are not persisted.
    width: 250,
    height: 156,
    position: {
      x: document.editor.nodes[n.id]?.x ?? index * 310,
      y: document.editor.nodes[n.id]?.y ?? 0,
    },
    data: {
      kind: n.type,
      config: n.config,
      label: document.editor.nodes[n.id]?.label ?? nodeTitles[n.type] ?? n.type,
      ...(statuses[n.id]
        ? {
            status: statuses[n.id].status,
            error: statuses[n.id].error ?? undefined,
          }
        : {}),
    },
  }));
  const edges: FlowEdge[] = document.definition.edges.map((e) => ({
    id: `${e.from}:${e.branch ?? "out"}:${e.to}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.branch ?? "out",
    targetHandle: "in",
    label: e.branch?.toUpperCase(),
    type: "smoothstep",
    style: {
      stroke: e.branch === "false" ? "#b45309" : "#0f766e",
      strokeWidth: 2,
    },
    ...(e.branch ? { data: { branch: e.branch } } : {}),
  }));
  return { nodes, edges };
}
export function fromCanvas(nodes: CanvasNode[], edges: FlowEdge[]): Definition {
  return {
    schemaVersion: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      config: n.data.config,
    })),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.sourceHandle === "true" || e.sourceHandle === "false"
        ? { branch: e.sourceHandle }
        : {}),
    })),
  };
}
export function connect(
  document: BuilderDocument,
  from: string,
  to: string,
  handle?: string | null,
): BuilderDocument {
  const edge = {
    from,
    to,
    ...(handle === "true" || handle === "false" ? { branch: handle } : {}),
  } as Definition["edges"][number];
  if (
    document.definition.edges.some(
      (e) => e.from === from && e.to === to && e.branch === edge.branch,
    )
  )
    return document;
  return {
    ...document,
    definition: {
      ...document.definition,
      edges: [...document.definition.edges, edge],
    },
  };
}
export function remove(
  document: BuilderDocument,
  nodes: string[],
  edges: string[],
): BuilderDocument {
  const canvas = toCanvas(document);
  return {
    ...document,
    definition: {
      ...document.definition,
      nodes: document.definition.nodes.filter((n) => !nodes.includes(n.id)),
      edges: document.definition.edges.filter(
        (e, i) =>
          !nodes.includes(e.from) &&
          !nodes.includes(e.to) &&
          !edges.includes(canvas.edges[i].id),
      ),
    },
    editor: {
      schemaVersion: 1,
      nodes: Object.fromEntries(
        Object.entries(document.editor.nodes).filter(
          ([id]) => !nodes.includes(id),
        ),
      ),
    },
  };
}
