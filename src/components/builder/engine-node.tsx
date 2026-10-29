"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Play, Braces, FileText } from "lucide-react";
import { nodeTitles, purposes, type CanvasNode } from "@/lib/builder/document";
const styles = {
  google_sheets_read_rows: "border-green-500 bg-green-50 text-green-900",
  google_sheets_append_row: "border-green-500 bg-green-50 text-green-900",
  google_sheets_update_row: "border-green-500 bg-green-50 text-green-900",
  gmail_send_email: "border-red-400 bg-red-50 text-red-900",
  webhook_trigger: "border-teal-500 bg-teal-50 text-teal-900",
  http_request: "border-blue-400 bg-blue-50 text-blue-900",
  manual_trigger: "border-teal-500 bg-teal-50 text-teal-900",
  set_data: "border-blue-400 bg-blue-50 text-blue-900",
  condition: "border-amber-400 bg-amber-50 text-amber-900",
  log_event: "border-violet-400 bg-violet-50 text-violet-900",
};
const icons = {
  google_sheets_read_rows: Braces,
  google_sheets_append_row: Braces,
  google_sheets_update_row: Braces,
  gmail_send_email: FileText,
  manual_trigger: Play,
  webhook_trigger: Play,
  http_request: Braces,
  set_data: Braces,
  condition: GitBranch,
  log_event: FileText,
};
function summary(node: CanvasNode["data"]) {
  if (node.kind === "set_data")
    return `${Object.keys(node.config.values ?? {}).length} field(s) to merge`;
  if (node.kind === "condition")
    return `${node.config.path ?? "Choose a field"} ${node.config.operator ?? "equals"} ${node.config.operator === "exists" ? "" : JSON.stringify(node.config.value)}`;
  if (node.kind === "log_event")
    return typeof node.config.message === "string"
      ? node.config.message
      : "Configure an event";
  if (node.kind === "http_request")
    return `${node.config.method} ${node.config.url}`;
  if (node.kind === "webhook_trigger")
    return "Signed delivery · background execution";
  if (node.kind.startsWith("google_sheets_"))
    return String(node.config.range ?? "Choose a bounded range");
  if (node.kind === "gmail_send_email")
    return "Send from the authorized Google account";
  return "Manual execution only";
}
export function EngineNode({
  data,
  id,
  selected,
  isConnectable,
}: NodeProps<CanvasNode>) {
  const Icon = icons[data.kind] ?? Braces;
  const statusClass =
    data.status === "FAILED"
      ? "ring-3 ring-red-500"
      : data.status === "SUCCEEDED"
        ? "ring-3 ring-emerald-500"
        : data.status === "SKIPPED"
          ? "opacity-60 ring-2 ring-stone-400"
          : "";
  return (
    <div
      data-testid={`workflow-node-${id}`}
      data-node-kind={data.kind}
      data-run-status={data.status ?? "NONE"}
      className={`h-[156px] w-[250px] rounded-xl border-2 bg-white shadow-sm ${selected ? "outline-3 outline-offset-4 outline-teal-700" : ""} ${statusClass} ${styles[data.kind] ?? "border-red-500"}`}
    >
      {!["manual_trigger", "webhook_trigger"].includes(data.kind) && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          isConnectable={isConnectable}
          aria-label={`${data.label} input`}
          className="h-4! w-4! border-2! border-white! bg-teal-700!"
        />
      )}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-current/10 px-3 py-2">
        <Icon size={16} />
        <span className="truncate text-[10px] font-bold tracking-widest uppercase">
          {nodeTitles[data.kind] ?? "Unsupported node"}
        </span>
      </div>
      <div className="bg-white/80 px-4 py-3 text-stone-800">
        <p className="truncate text-sm font-semibold" title={data.label}>
          {data.label}
        </p>
        <p className="mt-1 text-[10px] text-stone-500">
          {purposes[data.kind] ?? "Not supported by this engine"}
        </p>
        <p
          className="mt-2 truncate font-mono text-[10px] text-stone-600"
          title={summary(data)}
        >
          {summary(data)}
        </p>
        {data.status && (
          <p
            className="mt-2 text-[10px] font-bold"
            data-testid={`node-status-${id}`}
          >
            {data.status}
            {data.error ? ` · ${data.error}` : ""}
          </p>
        )}
      </div>
      {data.kind === "condition" ? (
        <>
          <span className="pointer-events-none absolute top-[29%] right-2 text-[9px] font-bold text-teal-800">
            TRUE
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            aria-label={`${data.label} TRUE output`}
            style={{ top: "32%" }}
            isConnectable={isConnectable}
            className="h-4! w-4! border-2! border-white! bg-teal-700!"
          />
          <span className="pointer-events-none absolute right-2 bottom-[24%] text-[9px] font-bold text-amber-800">
            FALSE
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            aria-label={`${data.label} FALSE output`}
            style={{ top: "72%" }}
            isConnectable={isConnectable}
            className="h-4! w-4! border-2! border-white! bg-amber-700!"
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          aria-label={`${data.label} output`}
          isConnectable={isConnectable}
          className="h-4! w-4! border-2! border-white! bg-teal-700!"
        />
      )}
    </div>
  );
}
export const nodeTypes = { engineNode: EngineNode };
