import { receiveWebhook } from "@/lib/webhooks/service";
import { EngineError } from "@/lib/engine/definition";
export const runtime = "nodejs";
export async function POST(
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
