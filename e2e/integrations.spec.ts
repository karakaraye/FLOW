import { test, expect, login } from "./fixtures";
import { db } from "../src/lib/db";
import { decryptSecret } from "../src/lib/integrations/crypto";
import type { CredentialSet } from "../src/lib/integrations/contracts";
function metadataOnly(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /"(?:accessToken|refreshToken|ciphertext|keyId|authStateCiphertext|authStateHash|verifier|proof|authAttemptId|authInitiatedBy)"/,
  );
}

test("local integration lifecycle verifies credentials without exposing them", async ({
  page,
  actors,
}, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page, actors.owner);
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Integrations", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("provider-local-test")).toContainText(
    "TEST ENVIRONMENT ONLY",
  );
  await page
    .getByRole("button", { name: "Create local test record", exact: true })
    .click();
  await expect(page).toHaveURL(/\/integrations\/[^/]+$/);
  const id = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("connection-status")).toHaveText(
    "DISCONNECTED",
  );
  await expect(page.getByText(/LOCAL TEST ONLY\. This provider/)).toBeVisible();
  await page
    .getByLabel("Display label (non-secret metadata)", { exact: true })
    .fill("Local verification fixture");
  await page
    .getByRole("button", { name: "Save display label", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Local verification fixture",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start local test", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("PENDING");
  await page
    .getByRole("button", { name: "Complete local test", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("CONNECTED");
  await expect(
    page.getByText(
      "Local test authentication verified. No third-party service was connected.",
      { exact: true },
    ),
  ).toBeVisible();
  const stored = await db.integrationCredential.findUniqueOrThrow({
    where: { integrationId: id },
  });
  const secret = decryptSecret<CredentialSet>(stored.ciphertext, {
    workspaceId: actors.workspaceId,
    integrationId: id,
    providerId: "local-test",
    recordId: stored.id,
    purpose: "credential",
  });
  for (const path of [
    `/api/workspaces/${actors.workspaceId}/integrations`,
    `/api/workspaces/${actors.workspaceId}/integrations/${id}`,
    `/api/workspaces/${actors.workspaceId}/integration-events?integrationId=${id}`,
  ]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(200);
    const value = await response.json();
    metadataOnly(value);
    expect(JSON.stringify(value).includes(secret.accessToken)).toBe(false);
    expect(JSON.stringify(value).includes(secret.refreshToken)).toBe(false);
  }
  expect((await page.content()).includes(secret.accessToken)).toBe(false);
  await page
    .getByRole("button", { name: "Verify connection health", exact: true })
    .click();
  await expect(
    page.getByText("HEALTH_VERIFIED · CONNECTED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Refresh test credential", exact: true })
    .click();
  await expect(
    page.getByText("REFRESHED · CONNECTED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rotate to active storage key", exact: true })
    .click();
  await expect(
    page.getByText("KEY_ROTATED · CONNECTED", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("verified-local-test.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Revoke local access", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText("REVOKED");
  await expect(
    page.getByText(
      "Local access revoked and encrypted credential material erased.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    (
      await db.integrationCredential.findUniqueOrThrow({
        where: { integrationId: id },
      })
    ).ciphertext,
  ).toBe("");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(
    page.getByText("DELETED · REVOKED", { exact: true }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("viewer and editor have metadata-only integration access", async ({
  page,
  actors,
}, info) => {
  await login(page, actors.owner);
  await page.goto("/integrations");
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(
    `/api/workspaces/${actors.workspaceId}/integrations`,
    {
      headers: { Origin: origin },
      data: {
        providerId: "local-test",
        label: "Read-only integration fixture",
      },
    },
  );
  expect(response.status()).toBe(201);
  const connection = await response.json();
  await page.context().clearCookies();
  await login(page, actors.viewer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/integrations/${connection.id}`);
  await expect(
    page.getByLabel("Display label (non-secret metadata)", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start local test", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revoke local access", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "VIEWER · Metadata-only access. Only OWNER and ADMIN may manage connections.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-integration-readonly.png"),
    fullPage: true,
  });
  for (const role of ["VIEWER", "EDITOR"] as const) {
    await db.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: actors.workspaceId,
          userId: actors.viewer.id,
        },
      },
      data: { role },
    });
    try {
      await page.reload();
      await expect(
        page.getByText(
          `${role} · Metadata-only access. Only OWNER and ADMIN may manage connections.`,
          { exact: true },
        ),
      ).toBeVisible();
      for (const suffix of ["test/start", "revoke", "refresh"]) {
        const result = await page.request.post(
          `/api/workspaces/${actors.workspaceId}/integrations/${connection.id}/${suffix}`,
          {
            headers: { Origin: origin },
            data: { revision: connection.revision },
          },
        );
        expect(result.status()).toBe(403);
      }
      const create = await page.request.post(
        `/api/workspaces/${actors.workspaceId}/integrations`,
        {
          headers: { Origin: origin },
          data: { providerId: "openai", label: "Denied" },
        },
      );
      expect(create.status()).toBe(403);
    } finally {
      await db.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: actors.workspaceId,
            userId: actors.viewer.id,
          },
        },
        data: { role: "VIEWER" },
      });
    }
  }
});

test("future providers stay Coming Soon with disconnected records only", async ({
  page,
  actors,
}, info) => {
  await login(page, actors.owner);
  await page.goto("/integrations");
  for (const id of [
    "gmail",
    "google-sheets",
    "whatsapp-business",
    "http-api",
    "openai",
  ]) {
    await expect(page.getByTestId(`provider-${id}`)).toContainText(
      "Coming Soon",
    );
  }
  await page
    .getByTestId("provider-gmail")
    .getByRole("button", { name: "Save disconnected record", exact: true })
    .click();
  await expect(page.getByTestId("connection-status")).toHaveText(
    "DISCONNECTED",
  );
  await expect(
    page.getByText(
      "Coming Soon. This is a disconnected metadata record; external authentication and provider actions are not implemented.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete local test", exact: true }),
  ).toHaveCount(0);
  const id = page.url().split("/").at(-1)!;
  const response = await page.request.post(
    `/api/workspaces/${actors.workspaceId}/integrations/${id}/test/start`,
    { headers: { Origin: new URL(page.url()).origin }, data: { revision: 1 } },
  );
  expect(response.status()).toBe(409);
  expect(
    await db.integrationCredential.count({ where: { integrationId: id } }),
  ).toBe(0);
  await page.goto("/integrations");
  await page.screenshot({
    path: info.outputPath("integration-catalog.png"),
    fullPage: true,
  });
});

test("connection metadata, events, and actions never cross workspaces", async ({
  page,
  browser,
  actors,
}) => {
  await login(page, actors.owner);
  await page.goto("/integrations");
  const origin = new URL(page.url()).origin;
  const connections = await (
    await page.request.get(`/api/workspaces/${actors.workspaceId}/integrations`)
  ).json();
  const own = connections.find(
    (c: { providerId: string }) => c.providerId === "local-test",
  );
  expect(own).toBeTruthy();
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await login(other, actors.outsider);
    const target = `/api/workspaces/${actors.workspaceId}/integrations/${own.id}`;
    expect((await other.request.get(target)).status()).toBe(404);
    expect(
      (
        await other.request.get(
          `/api/workspaces/${actors.workspaceId}/integration-events?integrationId=${own.id}`,
        )
      ).status(),
    ).toBe(404);
    const revoked = await other.request.post(`${target}/revoke`, {
      headers: { Origin: origin },
      data: { revision: own.revision },
    });
    expect(revoked.status()).toBe(404);
    await other.goto(`/integrations/${own.id}`);
    await expect(
      other.getByRole("heading", {
        name: "Let’s get you back in flow.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      other.getByText("Read-only integration fixture", { exact: true }),
    ).toHaveCount(0);
    expect((await other.request.get(`${target}/credentials`)).status()).toBe(
      404,
    );
  } finally {
    await otherContext.close();
  }
});
