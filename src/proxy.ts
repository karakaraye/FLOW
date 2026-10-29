import { NextRequest, NextResponse } from "next/server";
import { csp } from "./lib/security/headers";
import { production } from "./lib/security/runtime";
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(
      crypto.getRandomValues(new Uint8Array(24)),
    ).toString("base64"),
    id = crypto.randomUUID(),
    policy = csp(nonce, process.env.NODE_ENV === "development", production());
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", id);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Request-Id", id);
  if (production())
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  if (!request.nextUrl.pathname.startsWith("/api/health/live"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
