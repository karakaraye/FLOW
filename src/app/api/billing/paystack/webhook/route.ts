import { observe } from "@/lib/operations/observe";
import { receivePaystack } from "@/lib/billing/events";
import { EngineError } from "@/lib/engine/definition";
export const runtime = "nodejs";
async function handlePOST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new EngineError("INVALID_BODY", "Use JSON.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new EngineError("INVALID_BODY", "Body required.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new EngineError("SIZE_LIMIT", "Body too large.", 413);
      }
      chunks.push(value);
    }
    return Response.json(
      await receivePaystack(
        Buffer.concat(chunks),
        request.headers.get("x-paystack-signature"),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        code: e instanceof EngineError ? e.code : "BILLING_WEBHOOK_UNAVAILABLE",
      },
      {
        status: e instanceof EngineError ? e.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function POST(request: Request) {
  return observe(request, "billing-webhook", () => handlePOST(request));
}
