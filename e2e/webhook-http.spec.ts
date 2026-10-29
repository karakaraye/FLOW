import { test, expect, login } from "./fixtures";
import { db } from "../src/lib/db";
test("create a webhook workflow and manage one-time signing secrets", async ({
  page,
  actors,
}, info) => {
  await login(page, actors.owner);
  await page.goto("/workflows/new");
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Visual signed webhook");
  await page.getByTestId("add-webhook_trigger").click();
  await expect(page.locator('[data-node-kind="webhook_trigger"]')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/(?!new)[^/]+$/);
  const id = page.url().split("/").at(-1)!;
  await page
    .getByRole("button", { name: "Publish saved draft", exact: true })
    .click();
  await expect(
    page.getByText("Published immutable version 1.", { exact: true }),
  ).toBeVisible();
  const version = await db.workflowVersion.findFirstOrThrow({
    where: { workflowId: id },
  });
  await page.reload();
  await page
    .getByLabel("Webhook published version", { exact: true })
    .selectOption(version.id);
  await page
    .getByRole("button", { name: "Generate signed webhook", exact: true })
    .click();
  const field = page.getByLabel("New webhook signing secret", { exact: true });
  await expect(field).toBeVisible();
  const first = await field.inputValue();
  expect(first.length).toBeGreaterThan(32);
  await page
    .getByRole("button", { name: "Dismiss secret", exact: true })
    .click();
  await expect(field).toHaveCount(0);
  await expect(
    page.getByLabel("Webhook endpoint URL", { exact: true }),
  ).toHaveValue(/\/api\/hooks\//);
  await page
    .getByRole("button", { name: "Rotate signing secret", exact: true })
    .click();
  await expect(field).toBeVisible();
  expect(await field.inputValue()).not.toBe(first);
  await page
    .getByRole("button", { name: "Dismiss secret", exact: true })
    .click();
  await page.getByText("Signature instructions", { exact: true }).click();
  await expect(page.getByText(/HMAC-SHA256/)).toBeVisible();
  await page
    .getByRole("button", { name: "Disable webhook", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable webhook", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("signed-webhook-setup.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(field).toHaveCount(0);
  await page
    .getByRole("button", { name: "Revoke webhook", exact: true })
    .click();
  await expect(page.getByText(/REVOKED · Revision/)).toBeVisible();
});
test("configure and persist a secure HTTP action in the visual builder", async ({
  page,
  actors,
}, info) => {
  await login(page, actors.owner);
  await page.goto("/workflows/new");
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Visual HTTPS action");
  await page.getByTestId("add-manual_trigger").click();
  await page.getByTestId("add-http_request").click();
  await expect(page.getByLabel("HTTP method", { exact: true })).toBeVisible();
  await page.getByLabel("HTTP method", { exact: true }).selectOption("POST");
  await page
    .getByLabel("HTTP URL", { exact: true })
    .fill("https://api.customer-service.com/events");
  await page
    .getByLabel("HTTP headers", { exact: true })
    .fill('{"Accept":"application/json"}');
  await page
    .getByLabel("HTTP body", { exact: true })
    .fill('{"event":"onboarding"}');
  await page.getByLabel("HTTP timeout", { exact: true }).fill("2500");
  await page
    .getByLabel("HTTP response mapping", { exact: true })
    .fill("result");
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page
    .getByText("Accessible graph controls & JSON", { exact: true })
    .click();
  const sources = page.getByLabel("Connection source", { exact: true });
  const targets = page.getByLabel("Connection target", { exact: true });
  const root = await page
      .locator('[data-node-kind="manual_trigger"]')
      .getAttribute("data-testid"),
    http = await page
      .locator('[data-node-kind="http_request"]')
      .getAttribute("data-testid");
  await sources.selectOption(root!.replace("workflow-node-", ""));
  await targets.selectOption(http!.replace("workflow-node-", ""));
  await page
    .getByRole("button", { name: "Connect selected nodes", exact: true })
    .click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/workflows\/(?!new)[^/]+$/);
  const id = page.url().split("/").at(-1)!;
  const row = await db.workflow.findUniqueOrThrow({ where: { id } });
  expect(JSON.stringify(row.draft)).toContain(
    "api.customer-service.com/events",
  );
  await page.reload();
  await page
    .locator('[data-node-kind="http_request"]')
    .click({ position: { x: 80, y: 55 } });
  await expect(page.getByLabel("HTTP method", { exact: true })).toHaveValue(
    "POST",
  );
  await expect(page.getByLabel("HTTP timeout", { exact: true })).toHaveValue(
    "2500",
  );
  await page.screenshot({
    path: info.outputPath("http-action-configuration.png"),
    fullPage: true,
  });
  await page
    .getByLabel("HTTP headers", { exact: true })
    .fill('{"Authorization":"must-use-vault"}');
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /approved headers/ }),
  ).toBeVisible();
});
