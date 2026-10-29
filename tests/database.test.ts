import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("initial migration enforces relational tenant constraints in PostgreSQL", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // A fresh, isolated namespace; all test DDL and data are rolled back.
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      await readFile(
        new URL(
          "../prisma/migrations/20261028000000_foundation/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query(
      `INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('a','User A','a@example.test',NOW()),('b','User B','b@example.test',NOW())`,
    );
    await client.query(
      `INSERT INTO "Workspace" (id,name,"updatedAt") VALUES ('wa','Workspace A',NOW()),('wb','Workspace B',NOW())`,
    );
    await client.query(
      `INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role) VALUES ('ma','wa','a','OWNER'),('mb','wb','b','VIEWER')`,
    );
    async function expectConstraint(sql: string, code: string) {
      await client.query("SAVEPOINT constraint_check");
      try {
        await assert.rejects(
          client.query(sql),
          (error: unknown) =>
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === code,
        );
      } finally {
        await client.query("ROLLBACK TO SAVEPOINT constraint_check");
      }
    }
    await t.test("duplicate membership rejected", () =>
      expectConstraint(
        `INSERT INTO "WorkspaceMember" (id,"workspaceId","userId") VALUES ('duplicate','wa','a')`,
        "23505",
      ),
    );
    await t.test("missing user rejected", () =>
      expectConstraint(
        `INSERT INTO "WorkspaceMember" (id,"workspaceId","userId") VALUES ('missing','wa','missing')`,
        "23503",
      ),
    );
    await t.test("unknown role rejected", () =>
      expectConstraint(
        `UPDATE "WorkspaceMember" SET role='SUPERUSER' WHERE id='ma'`,
        "22P02",
      ),
    );
    await t.test("duplicate email rejected", () =>
      expectConstraint(
        `INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('c','Duplicate','a@example.test',NOW())`,
        "23505",
      ),
    );
    await t.test("negative subscription price rejected", () =>
      expectConstraint(
        `INSERT INTO "SubscriptionPlan" (id,code,name,"monthlyPriceCents") VALUES ('bad','bad','Bad',-1)`,
        "23514",
      ),
    );
    await client.query(
      `INSERT INTO "SubscriptionPlan" (id,code,name,"monthlyPriceCents") VALUES ('p','explore','Explore',0)`,
    );
    await client.query(
      `INSERT INTO "Subscription" (id,"workspaceId","planId","updatedAt") VALUES ('sa','wa','p',NOW())`,
    );
    await t.test("one subscription per workspace enforced", () =>
      expectConstraint(
        `INSERT INTO "Subscription" (id,"workspaceId","planId","updatedAt") VALUES ('sa2','wa','p',NOW())`,
        "23505",
      ),
    );
    await t.test("in-use plan cannot be deleted", () =>
      expectConstraint(`DELETE FROM "SubscriptionPlan" WHERE id='p'`, "23503"),
    );
    await t.test(
      "workspace deletion cascades its membership and subscription only",
      async () => {
        await client.query(`DELETE FROM "Workspace" WHERE id='wa'`);
        assert.equal(
          (
            await client.query(
              `SELECT * FROM "WorkspaceMember" WHERE "workspaceId"='wa'`,
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await client.query(
              `SELECT * FROM "Subscription" WHERE "workspaceId"='wa'`,
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await client.query(
              `SELECT * FROM "WorkspaceMember" WHERE "workspaceId"='wb'`,
            )
          ).rowCount,
          1,
        );
        assert.equal((await client.query(`SELECT * FROM "User"`)).rowCount, 2);
      },
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
