import { observe } from "@/lib/operations/observe";
import { receiveWebhook } from "@/lib/webhooks/service";
import { EngineError } from "@/lib/engine/definition";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ webhookId: string }> },
) {
  try {
    const result = await receiveWebhook((await params).webhookId, request);
    return Response.json(result, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Delivery rejected.",
        code: error instanceof EngineError ? error.code : "DELIVERY_FAILED",
      },
      {
        status: error instanceof EngineError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ webhookId: string }> },
) {
  return observe(request, "flow-webhook", () => handlePOST(request, context));
}
