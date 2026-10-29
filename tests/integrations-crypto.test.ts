import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encryptSecret,
  decryptSecret,
  loadKeys,
} from "../src/lib/integrations/crypto";
import {
  IntegrationFailure,
  normalizeFailure,
} from "../src/lib/integrations/contracts";
import {
  createPkceState,
  matchesState,
  stateHash,
  validateCallbackUri,
} from "../src/lib/integrations/oauth-state";
const context = {
  workspaceId: "unit-workspace",
  integrationId: "unit-connection",
  providerId: "local-test",
  recordId: "unit-credential",
  purpose: "credential" as const,
};
const oldKey = Buffer.alloc(32, 1).toString("base64"),
  newKey = Buffer.alloc(32, 2).toString("base64");
test("integration authenticated encryption and secure state", async (t) => {
  const original = {
    keys: process.env.INTEGRATION_ENCRYPTION_KEYS,
    active: process.env.INTEGRATION_ACTIVE_KEY_ID,
  };
  try {
    process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({ old: oldKey });
    process.env.INTEGRATION_ACTIVE_KEY_ID = "old";
    await t.test(
      "AES-GCM roundtrip is non-deterministic and contains no plaintext",
      () => {
        const value = {
          accessToken: "unit-access-token-not-real",
          refreshToken: "unit-refresh-not-real",
        };
        const a = encryptSecret(value, context),
          b = encryptSecret(value, context);
        assert.notEqual(a.ciphertext, b.ciphertext);
        assert.ok(!a.ciphertext.includes(value.accessToken));
        assert.deepEqual(decryptSecret(a.ciphertext, context), value);
        assert.equal(a.keyId, "old");
      },
    );
    await t.test(
      "ciphertext, tag, key ID and tenant/provider/record/purpose substitution fail closed",
      () => {
        const encrypted = encryptSecret({ token: "unit-secret" }, context);
        for (const modified of [
          { ...context, workspaceId: "other" },
          { ...context, integrationId: "other" },
          { ...context, providerId: "gmail" },
          { ...context, recordId: "other" },
          { ...context, purpose: "authentication-state" as const },
        ])
          assert.throws(() => decryptSecret(encrypted.ciphertext, modified));
        const envelope = JSON.parse(encrypted.ciphertext);
        for (const broken of [
          { ...envelope, tag: Buffer.alloc(16).toString("base64url") },
          { ...envelope, data: Buffer.from("tampered").toString("base64url") },
          { ...envelope, keyId: "missing" },
          { ...envelope, v: 2 },
          { ...envelope, iv: "bad" },
          { ...envelope, extra: "untrusted" },
        ])
          assert.throws(() => decryptSecret(JSON.stringify(broken), context));
        assert.throws(() =>
          decryptSecret(
            encrypted.ciphertext,
            context,
            loadKeys(),
            "mismatched-row-key-id",
          ),
        );
      },
    );
    await t.test(
      "rotation supports retained old keys and rejects retired-key ciphertext",
      () => {
        const old = encryptSecret({ token: "rotation-vector" }, context);
        process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
          old: oldKey,
          new: newKey,
        });
        process.env.INTEGRATION_ACTIVE_KEY_ID = "new";
        const value = decryptSecret(old.ciphertext, context);
        const rotated = encryptSecret(value, context);
        assert.equal(rotated.keyId, "new");
        process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
          new: newKey,
        });
        assert.deepEqual(decryptSecret(rotated.ciphertext, context), {
          token: "rotation-vector",
        });
        assert.throws(() => decryptSecret(old.ciphertext, context));
      },
    );
    await t.test(
      "missing, malformed, wrong-length and inconsistent keys never fall back",
      () => {
        for (const [keys, active] of [
          ["", "old"],
          ["not-json-secret", "old"],
          ["[]", "old"],
          [JSON.stringify({ old: "not-a-real-key" }), "old"],
          [JSON.stringify({ old: Buffer.alloc(16).toString("base64") }), "old"],
          [JSON.stringify({ old: oldKey }), "unknown"],
          [JSON.stringify({}), "old"],
        ]) {
          process.env.INTEGRATION_ENCRYPTION_KEYS = keys;
          process.env.INTEGRATION_ACTIVE_KEY_ID = active;
          assert.throws(
            () => loadKeys(),
            (error) =>
              error instanceof IntegrationFailure &&
              error.code === "CREDENTIAL_CONFIGURATION_UNAVAILABLE" &&
              (!keys || !error.message.includes(keys)),
          );
        }
      },
    );
    await t.test(
      "error normalization cannot echo provider messages or forged sensitive codes",
      () => {
        const secret = "unit-error-secret-value";
        for (const cause of [
          new Error(secret),
          new IntegrationFailure(secret as never),
          { accessToken: secret, message: secret },
        ])
          assert.ok(!JSON.stringify(normalizeFailure(cause)).includes(secret));
        assert.equal(
          normalizeFailure(new IntegrationFailure("TOKEN_EXPIRED")).code,
          "TOKEN_EXPIRED",
        );
      },
    );
    await t.test(
      "secure state and PKCE values are unique, hashed and bound to exact callback URIs",
      () => {
        const uri = "https://app.example.test/integrations/callback";
        const a = createPkceState(uri),
          b = createPkceState(uri);
        assert.notEqual(a.state, b.state);
        assert.notEqual(a.verifier, b.verifier);
        assert.ok(a.state.length >= 43 && a.verifier.length >= 43);
        assert.ok(matchesState(a.state, stateHash(a.state)));
        assert.ok(!matchesState(b.state, stateHash(a.state)));
        validateCallbackUri(uri, uri);
        for (const bad of [
          "https://evil.example.test/integrations/callback",
          `${uri}?next=evil`,
          `${uri}#fragment`,
          "http://app.example.test/integrations/callback",
          "https://user:pass@app.example.test/integrations/callback",
        ])
          assert.throws(() => validateCallbackUri(bad, uri));
      },
    );
  } finally {
    if (original.keys === undefined)
      delete process.env.INTEGRATION_ENCRYPTION_KEYS;
    else process.env.INTEGRATION_ENCRYPTION_KEYS = original.keys;
    if (original.active === undefined)
      delete process.env.INTEGRATION_ACTIVE_KEY_ID;
    else process.env.INTEGRATION_ACTIVE_KEY_ID = original.active;
  }
});
