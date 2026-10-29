import { readiness } from "@/lib/operations/health";
export async function GET() {
  const ready = await readiness();
  return Response.json(
    { status: ready ? "ready" : "not_ready" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
