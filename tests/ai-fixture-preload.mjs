// Explicit isolated-test preload. Never imported or selected by application code.
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
export function installAIFixture(port, ca) {
  const request = https.request,
    lookup = dns.lookup;
  dns.lookup = async (host, ...args) =>
    host === "api.openai.com"
      ? [{ address: "93.184.216.34", family: 4 }]
      : lookup(host, ...args);
  https.request = function (options, cb) {
    if (options.hostname !== "api.openai.com")
      return request.call(https, options, cb);
    if (
      options.rejectUnauthorized !== true ||
      options.servername !== "api.openai.com"
    )
      throw Error("AI TLS verification missing");
    const pinned = options.lookup;
    return request.call(
      https,
      {
        ...options,
        port: Number(port),
        ca: readFileSync(ca),
        lookup: (host, opts, done) =>
          pinned(host, opts, (error, ip, family) => {
            if (error || ip !== "93.184.216.34" || family !== 4)
              throw Error("AI destination was not pinned");
            done(null, "127.0.0.1", 4);
          }),
      },
      cb,
    );
  };
  syncBuiltinESMExports();
  return () => {
    https.request = request;
    dns.lookup = lookup;
    syncBuiltinESMExports();
  };
}
if (process.env.FLOW_AI_FIXTURE_PORT && process.env.FLOW_AI_FIXTURE_CA)
  installAIFixture(
    process.env.FLOW_AI_FIXTURE_PORT,
    process.env.FLOW_AI_FIXTURE_CA,
  );
