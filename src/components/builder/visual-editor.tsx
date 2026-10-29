"use client";
import { initialWhatsAppConfig } from "./whatsapp-fields";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Undo2,
  Redo2,
  Trash2,
  CheckCircle2,
  Save,
  Upload,
  Play,
  Plus,
} from "lucide-react";
import { Button } from "../ui/button";
import { nodeTypes } from "./engine-node";
import { initialAIConfig } from "./ai-fields";
import { NodePanel } from "./node-panel";
import {
  connect,
  fingerprint,
  historyReducer,
  nodeTitles,
  normalizeDocument,
  remove,
  toCanvas,
  type BuilderDocument,
  type CanvasNode,
} from "@/lib/builder/document";
import {
  EngineError,
  LIMITS,
  validateDefinition,
  type Data,
  type Definition,
  type NodeType,
} from "@/lib/engine/definition";
import { validateEditor } from "@/lib/builder/metadata";
export type SavedWorkflow = {
  id: string;
  name: string;
  draft: unknown;
  editor?: unknown;
  revision: number;
  versions: { id: string; number: number; definition?: unknown }[];
};
export type EditorProps = {
  workspaceId: string;
  role: string;
  workflow?: SavedWorkflow;
};
const available: NodeType[] = [
  "whatsapp_message_received",
  "whatsapp_send_message",
  "whatsapp_send_template",
  "ai_classify",
  "ai_summarize",
  "ai_extract",
  "ai_sentiment",
  "ai_generate_text",
  "google_sheets_read_rows",
  "google_sheets_append_row",
  "google_sheets_update_row",
  "gmail_send_email",
  "manual_trigger",
  "webhook_trigger",
  "http_request",
  "set_data",
  "condition",
  "log_event",
];
function Editor({ workspaceId, role, workflow }: EditorProps) {
  const router = useRouter();
  const flow = useReactFlow<CanvasNode>();
  const [initial] = useState(() =>
    normalizeDocument(
      workflow?.name ?? "My visual workflow",
      (workflow?.draft ?? {
        schemaVersion: 1,
        nodes: [],
        edges: [],
      }) as Definition,
      workflow?.editor,
    ),
  );
  const [history, dispatch] = useReducer(historyReducer, {
    present: initial,
    past: [],
    future: [],
  });
  const doc = history.present;
  const [saved, setSaved] = useState(workflow);
  const [savedFingerprint, setSavedFingerprint] = useState(
    fingerprint(initial),
  );
  const [selection, setSelection] = useState<{
    nodes: string[];
    edges: string[];
  }>({ nodes: [], edges: [] });
  const [panelDirty, setPanelDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const dragging = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("{}");
  const [runKey, setRunKey] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [branch, setBranch] = useState("out");
  const root = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const canEdit = ["OWNER", "ADMIN", "EDITOR"].includes(role);
  const canPublish = ["OWNER", "ADMIN"].includes(role);
  const editable = canEdit && !pending;
  const dirty =
    fingerprint(doc) !== savedFingerprint ||
    (!saved && doc.definition.nodes.length > 0);
  const validation = useMemo(() => {
    if (doc.definition.nodes.length === 0)
      return "Missing manual trigger. Add a Manual Trigger to start.";
    try {
      validateDefinition(doc.definition);
      validateEditor(doc.editor, doc.definition);
      return "";
    } catch (cause) {
      return cause instanceof EngineError
        ? cause.message
        : "Invalid workflow definition.";
    }
  }, [doc]);
  const canvas = useMemo(() => toCanvas(doc), [doc]);
  const nodes = useMemo(
    () =>
      canvas.nodes.map((n) => ({
        ...n,
        selected: selection.nodes.includes(n.id),
      })),
    [canvas.nodes, selection.nodes],
  );
  const edges = useMemo(
    () =>
      canvas.edges.map((e) => ({
        ...e,
        selected: selection.edges.includes(e.id),
      })),
    [canvas.edges, selection.edges],
  );
  const selected = doc.definition.nodes.find(
    (n) => selection.nodes[0] === n.id,
  );
  const apply = (
    next: BuilderDocument,
    type: "change" | "preview" = "change",
  ) => {
    dispatch({ type, document: next });
    setError("");
    setMessage("");
  };
  useEffect(() => {
    if (!dirty && !panelDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, panelDirty]);
  function select(next: { nodes: string[]; edges: string[] }) {
    if (
      next.nodes.join() === selection.nodes.join() &&
      next.edges.join() === selection.edges.join()
    )
      return;
    if (panelDirty && !window.confirm("Discard unapplied node configuration?"))
      return;
    setPanelDirty(false);
    setSelection(next);
  }
  function add(kind: NodeType, position?: { x: number; y: number }) {
    if (!editable) return;
    if (doc.definition.nodes.length >= LIMITS.nodes) {
      setError("The workflow limit is 32 nodes.");
      return;
    }
    if (panelDirty && !window.confirm("Discard unapplied node configuration?"))
      return;
    if (
      [
        "manual_trigger",
        "webhook_trigger",
        "whatsapp_message_received",
      ].includes(kind)
    ) {
      const root = doc.definition.nodes.find((n) =>
        [
          "manual_trigger",
          "webhook_trigger",
          "whatsapp_message_received",
        ].includes(n.type),
      );
      if (root) {
        apply({
          ...doc,
          definition: {
            ...doc.definition,
            nodes: doc.definition.nodes.map((n) =>
              n.id === root.id
                ? {
                    ...n,
                    type: kind,
                    config:
                      kind === "whatsapp_message_received"
                        ? initialWhatsAppConfig(kind)
                        : {},
                  }
                : n,
            ),
          },
        });
        setSelection({ nodes: [root.id], edges: [] });
        return;
      }
    }
    const id = `node_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const config: Data = kind.startsWith("whatsapp_")
      ? initialWhatsAppConfig(kind)
      : kind.startsWith("ai_")
        ? initialAIConfig(kind)
        : kind === "gmail_send_email"
          ? {
              connectionId: "",
              to: ["recipient@example.test"],
              subject: "Workflow update",
              body: "Your update",
              mappings: {},
            }
          : kind.startsWith("google_sheets_")
            ? {
                connectionId: "",
                spreadsheetId: "",
                range: "Sheet1!A1:A1",
                ...(kind === "google_sheets_read_rows"
                  ? {}
                  : { values: [""], valuePaths: [null] }),
              }
            : kind === "http_request"
              ? {
                  method: "GET",
                  url: "https://api.your-company.com/status",
                  headers: {},
                  timeoutMs: 5000,
                  maxAttempts: 1,
                }
              : kind === "set_data"
                ? { values: {} }
                : kind === "condition"
                  ? { path: "score", operator: "gt", value: 10 }
                  : kind === "log_event"
                    ? { message: "Event recorded" }
                    : {};
    let point = position ?? {
      x: (doc.definition.nodes.length % 3) * 310,
      y: Math.floor(doc.definition.nodes.length / 3) * 220,
    };
    // Keep a freshly dropped node from obscuring existing connection handles.
    while (
      Object.values(doc.editor.nodes).some(
        (p) => Math.abs(p.x - point.x) < 280 && Math.abs(p.y - point.y) < 170,
      )
    )
      point = { x: point.x + 310, y: point.y };
    apply({
      ...doc,
      definition: {
        ...doc.definition,
        nodes: [...doc.definition.nodes, { id, type: kind, config }],
      },
      editor: {
        schemaVersion: 1,
        nodes: {
          ...doc.editor.nodes,
          [id]: { ...point, label: nodeTitles[kind] },
        },
      },
    });
    setPanelDirty(false);
    setSelection({ nodes: [id], edges: [] });
    requestAnimationFrame(() => flow.fitView({ duration: 150, padding: 0.25 }));
  }
  function onNodesChange(changes: NodeChange<CanvasNode>[]) {
    const selectedChanges = changes.filter((c) => c.type === "select");
    if (selectedChanges.length) {
      const ids = new Set(selection.nodes);
      for (const c of selectedChanges)
        if (c.type === "select") {
          if (c.selected) ids.add(c.id);
          else ids.delete(c.id);
        }
      select({ nodes: [...ids], edges: selection.edges });
    }
    if (!editable) return;
    const positions = changes.filter(
      (c) => c.type === "position" && c.position,
    );
    if (positions.length) {
      const positionsById = { ...doc.editor.nodes };
      for (const c of positions)
        if (c.type === "position" && c.position && positionsById[c.id])
          positionsById[c.id] = { ...positionsById[c.id], ...c.position };
      apply(
        { ...doc, editor: { schemaVersion: 1, nodes: positionsById } },
        dragging.current ? "preview" : "change",
      );
    }
  }
  function onEdgesChange(changes: EdgeChange[]) {
    const ids = new Set(selection.edges);
    for (const c of changes)
      if (c.type === "select") {
        if (c.selected) ids.add(c.id);
        else ids.delete(c.id);
      }
    select({ nodes: selection.nodes, edges: [...ids] });
  }
  function onConnect(connection: Connection) {
    if (editable)
      apply(
        connect(
          doc,
          connection.source,
          connection.target,
          connection.sourceHandle,
        ),
      );
  }
  function deleteSelection() {
    if (!editable || (!selection.nodes.length && !selection.edges.length))
      return;
    if (panelDirty && !window.confirm("Discard unapplied node configuration?"))
      return;
    apply(remove(doc, selection.nodes, selection.edges));
    setSelection({ nodes: [], edges: [] });
    setPanelDirty(false);
  }
  function undo(redo = false) {
    if (!editable) return;
    if (panelDirty && !window.confirm("Discard unapplied node configuration?"))
      return;
    dispatch({ type: redo ? "redo" : "undo" });
    setPanelDirty(false);
    setSelection({ nodes: [], edges: [] });
  }
  function configure(label: string, config: Data) {
    if (!selected || !editable) return;
    // Reuse the authoritative validator's node/config checks with a tiny valid
    // graph; structural errors elsewhere must not prevent configuring this node.
    const node = { ...selected, config };
    const probe: Definition = [
      "manual_trigger",
      "webhook_trigger",
      "whatsapp_message_received",
    ].includes(node.type)
      ? { schemaVersion: 1, nodes: [node], edges: [] }
      : node.type === "condition"
        ? {
            schemaVersion: 1,
            nodes: [
              { id: "probe_root", type: "manual_trigger", config: {} },
              { ...node, id: "probe_node" },
              { id: "probe_yes", type: "log_event", config: { message: "" } },
              { id: "probe_no", type: "log_event", config: { message: "" } },
            ],
            edges: [
              { from: "probe_root", to: "probe_node" },
              { from: "probe_node", to: "probe_yes", branch: "true" },
              { from: "probe_node", to: "probe_no", branch: "false" },
            ],
          }
        : {
            schemaVersion: 1,
            nodes: [
              { id: "probe_root", type: "manual_trigger", config: {} },
              { ...node, id: "probe_node" },
            ],
            edges: [{ from: "probe_root", to: "probe_node" }],
          };
    validateDefinition(probe);
    const next = {
      ...doc,
      definition: {
        ...doc.definition,
        nodes: doc.definition.nodes.map((n) =>
          n.id === selected.id ? node : n,
        ),
      },
      editor: {
        schemaVersion: 1 as const,
        nodes: {
          ...doc.editor.nodes,
          [selected.id]: { ...doc.editor.nodes[selected.id], label },
        },
      },
    };
    validateEditor(next.editor, next.definition);
    apply(next);
    setPanelDirty(false);
  }
  async function send(action: "save" | "publish" | "run") {
    if (busy.current) return;
    if (action !== "run" && (validation || panelDirty)) {
      setError(panelDirty ? "Apply the node configuration first." : validation);
      status.current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      let path = `/api/workspaces/${workspaceId}/workflows`;
      let method = "POST";
      let payload: unknown;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (action === "save") {
        payload = {
          name: doc.name,
          definition: doc.definition,
          editor: doc.editor,
          ...(saved ? { revision: saved.revision } : {}),
        };
        if (saved) {
          path += `/${saved.id}`;
          method = "PATCH";
        }
      } else if (action === "publish") {
        if (!saved || dirty)
          throw new Error("Save the current draft before publishing.");
        path += `/${saved.id}/publish`;
        payload = { revision: saved.revision };
      } else {
        if (!saved?.versions[0])
          throw new Error("Publish a version before running.");
        path += `/${saved.id}/runs`;
        payload = { versionId: saved.versions[0].id, input: JSON.parse(input) };
        const key = runKey || crypto.randomUUID();
        setRunKey(key);
        headers["Idempotency-Key"] = key;
      }
      const response = await fetch(path, {
        method,
        headers,
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to complete this operation.");
      if (action === "save") {
        const document = normalizeDocument(
          result.name,
          result.draft,
          result.editor,
        );
        dispatch({ type: "preview", document });
        setSavedFingerprint(fingerprint(document));
        setSaved({ ...result, versions: saved?.versions ?? [] });
        setMessage("Draft saved.");
        if (!saved) router.replace(`/workflows/${result.id}`);
        router.refresh();
      }
      if (action === "publish") {
        setSaved({
          ...saved!,
          versions: [
            result,
            ...saved!.versions.filter((v) => v.id !== result.id),
          ],
        });
        setMessage(`Published immutable version ${result.number}.`);
        router.refresh();
      }
      if (action === "run") {
        router.push(`/history/${result.id}`);
        router.refresh();
      }
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "Enter valid input JSON."
          : cause instanceof Error
            ? cause.message
            : "Request failed. Retry with the same execution key.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const onDirty = useCallback((value: boolean) => setPanelDirty(value), []);
  return (
    <div
      ref={root}
      tabIndex={-1}
      aria-label="Visual workflow builder"
      className="mt-7 min-w-0"
      onKeyDown={(event) => {
        const textTarget =
          event.target instanceof HTMLElement &&
          Boolean(
            event.target.closest(
              "input,textarea,select,[contenteditable=true]",
            ),
          );
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          if (canEdit) void send("save");
        } else if (
          !textTarget &&
          (event.ctrlKey || event.metaKey) &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          undo(event.shiftKey || event.key.toLowerCase() === "y");
        } else if (!textTarget && ["Delete", "Backspace"].includes(event.key)) {
          event.preventDefault();
          deleteSelection();
        }
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-t-2xl border border-border bg-white p-4">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="workflow-name"
            className="mb-1 block text-xs font-semibold"
          >
            Workflow name
          </label>
          <input
            id="workflow-name"
            value={doc.name}
            maxLength={100}
            disabled={!editable}
            onChange={(e) => apply({ ...doc, name: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="save-state"
            className={`mr-2 text-xs font-semibold ${dirty || panelDirty ? "text-amber-800" : "text-stone-500"}`}
          >
            {panelDirty
              ? "Unapplied configuration"
              : dirty
                ? "Unsaved changes"
                : saved
                  ? `Saved · Draft ${saved.revision}`
                  : "New workflow"}
          </span>
          {canEdit && (
            <Button
              size="sm"
              disabled={pending || Boolean(validation) || panelDirty}
              onClick={() => send("save")}
            >
              <Save size={15} />
              Save draft
            </Button>
          )}
          {canPublish && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                pending || !saved || dirty || panelDirty || Boolean(validation)
              }
              onClick={() => send("publish")}
            >
              <Upload size={15} />
              Publish saved draft
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-x border-border bg-stone-50 px-4 py-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Undo"
            disabled={!editable || history.past.length === 0}
            onClick={() => undo()}
          >
            <Undo2 size={15} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Redo"
            disabled={!editable || history.future.length === 0}
            onClick={() => undo(true)}
          >
            <Redo2 size={15} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Delete selected nodes or edges"
            disabled={
              !editable || (!selection.nodes.length && !selection.edges.length)
            }
            onClick={deleteSelection}
          >
            <Trash2 size={15} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMessage(
                validation
                  ? ""
                  : "Graph is valid. The server validates again when saving and publishing.",
              );
              setError(validation);
              status.current?.focus();
            }}
          >
            <CheckCircle2 size={15} />
            Validate graph
          </Button>
        </div>
        <p className="text-[10px] text-stone-500">
          Ctrl/⌘ S save · Z undo · Shift Z redo · Delete selection
        </p>
      </div>
      <div className="grid min-w-0 border border-border bg-white xl:grid-cols-[160px_minmax(0,1fr)_260px]">
        <aside
          aria-label="Node palette"
          className="border-b border-border bg-white p-3 xl:border-r xl:border-b-0"
        >
          <h2 className="mb-3 text-xs font-bold tracking-wide uppercase">
            Add a step
          </h2>
          <p className="mb-3 text-[10px] leading-5 text-stone-500">
            Drag onto the canvas, or select a button to add.
          </p>
          <div className="grid max-h-[520px] grid-cols-2 gap-2 overflow-y-auto xl:grid-cols-1">
            {available.map((kind) => (
              <button
                type="button"
                key={kind}
                data-testid={`add-${kind}`}
                disabled={!editable}
                draggable={editable}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/flowpilot-node", kind);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => add(kind)}
                className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-3 text-left text-xs font-medium hover:border-teal-700 focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-40"
              >
                <Plus size={14} />
                {nodeTitles[kind]}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[10px] leading-5 text-stone-500">
            {canEdit
              ? "Connect handles by dragging or clicking source then target. Use the connection form below for keyboard access."
              : "VIEWER · Read-only canvas. You can inspect nodes and pan or zoom."}
          </p>
        </aside>
        <div
          data-testid="workflow-canvas"
          className="h-[560px] min-w-0 bg-[#f8faf7]"
          onDragOver={(e) => {
            if (editable) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const kind = e.dataTransfer.getData(
              "application/flowpilot-node",
            ) as NodeType;
            if (available.includes(kind))
              add(
                kind,
                flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
              );
          }}
        >
          <ReactFlow<CanvasNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => select({ nodes: [node.id], edges: [] })}
            onEdgeClick={(_, edge) => select({ nodes: [], edges: [edge.id] })}
            onPaneClick={() => select({ nodes: [], edges: [] })}
            onNodeDragStart={() => {
              if (editable) {
                dispatch({ type: "checkpoint" });
                dragging.current = true;
              }
            }}
            onNodeDragStop={() => {
              dragging.current = false;
            }}
            nodesDraggable={editable}
            nodesConnectable={editable}
            edgesReconnectable={false}
            deleteKeyCode={null}
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            elevateNodesOnSelect
            ariaLabelConfig={{
              "controls.zoomIn.ariaLabel": "Zoom in",
              "controls.zoomOut.ariaLabel": "Zoom out",
              "controls.fitView.ariaLabel": "Fit view",
            }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.data.kind === "condition"
                  ? "#fbbf24"
                  : node.data.kind === "set_data"
                    ? "#93c5fd"
                    : node.data.kind === "log_event"
                      ? "#c4b5fd"
                      : "#5eead4"
              }
              ariaLabel="Workflow minimap"
            />
          </ReactFlow>
        </div>
        <aside
          aria-label="Node configuration"
          className="min-w-0 border-t border-border bg-stone-50 p-4 xl:border-t-0 xl:border-l"
        >
          {selected ? (
            <NodePanel
              key={`${selected.id}:${JSON.stringify(selected.config)}:${doc.editor.nodes[selected.id]?.label}`}
              workspaceId={workspaceId}
              node={selected}
              label={doc.editor.nodes[selected.id]?.label ?? selected.id}
              readOnly={!editable}
              onApply={configure}
              onDirty={onDirty}
            />
          ) : (
            <>
              <h2 className="text-sm font-semibold">Make it your own</h2>
              <p className="mt-3 text-xs leading-6 text-stone-500">
                Select a node to inspect its purpose and configure literal data.
                Labels and positions never change engine behavior.
              </p>
            </>
          )}
        </aside>
      </div>
      <div
        ref={status}
        tabIndex={-1}
        className="rounded-b-2xl border border-t-0 border-border bg-white p-4 text-xs"
      >
        <p
          role="status"
          className={validation ? "text-red-700" : "text-teal-800"}
          data-testid="graph-validation"
        >
          {validation
            ? `Graph needs attention: ${validation}`
            : "Graph valid · Backend validation is required on save and publish."}
        </p>
        {panelDirty && (
          <p className="mt-2 text-amber-800">
            Apply the node configuration before saving or publishing.
          </p>
        )}
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
        <p role="status" className="mt-2 text-teal-800">
          {pending ? "Working…" : message}
        </p>
      </div>
      <details className="mt-5 rounded-xl border border-border bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Accessible graph controls & JSON
        </summary>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold">
              Connect nodes without dragging
            </h3>
            <div className="mt-3 grid gap-3">
              <label className="text-xs">
                Source node
                <select
                  aria-label="Connection source"
                  disabled={!editable}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setBranch(
                      doc.definition.nodes.find((n) => n.id === e.target.value)
                        ?.type === "condition"
                        ? "true"
                        : "out",
                    );
                  }}
                  className="mt-1 w-full rounded-lg border border-border p-2"
                >
                  <option value="">Select source</option>
                  {doc.definition.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {doc.editor.nodes[n.id]?.label} ({n.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Output
                <select
                  aria-label="Connection output"
                  disabled={!editable || !source}
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border p-2"
                >
                  {doc.definition.nodes.find((n) => n.id === source)?.type ===
                  "condition" ? (
                    <>
                      <option value="true">TRUE</option>
                      <option value="false">FALSE</option>
                    </>
                  ) : (
                    <option value="out">Output</option>
                  )}
                </select>
              </label>
              <label className="text-xs">
                Target node
                <select
                  aria-label="Connection target"
                  disabled={!editable}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border p-2"
                >
                  <option value="">Select target</option>
                  {doc.definition.nodes
                    .filter(
                      (n) =>
                        ![
                          "manual_trigger",
                          "webhook_trigger",
                          "whatsapp_message_received",
                        ].includes(n.type),
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {doc.editor.nodes[n.id]?.label} ({n.id})
                      </option>
                    ))}
                </select>
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={!editable || !source || !target}
                onClick={() => apply(connect(doc, source, target, branch))}
              >
                Connect selected nodes
              </Button>
            </div>
            <h3 className="mt-5 text-xs font-semibold">
              Select an edge to delete
            </h3>
            <div className="mt-2 space-y-2">
              {canvas.edges.map((edge) => (
                <button
                  type="button"
                  key={edge.id}
                  disabled={!editable}
                  className="block w-full rounded border border-border p-2 text-left text-[10px] disabled:opacity-50"
                  onClick={() => select({ nodes: [], edges: [edge.id] })}
                >
                  {edge.source} → {edge.label ? `${edge.label} → ` : ""}
                  {edge.target}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label
              htmlFor="definition-import"
              className="mb-2 block text-xs font-semibold"
            >
              Import engine definition JSON (replaces the current graph)
            </label>
            <textarea
              id="definition-import"
              disabled={!editable}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={7}
              className="w-full rounded-lg border border-border p-3 font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={!editable || !importText}
              onClick={() => {
                try {
                  const definition = validateDefinition(JSON.parse(importText));
                  if (
                    panelDirty &&
                    !window.confirm("Discard unapplied node configuration?")
                  )
                    return;
                  apply(normalizeDocument(doc.name, definition));
                  setSelection({ nodes: [], edges: [] });
                  setPanelDirty(false);
                  setImportError("");
                  requestAnimationFrame(() => flow.fitView({ padding: 0.3 }));
                } catch (cause) {
                  setImportError(
                    cause instanceof SyntaxError
                      ? "Invalid JSON."
                      : cause instanceof Error
                        ? cause.message
                        : "Invalid graph.",
                  );
                }
              }}
            >
              Import definition
            </Button>
            <p role="alert" className="mt-3 text-xs text-red-700">
              {importError}
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold">
                Current execution JSON (layout excluded)
              </summary>
              <pre
                className="mt-3 max-h-80 overflow-auto bg-stone-50 p-3 text-[10px]"
                data-testid="engine-json"
              >
                {JSON.stringify(doc.definition, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </details>
      {saved && (
        <section className="mt-5 rounded-xl border border-border bg-white p-5">
          <h2 className="text-lg font-semibold">Run a published version</h2>
          <p className="mt-2 text-xs leading-6 text-stone-500">
            {saved.versions[0]
              ? `Runs use immutable version ${saved.versions[0].number}, never unsaved draft changes. The background worker processes accepted jobs. Use a signed webhook for webhook-triggered versions; other versions can run manually.`
              : "Publish a valid saved draft before running. Scheduling and other provider integrations are Coming Soon. Signed webhooks use Webhook setup below."}
          </p>
          {canEdit &&
            saved.versions[0] &&
            !(
              saved.versions[0].definition &&
              validateDefinition(saved.versions[0].definition).nodes.some(
                (n) => n.type === "webhook_trigger",
              )
            ) && (
              <>
                <label
                  htmlFor="run-input"
                  className="mt-4 mb-2 block text-xs font-medium"
                >
                  Run input JSON (up to 16 KiB; no credentials)
                </label>
                <textarea
                  id="run-input"
                  value={input}
                  disabled={pending || Boolean(runKey)}
                  onChange={(e) => setInput(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border p-3 font-mono text-xs"
                />
                <Button
                  className="mt-3"
                  disabled={pending || panelDirty}
                  onClick={() => send("run")}
                >
                  <Play size={15} />
                  Queue manual run
                </Button>
                {runKey && (
                  <p className="mt-2 text-xs text-stone-500">
                    Retries reuse the same key to prevent duplicate runs. Reload
                    to start a different request.
                  </p>
                )}
              </>
            )}
          <Link
            href="/history"
            className="mt-4 block text-xs text-teal-800 underline"
            onClick={(e) => {
              if (
                (dirty || panelDirty) &&
                !window.confirm("Leave with unsaved changes?")
              )
                e.preventDefault();
            }}
          >
            Execution history
          </Link>
        </section>
      )}
      {!canEdit && (
        <p className="mt-4 text-sm text-stone-500">
          VIEWER · Read-only access. Changes, publishing, and execution are
          disabled.
        </p>
      )}
      {canEdit && !canPublish && (
        <p className="mt-4 text-xs text-stone-500">
          Your EDITOR role can save and run. An OWNER or ADMIN must publish.
        </p>
      )}
    </div>
  );
}
export default function VisualEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
