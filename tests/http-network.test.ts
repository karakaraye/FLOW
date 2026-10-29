import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pinDestination,
  publicAddress,
  requestJson,
  type Transport,
} from "../src/lib/http-actions/network";
import { httpConfig } from "../src/lib/http-actions/config";
import { validateDefinition } from "../src/lib/engine/definition";
const target = new URL("https://action.fixture.net/ok");
test("SSRF range classification rejects IPv4/IPv6 special ranges", () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "240.1.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "ff00::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "3fff::1",
    "4000::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("93.184.216.34"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
});
test("SSRF rejects literal, alternate-address, userinfo, mixed DNS and metadata bypasses", async () => {
  for (const raw of [
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://0177.0.0.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://localhost",
    "https://metadata.google.internal",
    "http://public.net",
    "https://name:secret@public.net",
    "https://public.net:8080",
  ])
    await assert.rejects(
      pinDestination(new URL(raw), async () => [
        { address: "127.0.0.1", family: 4 },
      ]),
    );
  await assert.rejects(
    pinDestination(target, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
});
test("HTTP configuration rejects injected headers, credentials, queries, unsafe methods and excess retries", () => {
  const base = {
    method: "POST",
    url: target.href,
    headers: {},
    timeoutMs: 500,
    maxAttempts: 1,
  };
  httpConfig(base);
  for (const c of [
    { headers: { Authorization: "secret" } },
    { headers: { Accept: "x\r\nHost: localhost" } },
    { url: "https://public.net/?token=secret" },
    { method: "DELETE" },
    { timeoutMs: 10001 },
    { maxAttempts: 4 },
    { responsePath: "__proto__.x" },
  ])
    assert.throws(() =>
      httpConfig(JSON.parse(JSON.stringify({ ...base, ...c }))),
    );
  validateDefinition({
    schemaVersion: 1,
    nodes: [
      { id: "hook", type: "webhook_trigger", config: {} },
      { id: "http", type: "http_request", config: base },
    ],
    edges: [{ from: "hook", to: "http" }],
  });
});
test("native HTTPS transport uses pinned lookup once, validates TLS, refuses redirects, bounds response and time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-http-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=action.fixture.net",
      "-addext",
      "subjectAltName=DNS:action.fixture.net",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(dir, "cert.pem"));
  let seen = 0;
  const server = https.createServer(
    { key: readFileSync(join(dir, "key.pem")), cert },
    (req, res) => {
      seen++;
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "https://127.0.0.1/" });
        res.end("{}");
      } else if (req.url === "/large")
        res.end(JSON.stringify("x".repeat(40000)));
      else if (req.url === "/slow") setTimeout(() => res.end("{}"), 300);
      else if (req.url === "/error") {
        res.writeHead(503);
        res.end('{"error":"busy"}');
      } else {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () =>
          res.end(
            JSON.stringify({
              method: req.method,
              body: chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString())
                : null,
              auth: req.headers.authorization ?? null,
            }),
          ),
        );
      }
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let dnsCalls = 0,
    pinnedCalls = 0;
  // Test-only transport seam reroutes the validated public address to an isolated TLS fixture.
  // No environment flag or production path can select this seam.
  const transport = ((
    options: https.RequestOptions,
    callback: Parameters<typeof https.request>[1],
  ) => {
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.servername, "action.fixture.net");
    const original = options.lookup!;
    return https.request(
      {
        ...options,
        port: address.port,
        ca: cert,
        lookup: (host, opts, cb) => {
          pinnedCalls++;
          original(host, opts, ((
            error: Error | null,
            ip: string,
            family: number,
          ) => {
            assert.equal(error, null);
            assert.equal(ip, "93.184.216.34");
            assert.equal(family, 4);
            cb(null, "127.0.0.1", 4);
          }) as never);
        },
      },
      callback as never,
    );
  }) as Transport;
  const dependencies = {
    resolver: async () => {
      dnsCalls++;
      return [
        { address: dnsCalls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
      ];
    },
    transport,
  };
  try {
    const r = await requestJson(
      target,
      { method: "GET", headers: {}, timeoutMs: 1000 },
      dependencies,
    );
    assert.equal(r.status, 200);
    assert.equal(dnsCalls, 1);
    assert.equal(pinnedCalls, 1);
    assert.equal((r.data as { method: string }).method, "GET");
    await assert.rejects(
      requestJson(
        target,
        { method: "GET", headers: {}, timeoutMs: 1000 },
        dependencies,
      ),
    );
    assert.equal(seen, 1, "rebinding never reached socket");
    const stable = {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      transport,
    };
    const post = await requestJson(
      target,
      {
        method: "POST",
        headers: { Authorization: "Bearer fixture-only" },
        body: { hello: "world" },
        timeoutMs: 1000,
      },
      stable,
    );
    assert.deepEqual(post.data, {
      method: "POST",
      body: { hello: "world" },
      auth: "Bearer fixture-only",
    });
    const error = await requestJson(
      new URL("/error", target),
      { method: "GET", headers: {}, timeoutMs: 1000 },
      stable,
    );
    assert.equal(error.status, 503);
    await assert.rejects(
      requestJson(
        new URL("/redirect", target),
        { method: "GET", headers: {}, timeoutMs: 1000 },
        stable,
      ),
      { code: "HTTP_REDIRECT_DENIED" },
    );
    await assert.rejects(
      requestJson(
        new URL("/large", target),
        { method: "GET", headers: {}, timeoutMs: 1000 },
        stable,
      ),
      { code: "HTTP_RESPONSE_LIMIT" },
    );
    await assert.rejects(
      requestJson(
        new URL("/slow", target),
        { method: "POST", headers: {}, timeoutMs: 50 },
        stable,
      ),
      { code: "HTTP_NETWORK_AMBIGUOUS" },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
