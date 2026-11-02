"use client";
import { useState } from "react";
import { Variable, ChevronDown, Check, Sparkles } from "lucide-react";

export type AvailableVariable = {
  path: string;
  label: string;
  example: string;
  sourceNodeLabel?: string;
};

const DEFAULT_VARIABLES: AvailableVariable[] = [
  { path: "customer.email", label: "Customer Email", example: "sarah@example.com", sourceNodeLabel: "Trigger Input" },
  { path: "customer.name", label: "Customer Name", example: "Sarah Connor", sourceNodeLabel: "Trigger Input" },
  { path: "customer.score", label: "Customer Score", example: "85", sourceNodeLabel: "Trigger Input" },
  { path: "order.id", label: "Order ID", example: "ORD-9481", sourceNodeLabel: "Trigger Input" },
  { path: "order.amount", label: "Order Amount", example: "150", sourceNodeLabel: "Trigger Input" },
  { path: "order.status", label: "Order Status", example: "completed", sourceNodeLabel: "Trigger Input" },
  { path: "message", label: "Inbound Message", example: "Hello there", sourceNodeLabel: "Trigger Input" },
];

export function VariablePicker({
  onSelectVariable,
  availableVariables = DEFAULT_VARIABLES,
}: {
  onSelectVariable: (path: string) => void;
  availableVariables?: AvailableVariable[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = availableVariables.filter(
    (v) =>
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.path.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50/80 px-2 py-0.5 text-[11px] font-medium text-teal-900 transition hover:bg-teal-100 hover:border-teal-300"
        title="Insert a variable from previous steps"
      >
        <Variable size={12} className="text-teal-700" />
        <span>+ Insert Variable</span>
        <ChevronDown size={11} className="text-teal-600" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-50 mt-1 w-64 rounded-xl border border-border bg-white p-2 shadow-xl">
            <div className="mb-2 px-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search variables..."
                className="w-full rounded-md border border-border bg-stone-50 px-2 py-1 text-xs text-stone-800 placeholder-stone-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filtered.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  onClick={() => {
                    onSelectVariable(v.path);
                    setOpen(false);
                  }}
                  className="flex w-full items-start justify-between rounded-lg p-1.5 text-left text-xs transition hover:bg-stone-100"
                >
                  <div>
                    <div className="font-medium text-stone-900 text-[11px]">
                      {v.label}
                    </div>
                    <div className="font-mono text-[10px] text-teal-800">
                      {v.path}
                    </div>
                  </div>
                  <span className="text-[10px] text-stone-400 font-mono">
                    {v.example}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="p-2 text-center text-xs text-stone-400">
                  No matching variables
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

