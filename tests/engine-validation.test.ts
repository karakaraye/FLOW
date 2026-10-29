import assert from "node:assert/strict";
import { test } from "node:test";
import {
  audit,
  Json,
  Definition,
  LIMITS,
  validateDefinition,
} from "../src/lib/engine/definition";
import { execute, executors } from "../src/lib/engine/executor";
import { starterDefinition } from "../src/lib/engine/example";
import { branching } from "./engine-fixtures";

function altered(change: (d: Definition) => void) {
  const d = structuredClone(starterDefinition);
  change(d);
  return d;
}
test("versioned graph validator", async (t) => {
  await t.test("valid starter graph and branch join accepted", () => {
    assert.deepEqual(validateDefinition(starterDefinition), starterDefinition);
    assert.deepEqual(validateDefinition(branching), branching);
  });
  await t.test("duplicate node IDs rejected", () =>
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.nodes[1].id = "start";
        }),
      ),
    ),
  );
  await t.test("unknown edge targets and duplicate edges rejected", () => {
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.edges[0].to = "unknown";
        }),
      ),
    );
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.edges.push({ ...d.edges[0] });
        }),
      ),
    );
  });
  await t.test(
    "unsupported node types and arbitrary code config rejected",
    () => {
      assert.throws(() =>
        validateDefinition(
          altered((d) => {
            Object.assign(d.nodes[1], { type: "eval" });
          }),
        ),
      );
      assert.throws(() =>
        validateDefinition(
          altered((d) => {
            d.nodes[1].config.code = "return process.env";
          }),
        ),
      );
    },
  );
  await t.test("missing connections and disconnected nodes rejected", () =>
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.edges = [];
        }),
      ),
    ),
  );
  await t.test("cycles and multiple triggers rejected", () => {
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.edges.push({ from: "record", to: "prepare" });
        }),
      ),
    );
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.nodes[1].type = "manual_trigger";
          d.nodes[1].config = {};
        }),
      ),
    );
  });
  await t.test("conditions require both labeled branches", () => {
    const d = structuredClone(branching);
    delete d.edges[1].branch;
    assert.throws(() => validateDefinition(d));
  });
  await t.test("malformed nodes, versions, and configuration rejected", () => {
    for (const d of [
      null,
      {},
      { ...starterDefinition, schemaVersion: 2 },
      altered((d) => {
        d.nodes[1].config = { values: [] };
      }),
    ])
      assert.throws(() => validateDefinition(d));
  });
  await t.test("prototype paths and keys rejected", () => {
    const d = structuredClone(branching);
    d.nodes[1].config.path = "__proto__.x";
    assert.throws(() => validateDefinition(d));
    assert.throws(() =>
      validateDefinition(
        JSON.parse('{"schemaVersion":1,"__proto__":{},"nodes":[],"edges":[]}'),
      ),
    );
  });
  await t.test("definition size and depth bounded", () => {
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          d.nodes[1].config.values = {
            text: "x".repeat(LIMITS.definitionBytes),
          };
        }),
      ),
    );
    assert.throws(() =>
      validateDefinition(
        altered((d) => {
          while (d.nodes.length <= LIMITS.nodes)
            d.nodes.push({
              id: `n${d.nodes.length}`,
              type: "log_event",
              config: { message: "x" },
            });
        }),
      ),
    );
  });
});
test("deterministic node execution", async (t) => {
  await t.test("set_data merges data and log_event passes it through", () => {
    assert.deepEqual(
      executors.set_data({ original: 1 }, { values: { ready: true } }).output,
      { original: 1, ready: true },
    );
    assert.deepEqual(
      executors.log_event({ x: 1 }, { message: "hidden" }).output,
      { x: 1 },
    );
    assert.equal(execute(starterDefinition, {}).status, "SUCCEEDED");
  });
  await t.test(
    "true and false branches skip inactive nodes and join correctly",
    () => {
      for (const [score, skipped, active] of [
        [11, "no", "yes"],
        [2, "yes", "no"],
      ] as const) {
        const result = execute(branching, { score });
        assert.equal(result.status, "SUCCEEDED");
        assert.equal(
          result.nodes.find((n) => n.nodeId === skipped)?.status,
          "SKIPPED",
        );
        assert.equal(
          result.nodes.find((n) => n.nodeId === active)?.status,
          "SUCCEEDED",
        );
        assert.equal(
          result.nodes.find((n) => n.nodeId === "join")?.status,
          "SUCCEEDED",
        );
      }
    },
  );
  await t.test("graph array order does not alter execution order", () => {
    const d = structuredClone(branching);
    d.nodes.reverse();
    d.edges.reverse();
    const a = execute(branching, { score: 12 }),
      b = execute(d, { score: 12 });
    assert.deepEqual(
      a.nodes.map((n) => [n.nodeId, n.status, n.input, n.output]),
      b.nodes.map((n) => [n.nodeId, n.status, n.input, n.output]),
    );
  });
  await t.test("missing data and numeric type mismatch fail safely", () => {
    for (const input of [{}, { score: "secret-value" }] as Json[]) {
      const r = execute(branching, input);
      assert.equal(r.status, "FAILED");
      assert.equal(r.nodes.find((n) => n.nodeId === "check")?.status, "FAILED");
      assert.equal(r.nodes.find((n) => n.nodeId === "yes")?.status, "SKIPPED");
      assert.doesNotMatch(JSON.stringify(r), /secret-value/);
    }
  });
  await t.test(
    "duration limit records failure and skips remaining nodes",
    () => {
      let clock = 0;
      const r = execute(
        starterDefinition,
        {},
        { now: () => clock++, maxMs: 1 },
      );
      assert.equal(r.error, "EXECUTION_TIMEOUT");
      assert.equal(r.nodes.filter((n) => n.status === "FAILED").length, 1);
      assert.equal(r.nodes.filter((n) => n.status === "SKIPPED").length, 2);
    },
  );
  await t.test(
    "audit records contain no submitted keys, values, or messages",
    () => {
      const secret = {
        apiKey: "sk-secret",
        password: "never-store",
        nested: { credential: "raw-token" },
      };
      const r = execute(starterDefinition, secret);
      assert.doesNotMatch(
        JSON.stringify(r),
        /sk-secret|never-store|raw-token|apiKey|password|nested/,
      );
      assert.deepEqual(audit(secret), { kind: "object", fields: 3 });
    },
  );
});
