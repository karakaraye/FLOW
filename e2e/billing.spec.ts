import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { billingFixture, billingTestKey } from "../tests/billing-fixture";
import { paystackSignature } from "../src/lib/billing/events";
let fixture: Awaited<ReturnType<typeof billingFixture>>, app: ChildProcess;
const origin = "http://localhost:3004";
test.beforeAll(async () => {
  fixture = await billingFixture();
  app = spawn(
    process.execPath,
    [
      "--import",
      "./tests/billing-fixture-preload.mjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3004",
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
  throw Error("Billing fixture app did not start");
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
      "./tests/billing-fixture-preload.mjs",
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
async function event(page: Page, payload: unknown) {
  const raw = JSON.stringify(payload);
  const r = await page.request.post(origin + "/api/billing/paystack/webhook", {
    data: raw,
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": paystackSignature(
        billingTestKey,
        Buffer.from(raw),
      ),
    },
  });
  expect(r.status()).toBe(200);
  await work();
}
test("billing is explicit when unconfigured; viewers cannot manage and foreign workspaces cannot read", async ({
  page,
  actors,
}) => {
  await cookie(page, actors.viewer);
  await page.goto("http://localhost:3000/billing");
  await expect(
    page.getByText(
      "UNCONFIGURED — Paystack test setup is required. No payment is simulated.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create STARTER test checkout",
      exact: true,
    }),
  ).toBeDisabled();
  const path = `${origin}/api/workspaces/${actors.workspaceId}/billing`;
  let r = await page.request.post(path + "/checkout", {
    headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
    data: { plan: "STARTER", interval: "monthly" },
  });
  expect(r.status()).toBe(403);
  r = await page.request.post(path + "/cancel", {
    headers: { Origin: origin },
    data: { revision: 1 },
  });
  expect(r.status()).toBe(403);
  await cookie(page, actors.outsider);
  r = await page.request.get(path + "/overview");
  expect(r.status()).toBe(404);
});
test("server-priced MOCK checkout, untrusted redirect, signed activation and actual worker usage", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  await page.goto(origin + "/billing");
  await expect(
    page.getByText(
      "MOCK — controlled Paystack fixture; no actual Paystack test API verification.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText("FREE");
  await page
    .getByLabel("Billing interval", { exact: true })
    .selectOption("annually");
  await expect(
    page.getByRole("button", {
      name: "Create STARTER test checkout",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel("Billing interval", { exact: true })
    .selectOption("monthly");
  await page
    .getByRole("button", { name: "Create STARTER test checkout", exact: true })
    .click();
  await expect(page.getByTestId("paystack-checkout-link")).toHaveAttribute(
    "href",
    /^https:\/\/checkout\.paystack\.com\/fixture/,
  );
  const c = await db.billingCheckout.findFirstOrThrow({
    where: { workspaceId: actors.workspaceId },
  });
  await page.goto(origin + "/billing?reference=" + c.reference);
  await expect(
    page.getByText("Returned from checkout.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText("FREE");
  const before = fixture.initCalls;
  await page
    .getByRole("button", { name: "Create STARTER test checkout", exact: true })
    .click();
  expect(fixture.initCalls).toBe(before);
  fixture.pay(c.reference, new Date(Date.now() - 86400000));
  await event(page, {
    event: "charge.success",
    data: fixture.transactions[c.reference],
  });
  await page
    .getByRole("button", { name: "Reload billing status", exact: true })
    .click();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText(
    "STARTER",
  );
  await expect(
    page.getByText("Payment status: ACTIVE", { exact: true }),
  ).toBeVisible();
  const base = `${origin}/api/workspaces/${actors.workspaceId}`,
    headers = { Origin: origin };
  let r = await page.request.post(base + "/workflows", {
    headers,
    data: {
      name: "Billing worker verification",
      definition: {
        schemaVersion: 1,
        nodes: [{ id: "start", type: "manual_trigger", config: {} }],
        edges: [],
      },
    },
  });
  expect(r.status()).toBe(201);
  const w = await r.json();
  r = await page.request.post(base + `/workflows/${w.id}/publish`, {
    headers,
    data: { revision: w.revision },
  });
  expect(r.ok()).toBe(true);
  const v = await r.json();
  const usageBefore = await (
    await page.request.get(base + "/billing/overview")
  ).json();
  const admittedBefore = usageBefore.usage.find(
    (u: { metric: string }) => u.metric === "executions",
  ).used as number;
  r = await page.request.post(base + `/workflows/${w.id}/runs`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { versionId: v.id, input: {} },
  });
  expect(r.ok()).toBe(true);
  const run = await r.json();
  await work(run.id);
  expect(
    (
      await db.quotaEntry.findFirstOrThrow({
        where: {
          workspaceId: actors.workspaceId,
          metric: "executions",
          key: run.id,
        },
      })
    ).amount,
  ).toBe(1n);
  await page
    .getByRole("button", { name: "Reload billing status", exact: true })
    .click();
  await expect(page.getByTestId("billing-usage-executions")).toContainText(
    `${(admittedBefore + 1).toLocaleString("en-US")} / 10,000`,
  );
  await page.screenshot({
    path: info.outputPath("billing-paid-mock.png"),
    fullPage: true,
  });
});
test("renewal reconciliation, failed payment, cancellation and period-boundary plan change retain history", async ({
  page,
  actors,
}, info) => {
  await cookie(page, actors.owner);
  await page.goto(origin + "/billing");
  const s = await db.subscription.findUniqueOrThrow({
    where: { workspaceId: actors.workspaceId },
  });
  const old = s.providerCode!;
  fixture.renew(old);
  await page
    .getByRole("button", { name: "Reconcile subscription status", exact: true })
    .click();
  await expect
    .poll(() =>
      db.billingPayment.count({ where: { workspaceId: actors.workspaceId } }),
    )
    .toBe(2);
  fixture.renew(old, false);
  await event(page, {
    event: "invoice.payment_failed",
    data: { subscription: { subscription_code: old } },
  });
  await page
    .getByRole("button", { name: "Reload billing status", exact: true })
    .click();
  await expect(
    page.getByText("Payment status: PAST_DUE", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Cancel future renewal; keep the already verified paid period.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Cancel subscription renewal", exact: true })
    .click();
  await expect(
    page.getByText("Payment status: CANCELED", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText(
    "STARTER",
  );
  await db.subscription.update({
    where: { id: s.id },
    data: { currentPeriodEnd: new Date(Date.now() - 1000) },
  });
  await page
    .getByRole("button", { name: "Reload billing status", exact: true })
    .click();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText("FREE");
  expect(
    await db.billingPayment.count({
      where: { workspaceId: actors.workspaceId },
    }),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Create BUSINESS test checkout", exact: true })
    .click();
  await expect(page.getByTestId("paystack-checkout-link")).toBeVisible();
  const c = await db.billingCheckout.findFirstOrThrow({
    where: { workspaceId: actors.workspaceId, tier: "BUSINESS" },
  });
  fixture.pay(c.reference);
  await event(page, {
    event: "charge.success",
    data: fixture.transactions[c.reference],
  });
  await page
    .getByRole("button", { name: "Reload billing status", exact: true })
    .click();
  await expect(page.getByTestId("billing-effective-plan")).toHaveText(
    "BUSINESS",
  );
  expect(
    await db.billingPayment.count({
      where: { workspaceId: actors.workspaceId },
    }),
  ).toBe(3);
  await page.screenshot({
    path: info.outputPath("billing-renewal-history-mock.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
