import {
  operationsAuthorized,
  operationsMetrics,
} from "@/lib/operations/health";
export async function GET(request: Request) {
  if (!operationsAuthorized(request))
    return Response.json(
      { code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await operationsMetrics(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { code: "METRICS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
