// Explicit isolated-test preload. Never imported by application/worker source.
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
export function installFixture(port, caPath) {
  const originalRequest = https.request,
    originalLookup = dns.lookup;
  dns.lookup = async (host, ...args) =>
    host === "action.fixture.net"
      ? [{ address: "93.184.216.34", family: 4 }]
      : originalLookup(host, ...args);
  https.request = function (options, cb) {
    if (options.hostname !== "action.fixture.net")
      return originalRequest.call(https, options, cb);
    if (
      options.rejectUnauthorized !== true ||
      options.servername !== "action.fixture.net"
    )
      throw Error("Fixture requires verified TLS");
    const pinned = options.lookup;
    return originalRequest.call(
      https,
      {
        ...options,
        port: Number(port),
        ca: readFileSync(caPath),
        lookup: (host, opts, done) =>
          pinned(host, opts, (err, address, family) => {
            if (err || address !== "93.184.216.34" || family !== 4)
              throw Error("Expected public pinned lookup");
            done(null, "127.0.0.1", 4);
          }),
      },
      cb,
    );
  };
  syncBuiltinESMExports();
  return () => {
    https.request = originalRequest;
    dns.lookup = originalLookup;
    syncBuiltinESMExports();
  };
}
if (process.env.FLOW_TEST_TLS_PORT && process.env.FLOW_TEST_TLS_CA)
  installFixture(process.env.FLOW_TEST_TLS_PORT, process.env.FLOW_TEST_TLS_CA);
