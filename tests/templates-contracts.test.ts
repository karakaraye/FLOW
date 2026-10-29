import assert from "node:assert/strict";
import { test } from "node:test";
import { seedCatalog } from "../src/lib/templates/catalog";
import {
  categories,
  parseFilters,
  validateContent,
} from "../src/lib/templates/contracts";
import { cloneTemplate } from "../src/lib/templates/service";
import { normalizeDocument } from "../src/lib/builder/document";
import {
  type Definition,
  validateDefinition,
} from "../src/lib/engine/definition";
import { execute } from "../src/lib/engine/executor";
test("built-in catalog contracts and template conversion", async (t) => {
  await t.test(
    "seven starters cover every supported category and validate with the actual engine",
    () => {
      assert.equal(seedCatalog.length, 7);
      assert.deepEqual(
        new Set(seedCatalog.map((t) => t.content.category)),
        new Set(categories),
      );
      for (const template of seedCatalog) {
        validateContent(template.content);
        validateDefinition(template.content.definition);
        assert.equal(
          execute(template.content.definition, template.content.exampleInput)
            .status,
          "SUCCEEDED",
        );
      }
    },
  );
  await t.test(
    "cloning preserves local semantic IDs and independently copies labels, literal data and edges",
    () => {
      for (const template of seedCatalog) {
        const a = cloneTemplate(template.content),
          b = cloneTemplate(template.content);
        validateDefinition(a.definition);
        assert.deepEqual(a.definition, template.content.definition);
        assert.notStrictEqual(a.definition.nodes[0], b.definition.nodes[0]);
        assert.notStrictEqual(a.editor.nodes, b.editor.nodes);
        assert.deepEqual(
          new Set(Object.keys(a.nodeMap)),
          new Set(template.content.definition.nodes.map((n) => n.id)),
        );
        for (const edge of template.content.definition.edges)
          assert.ok(
            a.definition.edges.some(
              (e) =>
                e.from === a.nodeMap[edge.from] &&
                e.to === a.nodeMap[edge.to] &&
                e.branch === edge.branch,
            ),
          );
        const source = execute(
            template.content.definition,
            template.content.exampleInput,
          ),
          copy = execute(a.definition, template.content.exampleInput);
        assert.deepEqual(
          new Map(source.nodes.map((n) => [a.nodeMap[n.nodeId], n.status])),
          new Map(copy.nodes.map((n) => [n.nodeId, n.status])),
        );
        a.definition.nodes[0].config.changed = true;
        assert.equal(
          template.content.definition.nodes[0].config.changed,
          undefined,
        );
      }
    },
  );
  await t.test(
    "fan-in field references retain their execution semantics after installation",
    () => {
      const definition: Definition = {
        schemaVersion: 1,
        nodes: [
          { id: "start", type: "manual_trigger", config: {} },
          { id: "left", type: "set_data", config: { values: { score: 20 } } },
          {
            id: "right",
            type: "set_data",
            config: { values: { note: "literal" } },
          },
          {
            id: "check",
            type: "condition",
            config: { path: "left.score", operator: "gt", value: 10 },
          },
          { id: "yes", type: "log_event", config: { message: "yes" } },
          { id: "no", type: "log_event", config: { message: "no" } },
        ],
        edges: [
          { from: "start", to: "left" },
          { from: "start", to: "right" },
          { from: "left", to: "check" },
          { from: "right", to: "check" },
          { from: "check", to: "yes", branch: "true" },
          { from: "check", to: "no", branch: "false" },
        ],
      };
      const content = {
        ...seedCatalog[1].content,
        definition,
        editor: normalizeDocument("Fan-in", definition).editor,
      };
      const copy = cloneTemplate(validateContent(content));
      const result = execute(copy.definition, {});
      assert.equal(result.status, "SUCCEEDED");
      assert.equal(
        result.nodes.find((n) => n.nodeId === "yes")?.status,
        "SUCCEEDED",
      );
      assert.equal(
        result.nodes.find((n) => n.nodeId === "no")?.status,
        "SKIPPED",
      );
    },
  );
  await t.test(
    "bad schema, unsupported nodes, invalid categories and unsafe metadata are rejected",
    () => {
      for (const content of [
        { ...seedCatalog[0].content, schemaVersion: 2 },
        { ...seedCatalog[0].content, category: "Gmail" },
        {
          ...seedCatalog[0].content,
          definition: {
            schemaVersion: 1,
            nodes: [{ id: "http", type: "http", config: {} }],
            edges: [],
          },
        },
        {
          ...seedCatalog[0].content,
          editor: {
            schemaVersion: 1,
            nodes: { foreign: { x: 0, y: 0, label: "Wrong" } },
          },
        },
      ])
        assert.throws(() => validateContent(content));
    },
  );
  await t.test("search inputs are bounded and categories are explicit", () => {
    assert.deepEqual(parseFilters("  Lead ", "Sales Operations"), {
      query: "lead",
      category: "Sales Operations",
    });
    assert.throws(() => parseFilters("x".repeat(101), null));
    assert.throws(() => parseFilters(null, "Unknown"));
  });
});
