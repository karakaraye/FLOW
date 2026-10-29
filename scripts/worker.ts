import "dotenv/config";
process.env.FLOWPILOT_PROCESS_ROLE = "worker";
import { setTimeout } from "node:timers/promises";
import { processNext } from "../src/lib/engine/worker";
import { db } from "../src/lib/db";
import { assertRuntime } from "../src/lib/security/runtime";
import { securityLog } from "../src/lib/operations/log";
import { workerHealth } from "../src/lib/operations/worker-health";
import { operationalRetention } from "../src/lib/operations/health";
const once = process.argv.includes("--once"),
  index = process.argv.indexOf("--run-id"),
  runId = index >= 0 ? process.argv[index + 1] : undefined;
let stopping = false;
const health = workerHealth();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopping = true;
    securityLog("WORKER_STOP_REQUESTED", { workerId: health.id, signal });
    void health.set("STOPPING");
  });
async function main() {
  assertRuntime();
  await health.set("IDLE");
  securityLog("WORKER_STARTED", { workerId: health.id });
  let cleanupAt = 0;
  do {
    try {
      if (Date.now() > cleanupAt) {
        await operationalRetention();
        cleanupAt = Date.now() + 3600000;
      }
      const processed = await processNext({
        runId,
        onClaim: (id) => {
          securityLog("WORKER_CLAIMED", { workerId: health.id, runId: id });
          void health.set(stopping ? "STOPPING" : "BUSY", id);
        },
      });
      await health.set(stopping ? "STOPPING" : "IDLE");
      if (once) return;
      if (!processed) await setTimeout(500);
    } catch {
      securityLog("WORKER_PROCESSING_UNAVAILABLE", {
        workerId: health.id,
        code: "TRANSACTION_UNAVAILABLE",
      });
      await health.set("ERROR");
      if (once) {
        process.exitCode = 1;
        return;
      }
      await setTimeout(1000);
    }
  } while (!stopping);
}
main()
  .catch(() => {
    securityLog("WORKER_STOPPED_UNEXPECTEDLY", {
      workerId: health.id,
      code: "RUNTIME_UNAVAILABLE",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await health.stop();
    await db.$disconnect();
  });
