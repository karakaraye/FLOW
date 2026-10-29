import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { processNext } from "../src/lib/engine/worker";
import { db } from "../src/lib/db";
const once = process.argv.includes("--once");
const runIndex = process.argv.indexOf("--run-id");
const runId = runIndex >= 0 ? process.argv[runIndex + 1] : undefined;
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  do {
    try {
      const processed = await processNext({
        runId,
        onClaim: (id) => console.log(`CLAIMED ${id}`),
      });
      if (once) return;
      if (!processed) await setTimeout(500);
    } catch {
      console.error(
        "Worker transaction failed; queued job remains recoverable.",
      );
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
    console.error("Worker stopped unexpectedly.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
