import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { db } from "../src/lib/db";
import {
  authorizedMembership,
  ensurePersonalWorkspace,
} from "../src/lib/workspaces";

// Run against a disposable local database and a running application. Each run
// creates uniquely named users and deletes only records created by that run.
const baseURL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const userIds: string[] = [];
const workspaceIds: string[] = [];
const run = randomUUID();
const password = `Foundation-${randomUUID()}!`;
function request(path: string, options: RequestInit = {}) {
  return fetch(new URL(path, baseURL), {
    ...options,
    redirect: "manual",
    headers: {
      Origin: baseURL,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
after(async () => {
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

test("real authentication and tenant boundary", async (t) => {
  let cookieA = "";
  let cookieB = "";
  let workspaceA = "";
  let workspaceB = "";
  const emailA = `foundation-a-${run}@example.test`;
  const emailB = `foundation-b-${run}@example.test`;

  await t.test("public site and account forms render", async () => {
    for (const path of ["/", "/login", "/register"]) {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /FlowPilot/);
    }
  });
  await t.test("every app route rejects an anonymous visitor", async () => {
    for (const path of [
      "/dashboard",
      "/workflows",
      "/templates",
      "/integrations",
      "/history",
      "/settings",
    ]) {
      const response = await request(path);
      assert.equal(response.status, 307, path);
      assert.equal(
        new URL(response.headers.get("location")!, baseURL).pathname,
        "/login",
      );
    }
    assert.equal((await request("/api/workspaces/unknown")).status, 401);
  });
  await t.test("password policy rejects weak registration", async () => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name: "Weak",
        email: `weak-${run}@example.test`,
        password: "short",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(
      await db.user.count({ where: { email: `weak-${run}@example.test` } }),
      0,
    );
  });
  await t.test(
    "registration persists two distinct real accounts and sessions",
    async () => {
      for (const [email, name] of [
        [emailA, "Foundation A"],
        [emailB, "Foundation B"],
      ]) {
        const response = await request("/api/auth/sign-up/email", {
          method: "POST",
          body: JSON.stringify({ name, email, password }),
        });
        assert.equal(response.status, 200, await response.clone().text());
        const data = await response.json();
        userIds.push(data.user.id);
        const cookie = cookieFrom(response);
        assert.ok(cookie);
        assert.match(response.headers.getSetCookie().join(" "), /httponly/i);
        assert.match(
          response.headers.getSetCookie().join(" "),
          /samesite=lax/i,
        );
        if (email === emailA) cookieA = cookie;
        else cookieB = cookie;
        const account = await db.account.findFirstOrThrow({
          where: { userId: data.user.id, providerId: "credential" },
        });
        assert.ok(account.password);
        assert.notEqual(account.password, password);
        assert.equal(
          await db.session.count({ where: { userId: data.user.id } }),
          1,
        );
      }
    },
  );
  await t.test(
    "authenticated dashboard provisions private workspaces",
    async () => {
      for (const [index, cookie] of [cookieA, cookieB].entries()) {
        const response = await request("/dashboard", {
          headers: { Cookie: cookie },
        });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Account created/);
        const membership = await db.workspaceMember.findFirstOrThrow({
          where: { userId: userIds[index] },
        });
        assert.equal(membership.role, "OWNER");
        workspaceIds.push(membership.workspaceId);
        if (index === 0) workspaceA = membership.workspaceId;
        else workspaceB = membership.workspaceId;
      }
      assert.notEqual(workspaceA, workspaceB);
    },
  );
  await t.test(
    "concurrent provisioning does not create duplicate workspaces",
    async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          ensurePersonalWorkspace(userIds[0], "Foundation A"),
        ),
      );
      assert.equal(
        await db.workspaceMember.count({ where: { userId: userIds[0] } }),
        1,
      );
    },
  );
  await t.test(
    "all authenticated preview pages render without fake activity",
    async () => {
      for (const path of [
        "/workflows",
        "/templates",
        "/integrations",
        "/history",
        "/settings",
      ]) {
        const response = await request(path, { headers: { Cookie: cookieA } });
        assert.equal(response.status, 200, path);
        assert.match(
          await response.text(),
          /coming soon|not available|not connected|not been built/i,
        );
      }
    },
  );
  await t.test(
    "workspace reads are scoped to authenticated membership",
    async () => {
      const own = await request(`/api/workspaces/${workspaceA}`, {
        headers: { Cookie: cookieA },
      });
      assert.equal(own.status, 200);
      assert.equal((await own.json()).workspace.id, workspaceA);
      assert.equal(
        (
          await request(`/api/workspaces/${workspaceB}`, {
            headers: { Cookie: cookieA },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(`/api/workspaces/${workspaceA}`, {
            headers: { Cookie: cookieB },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/api/workspaces/nonexistent", {
            headers: { Cookie: cookieA },
          })
        ).status,
        404,
      );
    },
  );
  await t.test("server authorization enforces all four roles", async () => {
    for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
      await db.workspaceMember.update({
        where: {
          workspaceId_userId: { workspaceId: workspaceA, userId: userIds[0] },
        },
        data: { role },
      });
      assert.ok(await authorizedMembership(userIds[0], workspaceA, [role]));
      assert.equal(
        Boolean(
          await authorizedMembership(userIds[0], workspaceA, [
            "OWNER",
            "ADMIN",
          ]),
        ),
        role === "OWNER" || role === "ADMIN",
      );
      assert.equal(
        await authorizedMembership(userIds[1], workspaceA, [role]),
        null,
      );
    }
    await db.workspaceMember.update({
      where: {
        workspaceId_userId: { workspaceId: workspaceA, userId: userIds[0] },
      },
      data: { role: "OWNER" },
    });
  });
  await t.test(
    "database rejects duplicate memberships and dangling users",
    async () => {
      await assert.rejects(
        db.workspaceMember.create({
          data: { workspaceId: workspaceA, userId: userIds[0], role: "ADMIN" },
        }),
      );
      await assert.rejects(
        db.workspaceMember.create({
          data: {
            workspaceId: workspaceA,
            userId: "nonexistent-user",
            role: "VIEWER",
          },
        }),
      );
    },
  );
  await t.test(
    "forged sessions and cross-origin mutations are rejected",
    async () => {
      assert.equal(
        (
          await request(`/api/workspaces/${workspaceA}`, {
            headers: { Cookie: "better-auth.session_token=forged" },
          })
        ).status,
        401,
      );
      const response = await request("/api/auth/sign-out", {
        method: "POST",
        headers: { Cookie: cookieA, Origin: "https://untrusted.example" },
        body: "{}",
      });
      assert.equal(response.status, 403);
      assert.equal(
        (
          await request(`/api/workspaces/${workspaceA}`, {
            headers: { Cookie: cookieA },
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "incorrect password is rejected; correct password creates a session",
    async () => {
      const invalid = await request("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({
          email: emailA,
          password: "not-the-correct-password",
        }),
      });
      assert.equal(invalid.status, 401);
      const valid = await request("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: emailA, password }),
      });
      assert.equal(valid.status, 200);
      const loginCookie = cookieFrom(valid);
      assert.equal(
        (
          await request(`/api/workspaces/${workspaceA}`, {
            headers: { Cookie: loginCookie },
          })
        ).status,
        200,
      );
    },
  );
  await t.test("logout revokes the session server-side", async () => {
    const response = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookieA },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(
      (
        await request(`/api/workspaces/${workspaceA}`, {
          headers: { Cookie: cookieA },
        })
      ).status,
      401,
    );
    assert.equal(
      (await request("/dashboard", { headers: { Cookie: cookieA } })).status,
      307,
    );
  });
});
