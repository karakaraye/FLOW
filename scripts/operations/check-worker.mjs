import { readFileSync } from "node:fs";
try {
  const value = JSON.parse(
    readFileSync(
      process.env.WORKER_HEALTH_FILE ?? "/tmp/flowpilot-worker-health.json",
      "utf8",
    ),
  );
  if (
    !["IDLE", "BUSY"].includes(value.status) ||
    Date.now() - Date.parse(value.lastSeenAt) > 45000
  )
    process.exit(1);
} catch {
  process.exit(1);
}
