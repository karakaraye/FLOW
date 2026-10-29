import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
async function command(action: string, userId: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/catalog-admin.ts", action, userId],
    { stdio: "ignore" },
  );
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
test("trusted operator CLI grants/revokes only explicit existing-user permissions", async () => {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: "CLI permission test", email: `cli-${id}@example.test` },
  });
  try {
    assert.equal(await command("grant", id), 0);
    assert.ok(
      await db.platformAdministrator.findUnique({ where: { userId: id } }),
    );
    assert.equal(await command("grant", id), 0);
    assert.equal(
      await db.platformAdministrator.count({ where: { userId: id } }),
      1,
    );
    assert.equal(await command("revoke", id), 0);
    assert.equal(
      await db.platformAdministrator.findUnique({ where: { userId: id } }),
      null,
    );
    assert.equal(await command("grant", `missing-${randomUUID()}`), 1);
  } finally {
    await db.user.delete({ where: { id } });
    await db.$disconnect();
  }
});
