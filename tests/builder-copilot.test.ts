import test from "node:test";
import assert from "node:assert/strict";
import {
  generateWorkflowFromPrompt,
  COPILOT_PRESETS,
} from "../src/lib/builder/ai-copilot";
import { validateDefinition } from "../src/lib/engine/definition";
import { validateEditor } from "../src/lib/builder/metadata";

test("AI Workflow Copilot generator", async (t) => {
  await t.test("all copilot presets generate valid definitions and layout", () => {
    for (const preset of COPILOT_PRESETS) {
      const doc = generateWorkflowFromPrompt(preset.prompt);
      assert.doesNotThrow(() => validateDefinition(doc.definition));
      assert.doesNotThrow(() => validateEditor(doc.editor, doc.definition));
      assert.ok(doc.definition.nodes.length >= 3);
      assert.ok(doc.definition.edges.length >= 2);
    }
  });

  await t.test("identifies WhatsApp trigger from prompt keywords", () => {
    const doc = generateWorkflowFromPrompt("When a WhatsApp message is received, reply back");
    assert.equal(doc.definition.nodes[0].type, "whatsapp_message_received");
    assert.doesNotThrow(() => validateDefinition(doc.definition));
  });

  await t.test("identifies Webhook trigger from prompt keywords", () => {
    const doc = generateWorkflowFromPrompt("When an order webhook arrives, save to sheets");
    assert.equal(doc.definition.nodes[0].type, "webhook_trigger");
    assert.doesNotThrow(() => validateDefinition(doc.definition));
  });

  await t.test("handles conditional branching cleanly", () => {
    const doc = generateWorkflowFromPrompt("When an order comes in, check if amount > 100, then send email");
    const cond = doc.definition.nodes.find((n) => n.type === "condition");
    assert.ok(cond, "Condition node should be present");
    const trueEdge = doc.definition.edges.find((e) => e.from === cond?.id && e.branch === "true");
    const falseEdge = doc.definition.edges.find((e) => e.from === cond?.id && e.branch === "false");
    assert.ok(trueEdge, "True branch edge must exist");
    assert.ok(falseEdge, "False branch edge must exist");
    assert.doesNotThrow(() => validateDefinition(doc.definition));
  });
});
