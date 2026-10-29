import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { test, expect } from "./fixtures";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import {
  whatsappFixture,
  metaTest,
  inboundMeta,
  statusMeta,
} from "../tests/whatsapp-fixture";
import { metaSignature } from "../src/lib/whatsapp/webhooks";
import type { Definition } from "../src/lib/engine/definition";
import type { Page } from "@playwright/test";
let fixture: Awaited<ReturnType<typeof whatsappFixture>>, app: ChildProcess;
const origin = "http://localhost:3003";
test.beforeAll(async () => {
  fixture = await whatsappFixture();
  app = spawn(
    process.execPath,
    [
      "--import",
      "./tests/whatsapp-fixture-preload.mjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3003",
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
  throw Error("Meta fixture app did not start");
});
test.afterAll(async () => {
  if (app) {
    app.kill("SIGTERM");
    await new Promise<void>((r) =>
      app.exitCode !== null ? r() : app.once("exit", () => r()),
    );
  }
  await fixture?.close();
});
async function cookie(page: Page, person: { email: string; password: string }) {
  const r = await auth.api.signInEmail({ body: person, asResponse: true });
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
async function work(runId?: string) {
  const p = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/whatsapp-fixture-preload.mjs",
      "scripts/worker.ts",
      "--once",
      ...(runId ? ["--run-id", runId] : []),
    ],
    { env: { ...process.env, ...fixture.env }, stdio: "ignore" },
  );
  expect(
    await new Promise<number | null>((r, j) => {
      p.once("exit", r);
      p.once("error", j);
    }),
  ).toBe(0);
}
async function webhook(page: Page, value: unknown) {
  const raw = JSON.stringify(value);
  const r = await page.request.post(
    origin + "/api/integrations/whatsapp/webhook",
    {
      data: raw,
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": metaSignature(metaTest.secret, Buffer.from(raw)),
      },
    },
  );
  expect(r.status()).toBe(200);
}
async function build(page: Page, name: string, definition: Definition) {
  await page.goto(origin + "/workflows/new");
  await page.getByLabel("Workflow name", { exact: true }).fill(name);
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  await page
    .getByLabel("Import engine definition JSON (replaces the current graph)", {
      exact: true,
    })
    .fill(JSON.stringify(definition));
  await page
    .getByRole("button", { name: "Import definition", exact: true })
    .click();
}
async function publish(page: Page) {
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/(?!new)[^/]+$/);
  const id = page.url().split("/").at(-1)!;
  await page
    .getByRole("button", { name: "Publish saved draft", exact: true })
    .click();
  await expect
    .poll(async () => db.workflowVersion.count({ where: { workflowId: id } }))
    .toBe(1);
  return db.workflowVersion.findFirstOrThrow({ where: { workflowId: id } });
}
test("WhatsApp unconfigured status and unauthorized management are explicit", async ({
  page,
  actors,
}) => {
  await cookie(page, actors.viewer);
  await page.goto("http://localhost:3000/integrations");
  await page
    .getByRole("link", { name: "Open WhatsApp Business", exact: true })
    .click();
  await expect(page.getByText("UNCONFIGURED", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Verify WhatsApp connection",
      exact: true,
    }),
  ).toBeDisabled();
  const base = `${origin}/api/workspaces/${actors.workspaceId}/whatsapp`;
  let r = await page.request.post(base + "/connect", {
    headers: { Origin: origin },
    data: {
      integrationId: "missing",
      revision: 1,
      messagingAccountId: metaTest.accountId,
      phoneNumberId: metaTest.phoneId,
      accessToken: metaTest.token,
      dailyLimit: 20,
    },
  });
  expect(r.status()).toBe(403);
  r = await page.request.post(base + "/manage", {
    headers: { Origin: origin },
    data: {
      action: "consent",
      phoneId: "missing",
      recipient: metaTest.recipient,
      decision: "GRANT",
      source: "fixture",
    },
  });
  expect(r.status()).toBe(403);
  await cookie(page, actors.outsider);
  r = await page.request.get(base + "/overview");
  expect(r.status()).toBe(404);
});
test("developer connection, incoming builder, signed webhook and real-worker reply with delivery updates", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  await page.goto(origin + "/integrations/whatsapp");
  await expect(
    page.getByText(
      "MOCK — controlled Meta fixture; live connectivity unverified.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("Meta messaging account ID", { exact: true })
    .fill(metaTest.accountId);
  await page
    .getByLabel("Meta phone-number ID", { exact: true })
    .fill(metaTest.phoneId);
  await page
    .getByLabel("Meta access token", { exact: true })
    .fill(metaTest.token);
  await page
    .getByLabel("WhatsApp daily send limit", { exact: true })
    .fill("20");
  await page
    .getByRole("button", { name: "Verify WhatsApp connection", exact: true })
    .click();
  await expect(
    page.getByText("MOCK Meta test business", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Meta access token", { exact: true }),
  ).toHaveValue("");
  const c = await db.whatsAppConnection.findFirstOrThrow({
    where: { workspaceId: actors.workspaceId },
    include: { phones: true },
  });
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [
      {
        id: "incoming",
        type: "whatsapp_message_received",
        config: { connectionId: c.id, phoneNumberId: metaTest.phoneId },
      },
      {
        id: "set_reply",
        type: "set_data",
        config: { values: { reply: "MOCK controlled service reply" } },
      },
      {
        id: "send_reply",
        type: "whatsapp_send_message",
        config: { connectionId: c.id, toPath: "from", bodyPath: "reply" },
      },
    ],
    edges: [
      { from: "incoming", to: "set_reply" },
      { from: "set_reply", to: "send_reply" },
    ],
  };
  await build(page, "WhatsApp fixture reply", definition);
  await page
    .getByTestId("workflow-node-incoming")
    .click({ position: { x: 70, y: 55 } });
  await expect(
    page.getByLabel("WhatsApp phone number", { exact: true }),
  ).toHaveValue(metaTest.phoneId);
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page
    .getByTestId("workflow-node-send_reply")
    .click({ position: { x: 70, y: 55 } });
  await expect(
    page.getByLabel("WhatsApp recipient", { exact: true }),
  ).toHaveValue("from");
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("whatsapp-builder-mock.png"),
    fullPage: true,
  });
  const version = await publish(page);
  await page.goto(origin + "/integrations/whatsapp");
  await page
    .getByLabel("WhatsApp published version", { exact: true })
    .selectOption(version.id);
  await page
    .getByRole("button", { name: "Activate WhatsApp trigger", exact: true })
    .click();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  const challenge = await page.request.get(
    origin +
      `/api/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${metaTest.verifyToken}&hub.challenge=654321`,
  );
  expect(await challenge.text()).toBe("654321");
  const payload = inboundMeta("browser-inbound");
  await webhook(page, payload);
  await webhook(page, payload);
  await work();
  const delivery = await db.whatsAppEventRun.findFirstOrThrow({
    where: { workspaceId: actors.workspaceId },
  });
  await work(delivery.runId);
  await page.goto(origin + `/history/${delivery.runId}`);
  await expect(
    page.getByRole("status", { exact: true }).filter({ hasText: "SUCCEEDED" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("whatsapp-worker-history-mock.png"),
    fullPage: true,
  });
  const m = await db.whatsAppMessage.findFirstOrThrow({
    where: { runId: delivery.runId },
  });
  expect(m.state).toBe("ACCEPTED");
  expect(fixture.sends).toBe(1);
  await webhook(page, statusMeta(m.providerMessageId!, "delivered"));
  await work();
  await page.goto(origin + "/integrations/whatsapp");
  await expect(
    page.getByText("••••0001 · DELIVERED", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("whatsapp-delivery-mock.png"),
    fullPage: true,
  });
});
test("provider-approved template form and explicit consent execute through real worker", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  const c = await db.whatsAppConnection.findFirstOrThrow({
    where: { workspaceId: actors.workspaceId },
    include: { phones: true },
  });
  await page.goto(origin + "/integrations/whatsapp");
  await page
    .getByRole("button", { name: "Fetch Meta templates", exact: true })
    .click();
  await expect(page.getByText("order_update", { exact: true })).toBeVisible();
  await page
    .getByLabel("Consent recipient", { exact: true })
    .fill(metaTest.recipient);
  await page
    .getByLabel("Consent evidence", { exact: true })
    .fill("MOCK explicit utility test consent");
  await page.locator('select[name="decision"]').selectOption("GRANT");
  await page
    .getByRole("button", { name: "Record consent decision", exact: true })
    .click();
  await expect(
    page.getByText(
      "••••0001 · EXPLICIT UTILITY CONSENT · MOCK explicit utility test consent",
      { exact: true },
    ),
  ).toBeVisible();
  const definition: Definition = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "manual_trigger", config: {} },
      {
        id: "template",
        type: "whatsapp_send_template",
        config: {
          connectionId: c.id,
          to: metaTest.recipient,
          templateId: "400001",
          language: "en_US",
          parameters: ["123"],
          parameterPaths: [""],
        },
      },
    ],
    edges: [{ from: "start", to: "template" }],
  };
  await build(page, "WhatsApp fixture utility template", definition);
  await page
    .getByTestId("workflow-node-template")
    .click({ position: { x: 70, y: 55 } });
  await page
    .getByLabel("WhatsApp approved template", { exact: true })
    .selectOption("400001");
  await page.getByLabel("WhatsApp parameter 1", { exact: true }).fill("123");
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("whatsapp-template-mock.png"),
    fullPage: true,
  });
  await publish(page);
  await db.whatsAppMessage.updateMany({
    where: { workspaceId: actors.workspaceId },
    data: { createdAt: new Date(Date.now() - 120000) },
  });
  await page
    .getByLabel("Run input JSON (up to 16 KiB; no credentials)", {
      exact: true,
    })
    .fill("{}");
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page).toHaveURL(/\/history\//);
  const runId = page.url().split("/").at(-1)!;
  await work(runId);
  await expect(
    page.getByRole("status", { exact: true }).filter({ hasText: "SUCCEEDED" }),
  ).toBeVisible();
  expect(
    (await db.whatsAppMessage.findFirstOrThrow({ where: { runId } })).state,
  ).toBe("ACCEPTED");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/integrations/whatsapp");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
