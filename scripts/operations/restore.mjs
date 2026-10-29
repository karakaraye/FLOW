import "dotenv/config";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { decryptArchive } from "./archive.mjs";
import { pgTool, connectionEnv } from "./pg-tools.mjs";
export function validateRestore(
  url,
  confirm,
  developmentUrl = process.env.DATABASE_URL,
) {
  const target = connectionEnv(url);
  if (
    !/^flowpilot_restore_[A-Za-z0-9_]{1,45}$/.test(target.PGDATABASE) ||
    confirm !== target.PGDATABASE
  )
    throw Error("RESTORE_TARGET_NOT_CONFIRMED");
  if (developmentUrl) {
    const dev = connectionEnv(developmentUrl);
    if (dev.PGDATABASE === target.PGDATABASE)
      throw Error("RESTORE_OVER_EXISTING_DATABASE_FORBIDDEN");
  }
  return target;
}
export async function restore({
  url,
  confirm,
  path,
  key,
  keyId,
  developmentUrl,
}) {
  validateRestore(url, confirm, developmentUrl);
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  let dir;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('flowpilot-restore-exclusive'))",
    );
    const rows = await client.query(
      "SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','m','S')",
    );
    if (rows.rows[0].n !== 0) throw Error("RESTORE_TARGET_NOT_EMPTY");
    dir = await mkdtemp(join(tmpdir(), "flowpilot-restore-"));
    const dump = join(dir, "verified.dump");
    await decryptArchive(path, dump, key, keyId);
    const task = pgTool(
      "pg_restore",
      [
        "--dbname",
        connectionEnv(url).PGDATABASE,
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
      ],
      url,
      { input: true },
    );
    await Promise.all([
      pipeline(createReadStream(dump), task.child.stdin),
      task.done,
    ]);
  } finally {
    await client.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  restore({
    url: process.env.RESTORE_DATABASE_URL,
    confirm: process.env.RESTORE_CONFIRM_DATABASE,
    path: process.env.BACKUP_INPUT,
    key: process.env.BACKUP_ENCRYPTION_KEY,
    keyId: process.env.BACKUP_KEY_ID,
  })
    .then(() => console.log(JSON.stringify({ event: "RESTORE_COMPLETE" })))
    .catch(() => {
      console.error(JSON.stringify({ event: "RESTORE_FAILED" }));
      process.exitCode = 1;
    });
}
