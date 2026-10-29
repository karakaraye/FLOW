import { spawn } from "node:child_process";
import { test, expect, login } from "./fixtures";
import type { Page, Locator } from "@playwright/test";
import { db } from "../src/lib/db";
import { starterDefinition } from "../src/lib/engine/example";
import { branching } from "../tests/engine-fixtures";
async function addNode(page: Page, kind: string, drag = false) {
  const existing = await page.locator(`[data-node-kind="${kind}"]`).count();
  if (drag)
    await page
      .getByTestId(`add-${kind}`)
      .dragTo(page.getByTestId("workflow-canvas"), {
        targetPosition: { x: 340, y: 180 },
      });
  else await page.getByTestId(`add-${kind}`).click();
  await expect(page.locator(`[data-node-kind="${kind}"]`)).toHaveCount(
    existing + 1,
  );
  const node = page.locator(`[data-node-kind="${kind}"]`).last();
  const id = (await node.getAttribute("data-testid"))!.replace(
    "workflow-node-",
    "",
  );
  return { node: page.getByTestId(`workflow-node-${id}`), id };
}
async function configure(
  page: Page,
  node: Locator,
  label: string,
  fields: Record<string, string> = {},
) {
  await node.click({ position: { x: 80, y: 55 } });
  await page.getByLabel("Node label", { exact: true }).fill(label);
  for (const [name, value] of Object.entries(fields)) {
    const field = page.getByLabel(name, { exact: true });
    if (name === "Comparison operator") await field.selectOption(value);
    else await field.fill(value);
  }
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await expect(node.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByTestId("save-state")).not.toHaveText(
    "Unapplied configuration",
  );
}
async function connectHandles(
  page: Page,
  source: Locator,
  target: Locator,
  handle = "out",
) {
  const before = await page.locator(".react-flow__edge").count();
  const from = source.locator(`[data-handleid="${handle}"]`);
  const to = target.locator('[data-handleid="in"]');
  await from.scrollIntoViewIfNeeded();
  await from.hover();
  await to.hover();
  const a = await from.boundingBox(),
    b = await to.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(before + 1);
}
async function processRun(id: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", id],
    { stdio: "ignore" },
  );
  const exit = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  expect(exit).toBe(0);
}

