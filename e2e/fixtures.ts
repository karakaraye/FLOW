import "dotenv/config";
import { test as base, expect, type Page, type Cookie } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import { createWorkflow, publishWorkflow } from "../src/lib/engine/service";
import { normalizeDocument } from "../src/lib/builder/document";
import { starterDefinition } from "../src/lib/engine/example";
type Person = {
  id: string;
  email: string;
  password: string;
  cookies?: Cookie[];
};
type Actors = {
  owner: Person;
  viewer: Person;
  outsider: Person;
  workspaceId: string;
  seedId: string;
  versionId: string;
};
export const test = base.extend<object, { actors: Actors }>({
  actors: [
    async ({ browserName }, provide) => {
      if (browserName !== "chromium")
        throw new Error("This fixture is configured for Chromium.");
      const people: Person[] = [];
      const workspaces: string[] = [];
      try {
        for (const role of ["Owner", "Viewer", "Outside"]) {
          const email = `visual-${role}-${randomUUID()}@example.test`;
          const password = `Strong-${randomUUID()}!`;
          const response = await auth.api.signUpEmail({
            body: { name: `Visual ${role}`, email, password },
          });
          people.push({ id: response.user.id, email, password });
        }
        const member = await ensurePersonalWorkspace(
          people[0].id,
          "Visual Owner",
        );
        workspaces.push(member.workspaceId);
        await db.workspaceMember.create({
          data: {
            workspaceId: member.workspaceId,
            userId: people[1].id,
            role: "VIEWER",
          },
        });
        const other = await ensurePersonalWorkspace(
          people[2].id,
          "Visual Outside",
        );
        workspaces.push(other.workspaceId);
        const document = normalizeDocument(
          "Read-only seeded workflow",
          starterDefinition,
        );
        const actor = { userId: people[0].id, workspaceId: member.workspaceId };
        const workflow = await createWorkflow(actor, {
          name: document.name,
          definition: document.definition,
          editor: document.editor,
        });
        const version = await publishWorkflow(actor, workflow.id, 1);
        await provide({
          owner: people[0],
          viewer: people[1],
          outsider: people[2],
          workspaceId: member.workspaceId,
          seedId: workflow.id,
          versionId: version.id,
        });
      } finally {
        await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
        await db.user.deleteMany({
          where: { id: { in: people.map((p) => p.id) } },
        });
        await db.$disconnect();
      }
    },
    { scope: "worker" },
  ],
});
export { expect };
export async function login(page: Page, person: Person) {
  if (person.cookies) {
    await page.context().addCookies(person.cookies);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Email address").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/auth/sign-in/email") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const response = await responsePromise;
  if (response.status() === 429) {
    // Respect the real authentication service's retry window, not a UI sleep.
    const seconds = Number(response.headers()["retry-after"] ?? 61);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1, seconds) * 1000),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
  person.cookies = await page.context().cookies();
}
