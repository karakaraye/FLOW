import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodePanel } from "../src/components/builder/node-panel";
import {
  connect,
  fingerprint,
  fromCanvas,
  historyReducer,
  normalizeDocument,
  remove,
  toCanvas,
  type History,
} from "../src/lib/builder/document";
import { validateEditor } from "../src/lib/builder/metadata";
import { starterDefinition } from "../src/lib/engine/example";
import { assertJson, validateDefinition } from "../src/lib/engine/definition";
import { execute } from "../src/lib/engine/executor";
import { branching } from "./engine-fixtures";
test("visual document conversion and editing", async (t) => {
  await t.test(
    "round-trips existing graphs, IDs, configs, and branch handles",
    () => {
      for (const definition of [starterDefinition, branching]) {
        const doc = normalizeDocument("Test", definition);
        const graph = toCanvas(doc);
        assert.deepEqual(fromCanvas(graph.nodes, graph.edges), definition);
        if (definition === branching) {
          assert.equal(
            graph.edges.filter((e) => e.sourceHandle === "true").length,
            1,
          );
          assert.equal(
            graph.edges.filter((e) => e.sourceHandle === "false").length,
            1,
          );
        }
      }
    },
  );
  await t.test(
    "layout and labels change neither definition nor execution",
    () => {
      const a = normalizeDocument("Test", branching);
      const b = structuredClone(a);
      b.editor.nodes.start = { x: -120, y: 430, label: "Custom label" };
      assert.notEqual(fingerprint(a), fingerprint(b));
      assert.deepEqual(
        fromCanvas(toCanvas(a).nodes, toCanvas(a).edges),
        fromCanvas(toCanvas(b).nodes, toCanvas(b).edges),
      );
      assert.deepEqual(
        execute(a.definition, { score: 12 }).nodes.map((n) => [
          n.nodeId,
          n.status,
          n.output,
        ]),
        execute(b.definition, { score: 12 }).nodes.map((n) => [
          n.nodeId,
          n.status,
          n.output,
        ]),
      );
    },
  );
  await t.test(
    "undo/redo restores nodes, connections, labels and layout; edits clear redo",
    () => {
      const a = normalizeDocument("A", starterDefinition);
      let state: History = { present: a, past: [], future: [] };
      const changed = { ...a, name: "B" };
      state = historyReducer(state, { type: "change", document: changed });
      state = historyReducer(state, { type: "undo" });
      assert.deepEqual(state.present, a);
      state = historyReducer(state, { type: "redo" });
      assert.deepEqual(state.present, changed);
      state = historyReducer(state, { type: "undo" });
      state = historyReducer(state, {
        type: "change",
        document: { ...a, name: "C" },
      });
      assert.equal(state.future.length, 0);
    },
  );
  await t.test(
    "drag previews form one undo step; history stays bounded",
    () => {
      const doc = normalizeDocument("A", starterDefinition);
      let state: History = { present: doc, past: [], future: [] };
      state = historyReducer(state, { type: "checkpoint" });
      for (let i = 0; i < 10; i++)
        state = historyReducer(state, {
          type: "preview",
          document: {
            ...state.present,
            editor: {
              ...state.present.editor,
              nodes: {
                ...state.present.editor.nodes,
                start: { ...state.present.editor.nodes.start, x: i * 10 },
              },
            },
          },
        });
      assert.equal(state.past.length, 1);
      state = historyReducer(state, { type: "undo" });
      assert.deepEqual(state.present, doc);
      for (let i = 0; i < 100; i++)
        state = historyReducer(state, {
          type: "change",
          document: { ...doc, name: String(i) },
        });
      assert.equal(state.past.length, 50);
    },
  );
  await t.test(
    "deleting a node removes incident edges and metadata; edges can be deleted alone",
    () => {
      const doc = normalizeDocument("A", starterDefinition);
      const without = remove(doc, ["prepare"], []);
      assert.equal(without.definition.nodes.length, 2);
      assert.equal(without.definition.edges.length, 0);
      assert.equal(without.editor.nodes.prepare, undefined);
      const graph = toCanvas(doc);
      assert.equal(
        remove(doc, [], [graph.edges[0].id]).definition.edges.length,
        1,
      );
    },
  );
  await t.test(
    "connection controls preserve branch semantics; invalid cycles still rejected",
    () => {
      const doc = normalizeDocument("A", branching);
      const duplicate = connect(doc, "check", "yes", "true");
      assert.deepEqual(duplicate, doc);
      const cyclic = connect(doc, "join", "check", "out");
      assert.throws(() => validateDefinition(cyclic.definition));
    },
  );
  await t.test(
    "metadata rejects foreign IDs, code fields, excessive positions, empty labels and prototype keys",
    () => {
      for (const value of [
        {
          schemaVersion: 1,
          nodes: { foreign: { x: 0, y: 0, label: "Wrong" } },
        },
        {
          schemaVersion: 1,
          nodes: { start: { x: Infinity, y: 0, label: "Wrong" } },
        },
        { schemaVersion: 1, nodes: { start: { x: 0, y: 0, label: "" } } },
        {
          schemaVersion: 1,
          nodes: { start: { x: 0, y: 0, label: "OK", code: "eval()" } },
        },
        JSON.parse(
          '{"schemaVersion":1,"nodes":{"__proto__":{"x":0,"y":0,"label":"Bad"}}}',
        ),
      ])
        assert.throws(() => validateEditor(value, starterDefinition));
    },
  );
  await t.test("browser-portable byte limits retain UTF-8 behavior", () => {
    const input = "🙂é";
    const bytes = Buffer.byteLength(JSON.stringify(input));
    assert.doesNotThrow(() => assertJson(input, bytes));
    assert.throws(() => assertJson(input, bytes - 1));
  });
});
test("node configuration component contracts", async (t) => {
  const noop = () => {};
  await t.test(
    "viewer panel is read-only and cannot submit modifications",
    () => {
      const html = renderToStaticMarkup(
        createElement(NodePanel, {
          node: starterDefinition.nodes[1],
          label: "Prepare",
          readOnly: true,
          onApply: noop,
          onDirty: noop,
        }),
      );
      assert.match(html, /disabled=""/);
      assert.doesNotMatch(html, /Apply configuration/);
      assert.match(html, /ID: prepare/);
      assert.match(html, /Set Data values/);
    },
  );
  await t.test(
    "condition panel exposes path, literal operand and supported operators",
    () => {
      const html = renderToStaticMarkup(
        createElement(NodePanel, {
          node: branching.nodes[1],
          label: "Check",
          readOnly: false,
          onApply: noop,
          onDirty: noop,
        }),
      );
      for (const id of [
        "condition-path",
        "condition-operator",
        "condition-value",
      ])
        assert.match(html, new RegExp(`id="${id}"`));
      for (const op of ["equals", "not_equals", "gt", "exists"])
        assert.match(html, new RegExp(`value="${op}"`));
      assert.match(html, /Apply configuration/);
    },
  );
});
