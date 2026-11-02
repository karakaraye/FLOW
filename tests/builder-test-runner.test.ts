import test from "node:test";
import assert from "node:assert/strict";
import { runClientSimulation } from "../src/lib/builder/test-runner";
import type { Definition } from "../src/lib/engine/definition";

test("Client Simulation: runs a branching workflow and tracks active branches", () => {
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [
      { id: "root", type: "manual_trigger", config: {} },
      {
        id: "step_prepare",
        type: "set_data",
        config: { values: { score: 95, vip: true } },
      },
      {
        id: "step_check",
        type: "condition",
        config: { path: "score", operator: "gt", value: 50 },
      },
      {
        id: "step_vip_branch",
        type: "log_event",
        config: { message: "VIP detected" },
      },
      {
        id: "step_standard_branch",
        type: "log_event",
        config: { message: "Standard detected" },
      },
    ],
    edges: [
      { from: "root", to: "step_prepare" },
      { from: "step_prepare", to: "step_check" },
      { from: "step_check", to: "step_vip_branch", branch: "true" },
      { from: "step_check", to: "step_standard_branch", branch: "false" },
    ],
  };

  const report = runClientSimulation(definition, {
    root: { label: "Manual Trigger" },
    step_prepare: { label: "Set VIP Data" },
    step_check: { label: "Check VIP Score" },
    step_vip_branch: { label: "VIP Handler" },
    step_standard_branch: { label: "Standard Handler" },
  });

  assert.equal(report.success, true);
  assert.equal(report.totalSteps, 5);
  assert.equal(report.succeededSteps, 4); // root, prepare, check, vip_branch
  assert.equal(report.skippedSteps, 1); // standard_branch skipped because score > 50

  const vipStep = report.steps.find((s) => s.nodeId === "step_vip_branch");
  assert.equal(vipStep?.status, "SUCCEEDED");

  const stdStep = report.steps.find((s) => s.nodeId === "step_standard_branch");
  assert.equal(stdStep?.status, "SKIPPED");
});

test("Client Simulation: handles simulated AI and external nodes cleanly", () => {
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [
      { id: "t1", type: "webhook_trigger", config: {} },
      { id: "ai1", type: "ai_summarize", config: {} },
      { id: "h1", type: "http_request", config: { url: "https://api.example.com", method: "POST" } },
    ],
    edges: [
      { from: "t1", to: "ai1" },
      { from: "ai1", to: "h1" },
    ],
  };

  const report = runClientSimulation(definition, {}, { text: "Long customer feedback..." });
  assert.equal(report.success, true);
  assert.equal(report.succeededSteps, 3);
  assert.equal(report.failedSteps, 0);

  const aiStep = report.steps.find((s) => s.nodeId === "ai1");
  assert.equal(aiStep?.status, "SUCCEEDED");
  assert.equal((aiStep?.output as any)?.simulated, true);
});

