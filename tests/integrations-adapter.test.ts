import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import {
  localTestAdapter,
  issueLocalTestProof,
} from "../src/lib/integrations/test-adapter";
import { testAdapterEnabled } from "../src/lib/integrations/providers";
import { IntegrationFailure } from "../src/lib/integrations/contracts";
const binding = {
  workspaceId: "adapter-workspace",
  integrationId: "adapter-connection",
  providerId: "local-test",
};
test("local-only provider adapter verifies signed test authentication", async (t) => {
  const original = {
    flag: process.env.INTEGRATION_TEST_ADAPTER_ENABLED,
    url: process.env.BETTER_AUTH_URL,
    issuer: process.env.INTEGRATION_TEST_ISSUER_KEY,
  };
  const key = Buffer.alloc(32, 9);
  process.env.INTEGRATION_TEST_ADAPTER_ENABLED = "true";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.INTEGRATION_TEST_ISSUER_KEY = key.toString("base64");
  try {
    const state = await localTestAdapter.initiate(
      binding,
      "actor",
      "http://localhost:3000/integrations/local-test/callback",
    );
    const proof = await issueLocalTestProof(binding, "actor", state);
    const secret = await localTestAdapter.validateCallback(
      binding,
      "actor",
      state,
      proof,
    );
    await t.test(
      "valid callback, health and refresh use real signature verification",
      async () => {
        await localTestAdapter.health(binding, secret);
        const refreshed = await localTestAdapter.refresh(binding, secret);
        assert.notEqual(refreshed.accessToken, secret.accessToken);
        assert.notEqual(refreshed.refreshToken, secret.refreshToken);
        await localTestAdapter.health(binding, refreshed);
        assert.deepEqual(localTestAdapter.capabilities(), ["test:health"]);
      },
    );
    await t.test(
      "callback state, actor, workspace, verifier and token kind are enforced",
      async () => {
        await assert.rejects(
          localTestAdapter.validateCallback(
            binding,
            "other-actor",
            state,
            proof,
          ),
        );
        await assert.rejects(
          localTestAdapter.validateCallback(
            binding,
            "actor",
            { ...state, state: "forged" },
            proof,
          ),
        );
        await assert.rejects(
          localTestAdapter.validateCallback(
            binding,
            "actor",
            { ...state, verifier: "forged" },
            proof,
          ),
        );
        await assert.rejects(
          localTestAdapter.validateCallback(
            { ...binding, workspaceId: "other" },
            "actor",
            state,
            proof,
          ),
        );
        await assert.rejects(
          localTestAdapter.health(binding, {
            ...secret,
            accessToken: secret.refreshToken,
          }),
        );
        await assert.rejects(
          localTestAdapter.health(binding, {
            ...secret,
            accessToken: "provider-error-contains-unit-secret",
          }),
        );
      },
    );
    await t.test(
      "expired signed credentials and wrong issuer are rejected",
      async () => {
        const expired = await new SignJWT({
          ...binding,
          kind: "access",
          scopes: ["test:health"],
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer("flowpilot-local-test-issuer")
          .setAudience("flowpilot-local-test-provider")
          .setSubject(binding.integrationId)
          .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
          .sign(key);
        await assert.rejects(
          localTestAdapter.health(binding, { ...secret, accessToken: expired }),
          (error) =>
            error instanceof IntegrationFailure &&
            error.code === "TOKEN_EXPIRED",
        );
        const wrong = await new SignJWT({ ...binding, kind: "access" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer("wrong-issuer")
          .setAudience("flowpilot-local-test-provider")
          .setExpirationTime("5m")
          .sign(key);
        await assert.rejects(
          localTestAdapter.health(binding, { ...secret, accessToken: wrong }),
        );
      },
    );
    await t.test(
      "test adapter is disabled by default and on non-loopback origins",
      async () => {
        process.env.INTEGRATION_TEST_ADAPTER_ENABLED = "false";
        assert.equal(testAdapterEnabled(), false);
        await assert.rejects(localTestAdapter.health(binding, secret));
        process.env.INTEGRATION_TEST_ADAPTER_ENABLED = "true";
        process.env.BETTER_AUTH_URL = "https://production.example.test";
        assert.equal(testAdapterEnabled(), false);
        await assert.rejects(localTestAdapter.health(binding, secret));
      },
    );
  } finally {
    for (const [name, value] of Object.entries({
      INTEGRATION_TEST_ADAPTER_ENABLED: original.flag,
      BETTER_AUTH_URL: original.url,
      INTEGRATION_TEST_ISSUER_KEY: original.issuer,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