test("visual lifecycle: create, connect, reopen, publish, execute, and preserve snapshots", async ({
  page,
  actors,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let workflowId = "",
    publishedId = "";
  let beforeDefinition: unknown, beforeEditor: unknown;
  await test.step("real login and visual creation with native drag-and-drop", async () => {
    await login(page, actors.owner);
    await page.getByRole("link", { name: "Workflows", exact: true }).click();
    await page.getByRole("link", { name: "New workflow", exact: true }).click();
    await expect(
      page.getByLabel("Workflow name", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Workflow name", { exact: true })
      .fill("Visual E2E automation");
  });
  const start = await addNode(page, "manual_trigger");
  await configure(page, start.node, "Start here");
  const prepare = await addNode(page, "set_data", true);
  await configure(page, prepare.node, "Prepare data", {
    "Set Data values (JSON object)": '{"tag":"visual"}',
  });
  const condition = await addNode(page, "condition");
  await configure(page, condition.node, "Score check", {
    "Input field path": "score",
    "Comparison operator": "gt",
    "Comparison value (literal JSON)": "10",
  });
  const yes = await addNode(page, "log_event");
  await configure(page, yes.node, "Accepted", {
    "Event message": "Accepted event",
  });
  const no = await addNode(page, "log_event");
  await configure(page, no.node, "Other path", {
    "Event message": "Other event",
  });
  await test.step("connect handles including TRUE and FALSE", async () => {
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    await connectHandles(page, start.node, prepare.node);
    await connectHandles(page, prepare.node, condition.node);
    await connectHandles(page, condition.node, yes.node, "true");
    await connectHandles(page, condition.node, no.node, "false");
    await expect(page.getByTestId("graph-validation")).toContainText(
      "Graph valid",
    );
  });
  await test.step("zoom, minimap, node dragging, undo and redo", async () => {
    await expect(
      page.getByLabel("Workflow minimap", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__minimap-node")).toHaveCount(5);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    const wrapper = start.node.locator("..");
    const before = await wrapper.getAttribute("style");
    const box = await start.node.boundingBox();
    await page.mouse.move(box!.x + 30, box!.y + 25);
    await page.mouse.down();
    await page.mouse.move(box!.x + 85, box!.y + 70, { steps: 10 });
    await page.mouse.up();
    expect(await wrapper.getAttribute("style")).not.toBe(before);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(wrapper).toHaveAttribute("style", before!);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    expect(await wrapper.getAttribute("style")).not.toBe(before);
  });
  await test.step("save and reopen exact graph and layout", async () => {
    await expect(page.getByTestId("save-state")).toContainText(
      "Unsaved changes",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(/\/workflows\/(?!new$)[^/]+$/);
    workflowId = page.url().split("/").at(-1)!;
    await expect(page.getByTestId("save-state")).toContainText("Saved");
    const saved = await db.workflow.findUniqueOrThrow({
      where: { id: workflowId },
    });
    expect((saved.draft as { nodes: unknown[] }).nodes).toHaveLength(5);
    expect((saved.draft as { edges: unknown[] }).edges).toHaveLength(4);
    beforeEditor = saved.editor;
    await page.reload();
    await expect(page.getByTestId(`workflow-node-${prepare.id}`)).toContainText(
      "Prepare data",
    );
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
    expect(
      (await db.workflow.findUniqueOrThrow({ where: { id: workflowId } }))
        .editor,
    ).toEqual(beforeEditor);
    await page.screenshot({
      path: info.outputPath("visual-builder.png"),
      fullPage: true,
    });
  });
  await test.step("publish a validated immutable snapshot", async () => {
    await page
      .getByRole("button", { name: "Publish saved draft", exact: true })
      .click();
    await expect(
      page.getByText("Published immutable version 1.", { exact: true }),
    ).toBeVisible();
    const version = await db.workflowVersion.findFirstOrThrow({
      where: { workflowId },
    });
    publishedId = version.id;
    beforeDefinition = version.definition;
    beforeEditor = version.editor;
  });
  await test.step("execute using a real worker and highlight recorded branch outcomes", async () => {
    await page
      .getByLabel("Run input JSON (up to 16 KiB; no credentials)", {
        exact: true,
      })
      .fill('{"score":12}');
    await page
      .getByRole("button", { name: "Queue manual run", exact: true })
      .click();
    await expect(page).toHaveURL(/\/history\/[^/]+$/);
    const runId = page.url().split("/").at(-1)!;
    await expect(
      page
        .getByRole("status", { name: "", exact: true })
        .filter({ hasText: /^QUEUED$/ }),
    ).toBeVisible();
    await processRun(runId);
    await expect(page.getByTestId(`workflow-node-${yes.id}`)).toHaveAttribute(
      "data-run-status",
      "SUCCEEDED",
    );
    await expect(page.getByTestId(`workflow-node-${no.id}`)).toHaveAttribute(
      "data-run-status",
      "SKIPPED",
    );
    await expect(page.getByTestId("execution-canvas")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("executed-workflow.png"),
      fullPage: true,
    });
  });
  await test.step("editing a new draft does not change the published graph or layout", async () => {
    await page.goto(`/workflows/${workflowId}`);
    await configure(
      page,
      page.getByTestId(`workflow-node-${prepare.id}`),
      "New draft label",
      { "Set Data values (JSON object)": '{"tag":"changed-draft"}' },
    );
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByTestId("save-state")).toContainText("Draft 2");
    const version = await db.workflowVersion.findUniqueOrThrow({
      where: { id: publishedId },
    });
    expect(version.definition).toEqual(beforeDefinition);
    expect(version.editor).toEqual(beforeEditor);
  });
  await test.step("runtime failure is real and sanitized on the executed snapshot", async () => {
    await page
      .getByLabel("Run input JSON (up to 16 KiB; no credentials)", {
        exact: true,
      })
      .fill("{}");
    await page
      .getByRole("button", { name: "Queue manual run", exact: true })
      .click();
    await expect(page).toHaveURL(/\/history\/[^/]+$/);
    const runId = page.url().split("/").at(-1)!;
    await processRun(runId);
    await expect(
      page.getByTestId(`workflow-node-${condition.id}`),
    ).toHaveAttribute("data-run-status", "FAILED");
    await expect(
      page.getByText("Execution failed: MISSING_VALUE", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId(`workflow-node-${prepare.id}`)).toContainText(
      "Prepare data",
    );
    await expect(
      page.getByTestId(`workflow-node-${prepare.id}`),
    ).not.toContainText("New draft label");
  });
  expect(errors).toEqual([]);
});

test("invalid graphs and bad configurations are rejected without overwriting drafts", async ({
  page,
  actors,
}) => {
  await login(page, actors.owner);
  await page.goto("/workflows/new");
  await expect(page.getByTestId("graph-validation")).toContainText(
    "manual trigger",
  );
  await expect(
    page.getByRole("button", { name: "Publish saved draft", exact: true }),
  ).toBeDisabled();
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  const invalids = [
    {
      ...starterDefinition,
      nodes: [starterDefinition.nodes[0], starterDefinition.nodes[0]],
    },
    { ...starterDefinition, edges: [] },
    {
      ...starterDefinition,
      nodes: [{ id: "bad", type: "execute_code", config: {} }],
    },
    {
      ...branching,
      nodes: branching.nodes.map((n) =>
        n.type === "condition"
          ? { ...n, config: { path: "score", operator: "gt", value: "bad" } }
          : n,
      ),
    },
    {
      ...starterDefinition,
      edges: [...starterDefinition.edges, { from: "record", to: "prepare" }],
    },
    { ...starterDefinition, edges: [{ from: "start", to: "missing" }] },
    {
      ...starterDefinition,
      nodes: starterDefinition.nodes.map((n) =>
        n.type === "set_data" ? { ...n, config: {} } : n,
      ),
    },
  ];
  for (const invalid of invalids) {
    await page
      .getByLabel(
        "Import engine definition JSON (replaces the current graph)",
        { exact: true },
      )
      .fill(JSON.stringify(invalid));
    await page
      .getByRole("button", { name: "Import definition", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({
        hasText: /unique|incoming|Unsupported|numeric|Cyclic|existing|values/,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toBeDisabled();
  }
  const node = await addNode(page, "manual_trigger");
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await node.node.click();
  await page
    .getByRole("button", {
      name: "Delete selected nodes or edges",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "manual trigger",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  const response = await page.request.post(
    `/api/workspaces/${actors.workspaceId}/workflows`,
    {
      headers: { Origin: new URL(page.url()).origin },
      data: { name: "Invalid backend", definition: invalids[0] },
    },
  );
  expect(response.status()).toBe(400);
});

test("viewer can inspect but cannot edit, connect, save, publish, or execute", async ({
  page,
  actors,
}) => {
  await login(page, actors.viewer);
  await page.goto(`/workflows/${actors.seedId}`);
  await expect(
    page.getByText(
      "VIEWER · Read-only access. Changes, publishing, and execution are disabled.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Workflow name", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("add-set_data")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish saved draft", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("workflow-node-prepare").click();
  await expect(page.getByLabel("Node label", { exact: true })).toBeDisabled();
  for (const [suffix, data, method] of [
    [
      "",
      {
        revision: 1,
        name: "Unauthorized",
        definition: starterDefinition,
        editor: { schemaVersion: 1, nodes: {} },
      },
      "PATCH",
    ],
    ["/publish", { revision: 1 }, "POST"],
    ["/runs", { versionId: actors.versionId, input: {} }, "POST"],
  ] as const) {
    const response = await page.request.fetch(
      `/api/workspaces/${actors.workspaceId}/workflows/${actors.seedId}${suffix}`,
      {
        method,
        headers: {
          Origin: new URL(page.url()).origin,
          "Idempotency-Key": "viewer-e2e-key",
        },
        data,
      },
    );
    expect(response.status()).toBe(403);
  }
  await page.goto("/workflows/new");
  await expect(page).toHaveURL(/\/workflows$/);
});

test("tenant isolation protects builder pages and published layout APIs", async ({
  page,
  actors,
}) => {
  await login(page, actors.outsider);
  const response = await page.goto(`/workflows/${actors.seedId}`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      name: "Let’s get you back in flow.",
      exact: true,
    }),
  ).toBeVisible();
  const snapshot = await page.request.get(
    `/api/workspaces/${actors.workspaceId}/workflows/${actors.seedId}/versions/${actors.versionId}`,
  );
  expect(snapshot.status()).toBe(404);
});

test("mobile and keyboard controls remain usable", async ({
  page,
  actors,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, actors.owner);
  await page.goto("/workflows/new");
  const start = await addNode(page, "manual_trigger");
  await configure(page, start.node, "Mobile start");
  const log = await addNode(page, "log_event");
  await configure(page, log.node, "Mobile event", {
    "Event message": "Keyboard connection",
  });
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  await page
    .getByLabel("Connection source", { exact: true })
    .selectOption(start.id);
  await page
    .getByLabel("Connection target", { exact: true })
    .selectOption(log.id);
  await page
    .getByRole("button", { name: "Connect selected nodes", exact: true })
    .click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page.getByLabel("Workflow name", { exact: true }).focus();
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(/\/workflows\/(?!new$)[^/]+$/);
  await expect(page.getByTestId("save-state")).toContainText("Saved");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-builder.png"),
    fullPage: true,
  });
});
