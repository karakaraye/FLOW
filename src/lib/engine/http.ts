import { observe } from "../operations/observe";
import { apiRate } from "../security/rate";
import { auth } from "../auth";
import { EngineError, LIMITS } from "./definition";
async function workspaceResponse(
  request: Request,
  workspaceId: string,
  action: (actor: { userId: string; workspaceId: string }) => Promise<unknown>,
  status = 200,
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session)
      throw new EngineError("UNAUTHORIZED", "Sign in to continue.", 401);
    if (!["GET", "HEAD"].includes(request.method)) {
      const expected = new URL(process.env.BETTER_AUTH_URL!).origin;
      if (request.headers.get("origin") !== expected)
        throw new EngineError(
          "INVALID_ORIGIN",
          "Untrusted request origin.",
          403,
        );
    }
    await apiRate(session.user.id);
    return Response.json(
      await action({ userId: session.user.id, workspaceId }),
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof EngineError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    // Never forward Prisma exceptions or request data to clients or logs.
    return Response.json(
      {
        error: "The operation could not be completed.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new EngineError("INVALID_BODY", "Use application/json.", 415);
  const reader = request.body?.getReader();
  if (!reader)
    throw new EngineError("INVALID_BODY", "A JSON body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.bodyBytes) {
        await reader.cancel();
        throw new EngineError("SIZE_LIMIT", "Request body is too large.", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError("INVALID_BODY", "Invalid JSON body.");
  }
}

export async function api(
  request: Request,
  workspaceId: string,
  action: (actor: { userId: string; workspaceId: string }) => Promise<unknown>,
  status = 200,
) {
  return observe(request, "workspace", () =>
    workspaceResponse(request, workspaceId, action, status),
  );
}
