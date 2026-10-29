import { db } from "../db";
import { requestId, securityLog } from "./log";
export const routes = [
  "workspace",
  "auth",
  "catalog",
  "flow-webhook",
  "meta-webhook",
  "billing-webhook",
  "google-callback",
  "server",
] as const;
export async function recordMetric(route: string, status: number) {
  if (
    !(routes as readonly string[]).includes(route) ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  )
    return;
  const bucket = new Date(Math.floor(Date.now() / 60000) * 60000);
  await db.operationalMetric.upsert({
    where: { bucket_route_status: { bucket, route, status } },
    create: { bucket, route, status, count: 1 },
    update: { count: { increment: 1 } },
  });
}
export async function observe(
  request: Request,
  route: (typeof routes)[number],
  fn: () => Promise<Response>,
) {
  const id = requestId(request),
    start = Date.now();
  let response: Response;
  try {
    response = await fn();
  } catch {
    response = Response.json(
      {
        code: "INTERNAL_ERROR",
        error: "The operation could not be completed.",
      },
      { status: 500 },
    );
  }
  response.headers.set("X-Request-Id", id);
  response.headers.set("Cache-Control", "private, no-store");
  if (response.status === 429) response.headers.set("Retry-After", "60");
  securityLog("API_RESPONSE", {
    requestId: id,
    route,
    status: response.status,
    durationMs: Date.now() - start,
  });
  try {
    await recordMetric(route, response.status);
  } catch {
    securityLog("METRIC_WRITE_UNAVAILABLE", {
      requestId: id,
      route,
      code: "DATABASE_UNAVAILABLE",
    });
  }
  return response;
}
