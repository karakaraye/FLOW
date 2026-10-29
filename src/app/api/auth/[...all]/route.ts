import { isIP } from "node:net";
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { observe } from "@/lib/operations/observe";
import { production } from "@/lib/security/runtime";
import { body } from "@/lib/engine/http";
import { EngineError } from "@/lib/engine/definition";
const handlers = toNextJsHandler(auth);
export async function GET(request: Request) {
  return observe(request, "auth", () => handlers.GET(request));
}
export async function POST(request: Request) {
  return observe(request, "auth", async () => {
    try {
      if (
        production() &&
        !isIP(request.headers.get("x-flowpilot-client-ip") ?? "")
      )
        return Response.json(
          { code: "TRUSTED_PROXY_REQUIRED" },
          { status: 503 },
        );
      if (
        request.headers.get("origin") !==
          new URL(process.env.BETTER_AUTH_URL!).origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        return Response.json(
          { code: "INVALID_ORIGIN", message: "Untrusted request origin." },
          { status: 403 },
        );
      if (
        production() &&
        new URL(request.url).pathname
          .replace(/\/+$/, "")
          .endsWith("/sign-up/email")
      )
        return Response.json(
          {
            code: "SIGNUP_UNAVAILABLE",
            message: "Public registration is not available.",
          },
          { status: 403 },
        );
      let value: unknown;
      if (
        !request.headers.has("content-type") &&
        new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-out")
      ) {
        // Next may expose an empty stream even for a bodyless POST.
        const reader = request.body?.getReader();
        if (reader) {
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              if (chunk.value.byteLength) {
                await reader.cancel();
                return Response.json(
                  { code: "JSON_REQUIRED" },
                  { status: 415 },
                );
              }
            }
          } finally {
            reader.releaseLock();
          }
        }
        value = {};
      } else value = request.body ? await body(request) : {};
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > 8192)
        return Response.json(
          {
            code: "SIZE_LIMIT",
            message: "Authentication body exceeds its limit.",
          },
          { status: 413 },
        );
      if (
        value &&
        typeof value === "object" &&
        "name" in value &&
        typeof value.name === "string" &&
        value.name.length > 80
      )
        return Response.json(
          {
            code: "INVALID_NAME",
            message: "Use a name of at most 80 characters.",
          },
          { status: 400 },
        );
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.set("content-type", "application/json");
      return handlers.POST(
        new Request(request.url, {
          method: "POST",
          headers,
          body: text,
        }),
      );
    } catch (e) {
      return Response.json(
        {
          code: e instanceof EngineError ? e.code : "AUTH_UNAVAILABLE",
          message: "Authentication request could not be completed.",
        },
        { status: e instanceof EngineError ? e.status : 503 },
      );
    }
  });
}
