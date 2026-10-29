import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { test, expect } from "./fixtures";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { googleFixture } from "../tests/google-fixture";
let fixture: Awaited<ReturnType<typeof googleFixture>>, server: ChildProcess;
const origin = "http://localhost:3001";
let googleWorkspaceId = "";
test.beforeAll(async () => {
  fixture = await googleFixture();
  server = spawn(
    process.execPath,
    [
      "--import",
      "./tests/google-fixture-preload.mjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3001",
    ],
    {
      env: {
        ...process.env,
        ...fixture.env,
        BETTER_AUTH_URL: origin,
        GOOGLE_OAUTH_REDIRECT_URI: origin + "/api/integrations/google/callback",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw Error("Google test app did not start");
});
test.afterAll(async () => {
  // Only remove Google records created in this disposable worker fixture.
  // Other files reuse actors and must retain their original empty Google slots.
  if (googleWorkspaceId)
    await db.workspaceIntegration.deleteMany({
      where: {
        workspaceId: googleWorkspaceId,
        providerId: { in: ["gmail", "google-sheets"] },
      },
    });
  if (server) {
    server.kill("SIGTERM");
    await new Promise<void>((r) => {
      if (server.exitCode !== null) r();
      else server.once("exit", () => r());
    });
  }
  await fixture?.close();
});
async function loginCookie(
  page: import("@playwright/test").Page,
  person: { email: string; password: string },
) {
  const response = await auth.api.signInEmail({
    body: { email: person.email, password: person.password },
    asResponse: true,
  });
  await page.context().addCookies(
    response.headers.getSetCookie().map((c) => {
      const [key, value] = c.split(";")[0].split("=");
      return {
        name: key,
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
async function consent(
  page: import("@playwright/test").Page,
  provider: "gmail" | "google-sheets",
) {
  await page.route("https://accounts.google.com/**", async (route) => {
    const u = new URL(route.request().url()),
      code = randomUUID();
    fixture.codes.set(code, {
      provider,
      nonce: u.searchParams.get("nonce")!,
      challenge: u.searchParams.get("code_challenge")!,
    });
    const callback = new URL("/api/integrations/google/callback", origin);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", u.searchParams.get("state")!);
    await route.fulfill({
      contentType: "text/html",
      body: `<html><body>Controlled Google consent fixture. No live Google account.<script>location.replace(${JSON.stringify(callback.href)})</script></body></html>`,
    });
  });
}
test("Google connection management uses real callback flow against a controlled provider", async ({
  page,
  actors,
}, info) => {
  googleWorkspaceId = actors.workspaceId;
  await loginCookie(page, actors.owner);
  await consent(page, "gmail");
  await page.goto(origin + "/integrations");
  await expect(page.getByTestId("provider-gmail")).toContainText("Available");
  await page
    .getByTestId("provider-gmail")
    .getByRole("button", { name: "Save disconnected record", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Google account", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("CONNECTED");
  await expect(
    page.getByText("authorized@example.test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Granted permissions", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh Google authorization", exact: true })
    .click();
  await expect(
    page.getByText("Google credential refreshed.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("google-connection-controlled.png"),
    fullPage: true,
  });
  const id = page.url().split("/").at(-1)!.split("?")[0];
  const r = await page.request.get(
    `${origin}/api/workspaces/${actors.workspaceId}/integrations/${id}`,
  );
  expect(JSON.stringify(await r.json())).not.toMatch(
    /accessToken|refreshToken|ciphertext/,
  );
});
test("Google builder configuration and real worker execution preserve tenant security", async ({
  page,
  actors,
}, info) => {
  googleWorkspaceId = actors.workspaceId;
  await loginCookie(page, actors.owner);
  const connection = await db.workspaceIntegration.findFirstOrThrow({
    where: {
      workspaceId: actors.workspaceId,
      providerId: "gmail",
      status: "CONNECTED",
    },
  });
  await page.goto(origin + "/workflows/new");
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Controlled Gmail workflow");
  await page.getByTestId("add-manual_trigger").click();
  await page.getByTestId("add-gmail_send_email").click();
  await page
    .getByLabel("Google node connection", { exact: true })
    .selectOption(connection.id);
  await page
    .getByLabel("Gmail recipients", { exact: true })
    .fill("recipient@example.test");
  await page
    .getByLabel("Gmail subject", { exact: true })
    .fill("Controlled browser fixture");
  await page
    .getByLabel("Gmail body", { exact: true })
    .fill("No real recipient receives this test.");
  await page.getByLabel("Gmail mappings", { exact: true }).fill("{}");
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  const root = (await page
      .locator('[data-node-kind="manual_trigger"]')
      .getAttribute("data-testid"))!.replace("workflow-node-", ""),
    mail = (await page
      .locator('[data-node-kind="gmail_send_email"]')
      .getAttribute("data-testid"))!.replace("workflow-node-", "");
  await page
    .getByLabel("Connection source", { exact: true })
    .selectOption(root);
  await page
    .getByLabel("Connection target", { exact: true })
    .selectOption(mail);
  await page
    .getByRole("button", { name: "Connect selected nodes", exact: true })
    .click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/(?!new)[^/]+$/);
  await page
    .getByRole("button", { name: "Publish saved draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page).toHaveURL(/\/history\//);
  const id = page.url().split("/").at(-1)!;
  const worker = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/google-fixture-preload.mjs",
      "scripts/worker.ts",
      "--once",
      "--run-id",
      id,
    ],
    { env: { ...process.env, ...fixture.env }, stdio: "ignore" },
  );
  expect(
    await new Promise<number | null>((r, j) => {
      worker.once("exit", r);
      worker.once("error", j);
    }),
  ).toBe(0);
  await expect(
    page.getByRole("status", { exact: true }).filter({ hasText: "SUCCEEDED" }),
  ).toBeVisible();
  expect(fixture.counters.sends).toBe(1);
  await page.screenshot({
    path: info.outputPath("gmail-worker-controlled.png"),
    fullPage: true,
  });
  await page.goto(origin + "/workflows/new");
  await page.getByTestId("add-google_sheets_read_rows").click();
  await expect(
    page.getByText("No connected Google Sheets account.", { exact: false }),
  ).toBeVisible();
  await consent(page, "google-sheets");
  await page.goto(origin + "/integrations");
  await page
    .getByTestId("provider-google-sheets")
    .getByRole("button", { name: "Save disconnected record", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect Google account", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("CONNECTED");
  const sheetsId = page.url().split("/").at(-1)!.split("?")[0];
  await page.goto(origin + "/workflows/new");
  await page.getByTestId("add-manual_trigger").click();
  for (const type of [
    "google_sheets_read_rows",
    "google_sheets_append_row",
    "google_sheets_update_row",
  ]) {
    await page.getByTestId(`add-${type}`).click();
    await page
      .getByLabel("Google node connection", { exact: true })
      .selectOption(sheetsId);
    await page
      .getByLabel("Sheets spreadsheet ID", { exact: true })
      .fill("fixture-sheet-id");
    await page
      .getByLabel("Sheets range", { exact: true })
      .fill(
        type === "google_sheets_read_rows" ? "Sheet1!A1:B2" : "Sheet1!A1:B1",
      );
    if (type !== "google_sheets_read_rows") {
      await page
        .getByLabel("Sheets values", { exact: true })
        .fill('["customer",12]');
      await page
        .getByLabel("Sheets mappings", { exact: true })
        .fill("[null,null]");
    }
    await page
      .getByRole("button", { name: "Apply configuration", exact: true })
      .click();
  }
  await page.screenshot({
    path: info.outputPath("sheets-builder-controlled.png"),
    fullPage: true,
  });
  await page.goto(origin + `/integrations/${connection.id}`);
  await page
    .getByRole("button", { name: "Disconnect Google account", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("REVOKED");
});
