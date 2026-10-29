import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { test, expect, login } from "./fixtures";
import { db } from "../src/lib/db";
import { seedCatalog } from "../src/lib/templates/catalog";
async function processRun(id: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", id],
    { stdio: "ignore" },
  );
  expect(
    await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }),
  ).toBe(0);
}
test("catalog search, visual preview, installation, customization and real execution", async ({
  page,
  actors,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, actors.owner);
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Automation templates", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search templates", { exact: true }).fill("lead");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption("Sales Operations");
  await page
    .getByRole("button", { name: "Search & filter", exact: true })
    .click();
  await expect(page.getByTestId("template-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Lead Qualification Prototype",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reset", exact: true }).click();
  await expect(page.getByTestId("template-card")).toHaveCount(7);
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue("");
  await page.screenshot({
    path: info.outputPath("template-catalog.png"),
    fullPage: true,
  });
  const card = page.getByTestId("template-card").filter({
    has: page.getByRole("heading", {
      name: "Customer Priority Routing Prototype",
      exact: true,
    }),
  });
  await card
    .getByRole("link", { name: "Preview template", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Required inputs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Expected behavior", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("template-preview").locator(".react-flow__minimap-node"),
  ).toHaveCount(5);
  await expect(page.getByText("Manual trigger", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("template-detail.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Install template", exact: true })
    .click();
  await expect(page).toHaveURL(/\/workflows\/[^/]+$/);
  const workflowId = page.url().split("/").at(-1)!;
  await expect(
    page.getByText(/Installed from Customer Priority Routing Prototype/),
  ).toBeVisible();
  const yes = page
    .locator('[data-node-kind="set_data"]')
    .filter({ hasText: "TRUE result" });
  const id = (await yes.getAttribute("data-testid"))!.replace(
    "workflow-node-",
    "",
  );
  await yes.click();
  await page
    .getByLabel("Node label", { exact: true })
    .fill("Priority response");
  await page
    .getByLabel("Set Data values (JSON object)", { exact: true })
    .fill('{"queue":"vip_review"}');
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByTestId("save-state")).toContainText("Draft 2");
  await page
    .getByRole("button", { name: "Validate graph", exact: true })
    .click();
  await expect(page.getByTestId("graph-validation")).toContainText(
    "Graph valid",
  );
  await page
    .getByRole("button", { name: "Publish saved draft", exact: true })
    .click();
  await expect(
    page.getByText("Published immutable version 2.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Run input JSON (up to 16 KiB; no credentials)", {
      exact: true,
    })
    .fill('{"priority":"urgent"}');
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page).toHaveURL(/\/history\/[^/]+$/);
  const runId = page.url().split("/").at(-1)!;
  await expect(
    page.getByRole("status").filter({ hasText: /^QUEUED$/ }),
  ).toBeVisible();
  await processRun(runId);
  await expect(page.getByTestId(`workflow-node-${id}`)).toHaveAttribute(
    "data-run-status",
    "SUCCEEDED",
  );
  await expect(page.getByTestId(`workflow-node-${id}`)).toContainText(
    "Priority response",
  );
  await expect(page.locator('[data-run-status="SKIPPED"]')).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("installed-template-execution.png"),
    fullPage: true,
  });
  await page.goto("/history");
  await expect(page.locator(`a[href="/history/${runId}"]`)).toContainText(
    "SUCCEEDED",
  );
  await page.goto("/templates");
  await expect(
    page.locator(`a[href="/workflows/${workflowId}"]`),
  ).toContainText("Source v1");
  expect(errors).toEqual([]);
});

test("viewer cannot install; mobile catalog and empty states remain accessible", async ({
  page,
  actors,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, actors.viewer);
  await page.goto("/templates");
  await expect(
    page.getByRole("link", { name: "Manage catalog", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Search templates", { exact: true })
    .fill("no-such-template-xyz");
  await page
    .getByRole("button", { name: "Search & filter", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No templates match yet", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Reset", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-template-catalog.png"),
    fullPage: true,
  });
  await page.goto("/templates/customer-priority");
  await expect(
    page.getByRole("button", { name: "Install template", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "VIEWER access is read-only. Ask an owner, admin, or editor to install.",
      { exact: true },
    ),
  ).toBeVisible();
  const template = await (
    await page.request.get("/api/templates/customer-priority")
  ).json();
  const response = await page.request.post(
    `/api/workspaces/${actors.workspaceId}/template-installations`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
      },
      data: { versionId: template.versionId },
    },
  );
  expect(response.status()).toBe(403);
  const denied = await page.request.get("/api/platform/templates");
  expect(denied.status()).toBe(403);
});

test("restricted platform administrator can manage publication and archive", async ({
  page,
  actors,
}) => {
  const slug = `browser-template-${randomUUID()}`;
  await db.platformAdministrator.create({ data: { userId: actors.owner.id } });
  try {
    await login(page, actors.owner);
    await page.goto("/templates");
    await page
      .getByRole("link", { name: "Manage catalog", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Platform template management",
        exact: true,
      }),
    ).toBeVisible();
    const content = {
      ...structuredClone(seedCatalog[6].content),
      name: "Browser managed starter",
    };
    await page
      .getByLabel("Slug (fixed after creation)", { exact: true })
      .fill(slug);
    await page
      .getByLabel("Template content JSON", { exact: true })
      .fill(JSON.stringify(content));
    await page
      .getByRole("button", { name: "Save template draft", exact: true })
      .click();
    await expect(
      page.getByText("Template draft saved.", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get(`/api/templates/${slug}`)).status()).toBe(
      404,
    );
    await page
      .getByRole("button", { name: "Validate saved template", exact: true })
      .click();
    await expect(
      page.getByText("Server validation passed for revision 1.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Publish template", exact: true })
      .click();
    await expect(
      page.getByText("Published immutable template version 1.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await page.request.get(`/api/templates/${slug}`)).status()).toBe(
      200,
    );
    content.name = "New unpublished browser name";
    await page
      .getByLabel("Template content JSON", { exact: true })
      .fill(JSON.stringify(content));
    await page
      .getByRole("button", { name: "Save template draft", exact: true })
      .click();
    await expect(
      page.getByText("Template draft saved.", { exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/templates/${slug}`)).json()).content
        .name,
    ).toBe("Browser managed starter");
    await page
      .getByRole("button", { name: "Publish template", exact: true })
      .click();
    await expect(
      page.getByText("Published immutable template version 2.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "List installations", exact: true })
      .click();
    await expect(
      page.getByText("0 installation record(s), latest 100.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Archive template", exact: true })
      .click();
    await expect(
      page.getByText(
        "Template archived. Existing installed workflows are preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await page.request.get(`/api/templates/${slug}`)).status()).toBe(
      404,
    );
  } finally {
    await db.platformAdministrator.deleteMany({
      where: { userId: actors.owner.id },
    });
    await db.automationTemplate.deleteMany({ where: { slug } });
  }
});
