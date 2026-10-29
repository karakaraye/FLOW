import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { test, expect, login } from "./fixtures";
let app: ChildProcess;
const origin = "http://localhost:3005",
  token = "fixture-operations-only-secret-32-characters-long";
test.beforeAll(async () => {
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3005",
    ],
    {
      env: {
        ...process.env,
        BETTER_AUTH_URL: origin,
        OPERATIONS_TOKEN: token,
        FLOWPILOT_ENV: "test",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(origin + "/api/health/live")).ok) return;
    } catch {}
    await sleep(100);
  }
  throw Error("Security fixture app did not start");
});
test.afterAll(async () => {
  app?.kill("SIGTERM");
  if (app)
    await new Promise<void>((r) =>
      app.exitCode !== null ? r() : app.once("exit", () => r()),
    );
});
test("fresh CSP nonces, restrictive headers and authenticated UI work without script policy violations", async ({
  page,
  actors,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy|refused to execute/i.test(message.text())
    )
      violations.push(message.text());
  });
  const one = await page.request.get("/"),
    two = await page.request.get("/"),
    csp = one.headers()["content-security-policy"];
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).not.toBe(two.headers()["content-security-policy"]);
  expect(one.headers()["x-content-type-options"]).toBe("nosniff");
  expect(one.headers()["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/i);
  await login(page, actors.owner);
  await expect(
    page.getByRole("heading", { name: /A little more possibility/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Array.from(document.scripts).some((s) => Boolean(s.nonce)),
    ),
  ).toBe(true);
  expect(violations).toEqual([]);
});
test("health is minimal, metrics are operator-only and contain no credential material", async ({
  page,
}) => {
  expect((await page.request.get(origin + "/api/health/live")).status()).toBe(
    200,
  );
  expect((await page.request.get(origin + "/api/health/ready")).status()).toBe(
    200,
  );
  expect(
    (await page.request.get(origin + "/api/operations/metrics")).status(),
  ).toBe(401);
  const result = await page.request.get(origin + "/api/operations/metrics", {
    headers: { Authorization: "Bearer " + token },
  });
  expect(result.status()).toBe(200);
  const text = await result.text();
  expect(text).toContain("workflowRuns");
  expect(text).toContain("billingEvents");
  expect(text).not.toContain(token);
  expect(text).not.toContain("ciphertext");
  expect(text).not.toContain("accessToken");
  expect(text).not.toContain("requestedBy");
});
test("real session rejects cross-origin logout, then legitimate logout clears access", async ({
  page,
  actors,
}) => {
  // Revoke a fresh session, preserving the worker-scoped fixture's cached session.
  await login(page, { ...actors.owner, cookies: undefined });
  const bad = await page.request.post("/api/auth/sign-out", {
    headers: { Origin: "https://evil.example" },
  });
  expect(bad.status()).toBe(403);
  expect(
    (await page.request.get(`/api/workspaces/${actors.workspaceId}`)).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await page.request.get(`/api/workspaces/${actors.workspaceId}`)).status(),
  ).toBe(401);
});
