import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { test, expect, login } from "./fixtures";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { aiFixture } from "../tests/ai-fixture";
import { aiTypes, type AIType } from "../src/lib/ai/config";
import type { Definition, WorkflowNode } from "../src/lib/engine/definition";
let fixture: Awaited<ReturnType<typeof aiFixture>>, app: ChildProcess;
const origin = "http://localhost:3002";
test.beforeAll(async () => {
  fixture = await aiFixture();
  app = spawn(
    process.execPath,
    [
      "--import",
      "./tests/ai-fixture-preload.mjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3002",
    ],
    {
      env: { ...process.env, ...fixture.env, BETTER_AUTH_URL: origin },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw Error("Controlled AI app did not start");
});
test.afterAll(async () => {
  if (app) {
    app.kill("SIGTERM");
    await new Promise<void>((r) => {
      if (app.exitCode !== null) r();
      else app.once("exit", () => r());
    });
  }
  await fixture?.close();
});
async function cookie(
  page: import("@playwright/test").Page,
  person: { email: string; password: string },
) {
  const r = await auth.api.signInEmail({
    body: { email: person.email, password: person.password },
    asResponse: true,
  });
  await page.context().addCookies(
    r.headers.getSetCookie().map((c) => {
      const [name, value] = c.split(";")[0].split("=");
      return {
        name,
        value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax" as const,
        secure: false,
      };
    }),
  );
}
async function work(runId: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/ai-fixture-preload.mjs",
      "scripts/worker.ts",
      "--once",
      "--run-id",
      runId,
    ],
    { env: { ...process.env, ...fixture.env }, stdio: "ignore" },
  );
  expect(
    await new Promise<number | null>((r, j) => {
      child.once("exit", r);
      child.once("error", j);
    }),
  ).toBe(0);
}
test("unconfigured AI is explicit and viewer/API isolation remains read-only", async ({
  page,
  browser,
  actors,
}) => {
  await login(page, actors.owner);
  await page.goto("/ai");
  await expect(page.getByTestId("ai-provider-status")).toContainText(
    "unconfigured",
  );
  await expect(
    page.getByRole("button", { name: "Queue AI test", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("ai-playground-output")).toHaveCount(0);
  const other = await browser.newContext();
  try {
    const viewer = await other.newPage();
    await cookie(viewer, actors.viewer);
    await viewer.goto(origin + "/ai");
    await expect(
      viewer.getByRole("button", { name: "Queue AI test", exact: true }),
    ).toBeDisabled();
    await expect(
      viewer.getByRole("button", { name: "Save AI budget", exact: true }),
    ).toHaveCount(0);
    const url = `${origin}/api/workspaces/${actors.workspaceId}/ai`;
    expect(
      (
        await viewer.request.patch(url + "/budget", {
          headers: { Origin: origin },
          data: { revision: 0, dailyLimitMicros: "1", monthlyLimitMicros: "1" },
        })
      ).status(),
    ).toBe(403);
    const outsider = await browser.newContext();
    try {
      const p = await outsider.newPage();
      await cookie(p, actors.outsider);
      expect((await p.request.get(url + "/usage")).status()).toBe(404);
    } finally {
      await outsider.close();
    }
  } finally {
    await other.close();
  }
});
test("controlled AI playground reserves budget and displays actual mock-adapter output and usage", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  await page.goto(origin + "/ai");
  await expect(page.getByTestId("ai-provider-status")).toContainText("MOCK");
  await page.getByLabel("AI daily budget USD", { exact: true }).fill("1");
  await page.getByLabel("AI monthly budget USD", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Save AI budget", exact: true })
    .click();
  await expect(
    page.getByText("AI budget saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("AI playground input", { exact: true })
    .fill('{"text":"Controlled mock-only source text"}');
  await page
    .getByRole("button", { name: "Queue AI test", exact: true })
    .click();
  await expect(page.getByTestId("ai-playground-status")).toHaveText("QUEUED");
  const run = await db.workflowRun.findFirstOrThrow({
    where: {
      workflow: {
        workspaceId: actors.workspaceId,
        internalKind: "AI_PLAYGROUND",
      },
    },
    orderBy: { createdAt: "desc" },
  });
  await work(run.id);
  await expect(page.getByTestId("ai-playground-status")).toHaveText(
    "SUCCEEDED",
  );
  await expect(page.getByTestId("ai-playground-output")).toContainText(
    "MOCK summary",
  );
  await expect(
    page.getByText("60 reported tokens", { exact: false }),
  ).toBeVisible();
  const before = await db.aIUsage.count({ where: { runId: run.id } });
  await page
    .getByRole("button", { name: "Retry same AI request", exact: true })
    .click();
  await expect(page.getByTestId("ai-playground-status")).toHaveText(
    "SUCCEEDED",
  );
  expect(await db.aIUsage.count({ where: { runId: run.id } })).toBe(before);
  await page.screenshot({
    path: info.outputPath("ai-playground-mock.png"),
    fullPage: true,
  });
});
const schema = {
  type: "object",
  properties: { fact: { type: ["string", "null"], maxLength: 200 } },
  required: ["fact"],
  additionalProperties: false,
};
function aiNode(type: AIType, path: string): WorkflowNode {
  return {
    id: type,
    type,
    config: {
      modelId: "mock-model",
      textPath: path,
      maxOutputTokens: 256,
      instructions: "",
      ...(type === "ai_classify" ? { categories: ["accept", "review"] } : {}),
      ...(["ai_summarize", "ai_generate_text"].includes(type)
        ? { length: "short" }
        : {}),
      ...(type === "ai_extract" ? { schema } : {}),
    },
  };
}
test("all five AI panels publish and execute through the real worker with sanitized history", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  await page.goto(origin + "/workflows/new");
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Controlled five-node AI workflow");
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  const nodes = [
    aiNode("ai_generate_text", "text"),
    aiNode("ai_summarize", "text"),
    aiNode("ai_sentiment", "summary"),
    aiNode("ai_extract", "explanation"),
    aiNode("ai_classify", "fact"),
  ];
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [{ id: "start", type: "manual_trigger", config: {} }, ...nodes],
    edges: nodes.map((n, i) => ({
      from: i ? nodes[i - 1].id : "start",
      to: n.id,
    })),
  };
  await page
    .getByLabel("Import engine definition JSON (replaces the current graph)", {
      exact: true,
    })
    .fill(JSON.stringify(definition));
  await page
    .getByRole("button", { name: "Import definition", exact: true })
    .click();
  for (const type of aiTypes) {
    const target = page.getByTestId(`workflow-node-${type}`);
    await target.click({ position: { x: 70, y: 55 } });
    await page
      .getByLabel("AI approved model", { exact: true })
      .selectOption("mock-model");
    await page
      .getByLabel("AI instructions", { exact: true })
      .fill("Follow the strict task contract.");
    await page
      .getByLabel("AI maximum output tokens", { exact: true })
      .fill("256");
    if (type === "ai_classify")
      await page
        .getByLabel("AI categories", { exact: true })
        .fill("accept, review");
    if (type === "ai_extract")
      await page
        .getByLabel("AI output schema", { exact: true })
        .fill(JSON.stringify(schema));
    await page
      .getByRole("button", { name: "Apply configuration", exact: true })
      .click();
  }
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page.screenshot({
    path: info.outputPath("ai-builder-mock.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/(?!new)[^/]+$/);
  await page
    .getByRole("button", { name: "Publish saved draft", exact: true })
    .click();
  await page
    .getByLabel("Run input JSON (up to 16 KiB; no credentials)", {
      exact: true,
    })
    .fill('{"text":"Controlled input"}');
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page).toHaveURL(/\/history\//);
  const id = page.url().split("/").at(-1)!;
  await work(id);
  await expect(
    page.getByRole("status", { exact: true }).filter({ hasText: "SUCCEEDED" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load AI details", exact: true })
    .click();
  await expect(
    page.getByText("MOCK generated content", { exact: false }),
  ).toBeVisible();
  expect(
    await db.aIUsage.count({ where: { runId: id, status: "SUCCEEDED" } }),
  ).toBe(5);
  await page.screenshot({
    path: info.outputPath("ai-worker-history-mock.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/ai");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
