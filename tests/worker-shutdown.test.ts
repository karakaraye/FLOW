import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { rm } from "node:fs/promises";
import { db } from "../src/lib/db";

test(
  "idle dedicated worker handles SIGTERM and persists a stopped heartbeat",
  { timeout: 20000 },
  async () => {
    const id = randomUUID(),
      path = `/tmp/flowpilot-shutdown-${id}.json`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/worker.ts", "--run-id", randomUUID()],
      {
        env: {
          ...process.env,
          FLOWPILOT_WORKER_ID: id,
          WORKER_HEALTH_FILE: path,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    const exited = once(child, "exit");
    try {
      for (let i = 0; i < 200 && !output.includes("WORKER_STARTED"); i++)
        await sleep(25);
      assert.ok(output.includes("WORKER_STARTED"));
      assert.equal(
        (await db.workerHeartbeat.findUniqueOrThrow({ where: { id } })).status,
        "IDLE",
      );
      child.kill("SIGTERM");
      const [code] = await exited;
      assert.equal(code, 0);
      assert.ok(output.includes("WORKER_STOP_REQUESTED"));
      assert.equal(
        (await db.workerHeartbeat.findUniqueOrThrow({ where: { id } })).status,
        "STOPPED",
      );
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await db.workerHeartbeat.deleteMany({ where: { id } });
      await rm(path, { force: true });
      await db.$disconnect();
    }
  },
);
