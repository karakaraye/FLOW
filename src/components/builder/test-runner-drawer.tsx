"use client";
import { useState } from "react";
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Code2,
  X,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Button } from "../ui/button";
import type { Definition, Json } from "@/lib/engine/definition";
import {
  runClientSimulation,
  type TestRunReport,
  type TestStepResult,
} from "@/lib/builder/test-runner";

const SAMPLE_PAYLOADS = [
  {
    name: "New Lead Submission",
    payload: {
      event: "lead_created",
      customer: {
        name: "Sarah Connor",
        email: "sarah@cyberdyne.io",
        score: 88,
        inquiry: "Interested in enterprise workflow automation features.",
      },
    },
  },
  {
    name: "VIP Order Completed",
    payload: {
      event: "order_completed",
      order: {
        id: "ORD-9481",
        amount: 250,
        currency: "USD",
        items_count: 3,
        status: "paid",
      },
    },
  },
  {
    name: "Inbound WhatsApp Inquire",
    payload: {
      event: "whatsapp_message",
      from: "15551234567",
      text: "Can someone help me set up a Google Sheets integration?",
      timestamp: new Date().toISOString(),
    },
  },
];

export function TestRunnerDrawer({
  definition,
  labels,
  isOpen,
  onClose,
  onHighlightNodes,
}: {
  definition: Definition;
  labels: Record<string, { label?: string }>;
  isOpen: boolean;
  onClose: () => void;
  onHighlightNodes?: (nodeStatuses: Record<string, "SUCCEEDED" | "FAILED" | "SKIPPED">) => void;
}) {
  const [inputJson, setInputJson] = useState<string>(() =>
    JSON.stringify(SAMPLE_PAYLOADS[0].payload, null, 2),
  );
  const [activeTab, setActiveTab] = useState<"input" | "results">("input");
  const [report, setReport] = useState<TestRunReport | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [jsonError, setJsonError] = useState("");

  if (!isOpen) return null;

  function handleRun() {
    setJsonError("");
    let parsedInput: Json = {};
    try {
      parsedInput = JSON.parse(inputJson);
    } catch {
      setJsonError("Input must be valid JSON.");
      return;
    }

    const res = runClientSimulation(definition, labels, parsedInput);
    setReport(res);
    setActiveTab("results");

    if (onHighlightNodes) {
      const map: Record<string, "SUCCEEDED" | "FAILED" | "SKIPPED"> = {};
      for (const step of res.steps) {
        map[step.nodeId] = step.status;
      }
      onHighlightNodes(map);
    }

    // Auto-expand first 2 steps
    const exp: Record<string, boolean> = {};
    res.steps.slice(0, 3).forEach((s) => (exp[s.nodeId] = true));
    setExpandedSteps(exp);
  }

  function toggleStep(id: string) {
    setExpandedSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-white shadow-2xl transition-all sm:max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-stone-50 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-800 text-white shadow-xs">
            <Play size={13} fill="currentColor" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-stone-900">
              Interactive Test Runner
            </h2>
            <p className="text-[11px] text-stone-500">
              Simulate end-to-end execution directly in the canvas
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          type="button"
          aria-label="Close test runner"
          className="rounded-lg p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-white px-5">
        <button
          type="button"
          onClick={() => setActiveTab("input")}
          className={`border-b-2 px-4 py-2 text-xs font-semibold transition ${
            activeTab === "input"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          1. Test Trigger Input
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("results")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-semibold transition ${
            activeTab === "results"
              ? "border-teal-800 text-teal-900"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          2. Step Execution Trace
          {report && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                report.success
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {report.succeededSteps}/{report.totalSteps}
            </span>
          )}
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === "input" ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-stone-800">
                Preset Sample Inputs:
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {SAMPLE_PAYLOADS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() =>
                      setInputJson(JSON.stringify(preset.payload, null, 2))
                    }
                    className="rounded-lg border border-border bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:border-teal-700 hover:bg-teal-50 hover:text-teal-900"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="test-payload-input"
                  className="text-xs font-semibold text-stone-800"
                >
                  Trigger Payload (JSON):
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setInputJson(JSON.stringify(JSON.parse(inputJson), null, 2));
                    } catch {}
                  }}
                  className="text-[10px] text-teal-800 underline"
                >
                  Format JSON
                </button>
              </div>
              <textarea
                id="test-payload-input"
                value={inputJson}
                onChange={(e) => setInputJson(e.target.value)}
                rows={14}
                className="mt-1.5 w-full rounded-xl border border-border bg-stone-900 p-3.5 font-mono text-xs text-stone-100 shadow-inner focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              {jsonError && (
                <p className="mt-1 text-xs text-red-600">{jsonError}</p>
              )}
            </div>

            <Button onClick={handleRun} className="w-full gap-2">
              <Play size={14} fill="currentColor" />
              Run Step Simulation
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {!report ? (
              <div className="py-12 text-center text-sm text-stone-500">
                <p>No test run yet.</p>
                <Button onClick={handleRun} variant="outline" className="mt-4 gap-2">
                  <Play size={13} fill="currentColor" />
                  Run Test with Current Input
                </Button>
              </div>
            ) : (
              <>
                {/* Summary Card */}
                <div
                  className={`rounded-xl border p-4 ${
                    report.success
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                      : "border-red-200 bg-red-50/70 text-red-950"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      {report.success ? (
                        <CheckCircle2 size={18} className="text-emerald-700" />
                      ) : (
                        <XCircle size={18} className="text-red-700" />
                      )}
                      <span>
                        {report.success
                          ? "Flow Simulation Succeeded"
                          : "Flow Simulation Encountered Issues"}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-stone-600">
                      <Clock size={12} />
                      {report.durationMs}ms
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs">
                    <span>
                      <strong>{report.succeededSteps}</strong> passed
                    </span>
                    {report.skippedSteps > 0 && (
                      <span className="text-stone-500">
                        <strong>{report.skippedSteps}</strong> skipped
                      </span>
                    )}
                    {report.failedSteps > 0 && (
                      <span className="text-red-700">
                        <strong>{report.failedSteps}</strong> failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Steps List */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    Execution Steps ({report.steps.length})
                  </h3>
                  {report.steps.map((step, idx) => {
                    const isExpanded = expandedSteps[step.nodeId];
                    const statusColor =
                      step.status === "SUCCEEDED"
                        ? "text-emerald-700 border-emerald-200 bg-emerald-50/40"
                        : step.status === "FAILED"
                          ? "text-red-700 border-red-200 bg-red-50/40"
                          : "text-stone-400 border-stone-200 bg-stone-50/40";

                    return (
                      <div
                        key={step.nodeId}
                        className={`overflow-hidden rounded-xl border bg-white transition shadow-2xs ${statusColor}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleStep(step.nodeId)}
                          className="flex w-full items-center justify-between p-3 text-left hover:bg-stone-50"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200/70 text-[10px] font-bold text-stone-700">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs text-stone-900">
                                  {step.label}
                                </span>
                                {step.branch && (
                                  <span
                                    className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                                      step.branch === "true"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    branch: {step.branch}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-stone-500">
                                {step.type}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold">
                              {step.status}
                            </span>
                            {isExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-border bg-stone-50 p-3 space-y-2.5 text-xs">
                            {step.error && (
                              <div className="rounded-lg bg-red-100/80 p-2 text-red-900 text-xs">
                                <strong>Error:</strong> {step.error}
                              </div>
                            )}

                            <div>
                              <span className="text-[10px] font-bold text-stone-600 uppercase">
                                Step Input:
                              </span>
                              <pre className="mt-1 max-h-36 overflow-auto rounded-lg bg-stone-900 p-2 text-[11px] text-stone-100 font-mono">
                                {JSON.stringify(step.input, null, 2)}
                              </pre>
                            </div>

                            {step.output !== undefined && (
                              <div>
                                <span className="text-[10px] font-bold text-stone-600 uppercase">
                                  Step Output:
                                </span>
                                <pre className="mt-1 max-h-36 overflow-auto rounded-lg bg-stone-900 p-2 text-[11px] text-emerald-300 font-mono">
                                  {JSON.stringify(step.output, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleRun}
                    variant="outline"
                    className="w-full gap-2 text-xs"
                  >
                    <RefreshCw size={13} />
                    Re-run Simulation
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

