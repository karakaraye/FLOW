import { observe } from "@/lib/operations/observe";
import { challengeMeta, receiveMeta } from "@/lib/whatsapp/webhooks";
import { EngineError } from "@/lib/engine/definition";
export const runtime = "nodejs";
function failure(error: unknown) {
  return Response.json(
    {
      code:
        error instanceof EngineError
          ? error.code
          : "WHATSAPP_WEBHOOK_UNAVAILABLE",
    },
    {
      status: error instanceof EngineError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
async function handleGET(request: Request) {
  try {
    return new Response(challengeMeta(new URL(request.url)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
async function handlePOST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new EngineError("INVALID_BODY", "Use JSON.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new EngineError("INVALID_BODY", "Body required.");
    const chunks: Uint8Array[] = [];
    let size = 0;
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
    await receiveMeta(
      Buffer.concat(chunks),
      request.headers.get("x-hub-signature-256"),
    );
    return Response.json(
      { accepted: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function GET(request: Request) {
  return observe(request, "meta-webhook", () => handleGET(request));
}

export async function POST(request: Request) {
  return observe(request, "meta-webhook", () => handlePOST(request));
}
