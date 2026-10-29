import { randomUUID } from "node:crypto";
const events = [
  "APPLICATION_EVENT",
  "API_RESPONSE",
  "METRIC_WRITE_UNAVAILABLE",
  "SERVER_RENDER_ERROR",
  "WORKER_HEARTBEAT_UNAVAILABLE",
  "WORKER_STOP_REQUESTED",
  "WORKER_STARTED",
  "WORKER_CLAIMED",
  "WORKER_PROCESSING_UNAVAILABLE",
  "WORKER_STOPPED_UNEXPECTEDLY",
  "VAULT_ROTATED",
];
const routes = [
  "workspace",
  "auth",
  "catalog",
  "flow-webhook",
  "meta-webhook",
  "billing-webhook",
  "google-callback",
  "server",
];
export function requestId(request?: Request) {
  const id = request?.headers.get("x-request-id");
  return id && /^[a-f0-9-]{36}$/i.test(id) ? id : randomUUID();
}
export function logRecord(event: string, input: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {
    time: new Date().toISOString(),
    event: events.includes(event) ? event : "APPLICATION_EVENT",
  };
  for (const key of ["status", "durationMs", "count"]) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  for (const key of ["requestId", "runId"])
    if (typeof input[key] === "string" && /^[a-f0-9-]{36}$/i.test(input[key]))
      out[key] = input[key];
  if (
    typeof input.workerId === "string" &&
    /^[A-Za-z0-9_-]{1,80}$/.test(input.workerId)
  )
    out.workerId = input.workerId;
  if (
    typeof input.code === "string" &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(input.code)
  )
    out.code = input.code;
  if (typeof input.route === "string" && routes.includes(input.route))
    out.route = input.route;
  if (["SIGTERM", "SIGINT"].includes(String(input.signal)))
    out.signal = input.signal;
  if (event === "WORKER_CLAIMED" && typeof out.runId === "string")
    out.claim = `CLAIMED ${out.runId}`;
  return out;
}
export function securityLog(
  event: string,
  input: Record<string, unknown> = {},
) {
  console.log(JSON.stringify(logRecord(event, input)));
}
