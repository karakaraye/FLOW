import { writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { securityLog } from "./log";
export function workerHealth() {
  const id = process.env.FLOWPILOT_WORKER_ID ?? randomUUID();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error("WORKER_ID_INVALID");
  let state = "STARTING",
    runId: string | null = null,
    writing = false;
  async function heartbeat() {
    if (writing) return;
    writing = true;
    try {
      await db.workerHeartbeat.upsert({
        where: { id },
        create: { id, status: state, lastRunId: runId },
        update: {
          status: state,
          lastRunId: runId,
          lastSeenAt: new Date(),
          errorCode: state === "ERROR" ? "WORKER_PROCESSING_UNAVAILABLE" : null,
        },
      });
      const path =
          process.env.WORKER_HEALTH_FILE ?? "/tmp/flowpilot-worker-health.json",
        tmp = path + "." + randomUUID();
      await writeFile(
        tmp,
        JSON.stringify({
          id,
          status: state,
          lastSeenAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
      await rename(tmp, path);
    } catch {
      securityLog("WORKER_HEARTBEAT_UNAVAILABLE", {
        workerId: id,
        code: "DATABASE_UNAVAILABLE",
      });
    } finally {
      writing = false;
    }
  }
  const timer = setInterval(() => {
    void heartbeat();
  }, 10000);
  timer.unref();
  return {
    id,
    async set(status: string, run: string | null = null) {
      state = status;
      runId = run;
      await heartbeat();
    },
    async stop() {
      clearInterval(timer);
      state = "STOPPED";
      await heartbeat();
    },
  };
}
