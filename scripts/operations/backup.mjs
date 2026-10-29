import "dotenv/config";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { encryptArchive } from "./archive.mjs";
import { pgTool } from "./pg-tools.mjs";
export async function backup({ url, path, key, keyId }) {
  if (!url || !path) throw Error("BACKUP_CONFIGURATION_REQUIRED");
  const staging = await mkdtemp(join(dirname(path), ".flowpilot-backup-")),
    staged = join(staging, "archive");
  const task = pgTool(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-acl", "--serializable-deferrable"],
    url,
  );
  void task.done.catch(() => {});
  try {
    const manifest = await encryptArchive(
      task.child.stdout,
      staged,
      key,
      keyId,
    );
    await task.done;
    await copyFile(staged, path, constants.COPYFILE_EXCL);
    await copyFile(staged + ".json", path + ".json", constants.COPYFILE_EXCL);
    return manifest;
  } catch {
    task.child.kill("SIGTERM");
    await task.done.catch(() => {});
    throw Error("BACKUP_FAILED");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  backup({
    url: process.env.BACKUP_DATABASE_URL,
    path: process.env.BACKUP_OUTPUT,
    key: process.env.BACKUP_ENCRYPTION_KEY,
    keyId: process.env.BACKUP_KEY_ID,
  })
    .then(() => console.log(JSON.stringify({ event: "BACKUP_COMPLETE" })))
    .catch(() => {
      console.error(JSON.stringify({ event: "BACKUP_FAILED" }));
      process.exitCode = 1;
    });
}
