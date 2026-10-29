import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { EngineError, assertJson, type Json } from "../engine/definition";
export type Resolver = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
const resolve: Resolver = (host) => lookup(host, { all: true, verbatim: true });
export function publicAddress(address: string) {
  try {
    const ip = ipaddr.parse(address);
    return (
      ip.range() === "unicast" &&
      (ip.kind() === "ipv4" ||
        (ip as ipaddr.IPv6).match(ipaddr.parse("2000::") as ipaddr.IPv6, 3)) &&
      !(
        ip.kind() === "ipv6" &&
        (ip as ipaddr.IPv6).match(ipaddr.parse("3fff::") as ipaddr.IPv6, 20)
      ) &&
      !(ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
    );
  } catch {
    return false;
  }
}
function denied(): never {
  throw new EngineError(
    "DESTINATION_DENIED",
    "The destination is not an approved public HTTPS service.",
    422,
  );
}
export async function pinDestination(
  url: URL,
  resolver: Resolver = resolve,
  timeoutMs = 3000,
) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Reject all IP literals, including URL-normalized decimal/octal/hex addresses.
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    isIP(host) ||
    !host.includes(".") ||
    host.endsWith(".") ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)
  )
    denied();
  let addresses;
  try {
    addresses = await Promise.race([
      resolver(host),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error()), timeoutMs);
        t.unref();
      }),
    ]);
  } catch {
    throw new EngineError("DNS_FAILED", "Destination lookup failed.", 422);
  }
  if (
    !addresses.length ||
    addresses.some(
      (a) => !publicAddress(a.address) || isIP(a.address) !== a.family,
    )
  )
    denied();
  // Every address must be public. Resolve once; native TLS dials this exact address.
  return { host, address: addresses[0].address, family: addresses[0].family };
}
export type Transport = typeof https.request;
export async function requestJson(
  url: URL,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: Json;
    form?: URLSearchParams;
    timeoutMs: number;
    signal?: AbortSignal;
  },
  dependencies: { resolver?: Resolver; transport?: Transport } = {},
) {
  const deadline = Date.now() + options.timeoutMs;
  const pinned = await pinDestination(
    url,
    dependencies.resolver,
    Math.min(3000, options.timeoutMs),
  );
  const raw = options.form
    ? Buffer.from(options.form.toString())
    : options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body));
  if (raw && raw.length > 16384)
    throw new EngineError("HTTP_BODY_LIMIT", "Request body is too large.", 422);
  return new Promise<{ status: number; data: Json; requestId?: string }>(
    (ok, fail) => {
      let settled = false;
      const finish = (
        err?: EngineError,
        result?: { status: number; data: Json; requestId?: string },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (err) fail(err);
        else ok(result!);
      };
      const req = (dependencies.transport ?? https.request)(
        {
          protocol: "https:",
          hostname: pinned.host,
          port: 443,
          path: url.pathname + url.search,
          method: options.method,
          headers: {
            ...options.headers,
            ...(raw
              ? {
                  "Content-Length": String(raw.length),
                  "Content-Type": options.form
                    ? "application/x-www-form-urlencoded"
                    : "application/json",
                }
              : {}),
          },
          servername: pinned.host,
          family: pinned.family,
          agent: false,
          rejectUnauthorized: true,
          lookup: (_host, _opts, callback) => {
            callback(null, pinned.address, pinned.family);
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 32768) {
              finish(
                new EngineError(
                  "HTTP_RESPONSE_LIMIT",
                  "Response is too large.",
                  422,
                ),
              );
              res.destroy();
              req.destroy();
            } else chunks.push(chunk);
          });
          res.on("error", () =>
            finish(
              new EngineError(
                "HTTP_NETWORK_AMBIGUOUS",
                "Remote outcome is unknown.",
                422,
              ),
            ),
          );
          res.on("end", () => {
            if (settled) return;
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              finish(
                new EngineError(
                  "HTTP_REDIRECT_DENIED",
                  "Redirects are not followed.",
                  422,
                ),
              );
              return;
            }
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              const data = text ? JSON.parse(text) : null;
              assertJson(data, 32768);
              const rid = res.headers["x-request-id"];
              finish(undefined, {
                status,
                data,
                ...(typeof rid === "string" &&
                /^req_[A-Za-z0-9_-]{1,120}$/.test(rid)
                  ? { requestId: rid }
                  : {}),
              });
            } catch {
              finish(
                new EngineError(
                  "HTTP_INVALID_RESPONSE",
                  "Expected a bounded JSON response.",
                  422,
                ),
              );
            }
          });
        },
      );
      req.on("error", () =>
        finish(
          new EngineError(
            "HTTP_NETWORK_AMBIGUOUS",
            "Remote outcome is unknown.",
            422,
          ),
        ),
      );
      const abort = () => {
        finish(
          new EngineError(
            "HTTP_NETWORK_AMBIGUOUS",
            "Remote outcome is unknown.",
            422,
          ),
        );
        req.destroy();
      };
      const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      if (raw) req.write(raw);
      req.end();
    },
  );
}
