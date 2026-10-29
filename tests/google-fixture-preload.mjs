// Explicit isolated-test preload only. No production module imports this file.
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
const hosts = new Set([
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "sheets.googleapis.com",
  "gmail.googleapis.com",
]);
export function installGoogleFixture(port, caPath) {
  const request = https.request,
    lookup = dns.lookup;
  dns.lookup = async (host, ...args) =>
    hosts.has(host)
      ? [{ address: "93.184.216.34", family: 4 }]
      : lookup(host, ...args);
  https.request = function (options, cb) {
    if (!hosts.has(options.hostname)) return request.call(https, options, cb);
    if (
      options.rejectUnauthorized !== true ||
      options.servername !== options.hostname
    )
      throw Error("Expected verified Google TLS");
    const pinned = options.lookup;
    return request.call(
      https,
      {
        ...options,
        port: Number(port),
        ca: readFileSync(caPath),
        lookup: (host, opts, done) =>
          pinned(host, opts, (err, ip, family) => {
            if (err || ip !== "93.184.216.34" || family !== 4)
              throw Error("Google socket was not pinned");
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
if (process.env.FLOW_GOOGLE_FIXTURE_PORT && process.env.FLOW_GOOGLE_FIXTURE_CA)
  installGoogleFixture(
    process.env.FLOW_GOOGLE_FIXTURE_PORT,
    process.env.FLOW_GOOGLE_FIXTURE_CA,
  );
