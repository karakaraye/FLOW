import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { parse } from "dotenv";
const path = new URL("../.env", import.meta.url);
const contents = readFileSync(path, "utf8");
const current = { ...parse(contents), ...process.env };
const updates = {};
const hasRing = Boolean(current.INTEGRATION_ENCRYPTION_KEYS),
  hasActive = Boolean(current.INTEGRATION_ACTIVE_KEY_ID);
if (hasRing !== hasActive)
  throw new Error(
    "Existing integration key configuration is incomplete. Configure both fields securely; no keys were overwritten.",
  );
if (!hasRing) {
  updates.INTEGRATION_ACTIVE_KEY_ID = "local-v1";
  updates.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
    "local-v1": randomBytes(32).toString("base64"),
  });
}
const enable = process.argv.includes("--enable-test-adapter"),
  disable = process.argv.includes("--disable-test-adapter");
if (enable && disable) throw new Error("Choose only one test-adapter setting.");
if (enable) {
  const origin = new URL(current.BETTER_AUTH_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    throw new Error("The test adapter requires a loopback application origin.");
  if (!current.INTEGRATION_TEST_ISSUER_KEY)
    updates.INTEGRATION_TEST_ISSUER_KEY = randomBytes(32).toString("base64");
  updates.INTEGRATION_TEST_ADAPTER_ENABLED = "true";
} else if (disable) updates.INTEGRATION_TEST_ADAPTER_ENABLED = "false";
else if (!Object.hasOwn(current, "INTEGRATION_TEST_ADAPTER_ENABLED"))
  updates.INTEGRATION_TEST_ADAPTER_ENABLED = "false";
let result = contents;
for (const [name, value] of Object.entries(updates)) {
  const line = `${name}=${value}`;
  const expression = new RegExp(`^${name}=.*$`, "m");
  result = expression.test(result)
    ? result.replace(expression, () => line)
    : `${result.trimEnd()}\n${line}\n`;
}
if (result !== contents) writeFileSync(path, result, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(
  "Local integration settings prepared; existing keys preserved. No key values printed.",
);
