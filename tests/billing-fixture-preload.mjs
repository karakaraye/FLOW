// Isolated test process only. No application runtime imports this module.
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
export function installBillingFixture(port, ca) {
  const request = https.request,
    lookup = dns.lookup;
  dns.lookup = async (host, ...args) =>
    host === "api.paystack.co"
      ? [{ address: "93.184.216.34", family: 4 }]
      : lookup(host, ...args);
  https.request = function (options, cb) {
    if (options.hostname !== "api.paystack.co")
      return request.call(https, options, cb);
    if (
      options.rejectUnauthorized !== true ||
      options.servername !== "api.paystack.co"
    )
      throw Error("Paystack TLS verification missing");
    const pinned = options.lookup;
    return request.call(
      https,
      {
        ...options,
        port: Number(port),
        ca: readFileSync(ca),
        lookup: (host, opts, done) =>
          pinned(host, opts, (e, ip, family) => {
            if (e || ip !== "93.184.216.34" || family !== 4)
              throw Error("Paystack destination not pinned");
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
if (
  process.env.FLOW_BILLING_FIXTURE_PORT &&
  process.env.FLOW_BILLING_FIXTURE_CA
)
  installBillingFixture(
    process.env.FLOW_BILLING_FIXTURE_PORT,
    process.env.FLOW_BILLING_FIXTURE_CA,
  );
