import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";
import {
  IntegrationFailure,
  normalizeFailure,
  type Binding,
  type CredentialSet,
  type ProviderAdapter,
  type AuthenticationState,
} from "./contracts";
import { createPkceState, stateHash, validateCallbackUri } from "./oauth-state";
import { testAdapterEnabled } from "./providers";
function issuerKey() {
  const value = process.env.INTEGRATION_TEST_ISSUER_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new IntegrationFailure("CREDENTIAL_CONFIGURATION_UNAVAILABLE");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new IntegrationFailure("CREDENTIAL_CONFIGURATION_UNAVAILABLE");
  return key;
}
function enabled() {
  if (!testAdapterEnabled())
    throw new IntegrationFailure("AUTHENTICATION_FAILED");
}
function callbackUri() {
  return new URL(
    "/integrations/local-test/callback",
    process.env.BETTER_AUTH_URL!,
  ).href;
}
async function sign(
  binding: Binding,
  kind: string,
  seconds: number,
  extra: Record<string, unknown> = {},
) {
  enabled();
  return new SignJWT({ ...binding, kind, ...extra })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("flowpilot-local-test-issuer")
    .setAudience("flowpilot-local-test-provider")
    .setSubject(binding.integrationId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .sign(issuerKey());
}
async function verify(token: unknown, binding: Binding, kind: string) {
  enabled();
  if (typeof token !== "string" || token.length > 4096)
    throw new IntegrationFailure("AUTHENTICATION_FAILED");
  try {
    const { payload } = await jwtVerify(token, issuerKey(), {
      algorithms: ["HS256"],
      issuer: "flowpilot-local-test-issuer",
      audience: "flowpilot-local-test-provider",
    });
    if (
      payload.kind !== kind ||
      payload.workspaceId !== binding.workspaceId ||
      payload.integrationId !== binding.integrationId ||
      payload.providerId !== binding.providerId ||
      payload.sub !== binding.integrationId
    )
      throw new Error();
    return payload;
  } catch (error) {
    if (error instanceof IntegrationFailure) throw error;
    if (error instanceof errors.JWTExpired)
      throw new IntegrationFailure("TOKEN_EXPIRED");
    throw new IntegrationFailure("AUTHENTICATION_FAILED");
  }
}
async function credentials(binding: Binding): Promise<CredentialSet> {
  return {
    accessToken: await sign(binding, "access", 300, {
      scopes: ["test:health"],
    }),
    refreshToken: await sign(binding, "refresh", 3600),
    expiresAt: new Date(
      (Math.floor(Date.now() / 1000) + 300) * 1000,
    ).toISOString(),
    scopes: ["test:health"],
  };
}
// This local issuer is deliberately test-only. No provider token, OAuth code,
// state, verifier, or proof is accepted from or returned to the browser.
export async function issueLocalTestProof(
  binding: Binding,
  userId: string,
  state: AuthenticationState,
) {
  validateCallbackUri(state.callbackUri, callbackUri());
  return sign(binding, "proof", 60, {
    userId,
    stateDigest: stateHash(state.state),
    pkce: state.challenge,
    callbackUri: state.callbackUri,
  });
}
export const localTestAdapter: ProviderAdapter = {
  id: "local-test",
  async initiate(_binding, _userId, uri) {
    enabled();
    issuerKey();
    validateCallbackUri(uri, callbackUri());
    return createPkceState(uri);
  },
  async validateCallback(binding, userId, state, proof) {
    const payload = await verify(proof, binding, "proof");
    validateCallbackUri(state.callbackUri, callbackUri());
    if (
      payload.userId !== userId ||
      payload.stateDigest !== stateHash(state.state) ||
      payload.pkce !== state.challenge ||
      payload.callbackUri !== state.callbackUri ||
      createHash("sha256").update(state.verifier).digest("base64url") !==
        state.challenge
    )
      throw new IntegrationFailure("AUTH_BINDING_INVALID");
    return credentials(binding);
  },
  async health(binding, secret) {
    const payload = await verify(secret.accessToken, binding, "access");
    if (
      !Array.isArray(payload.scopes) ||
      !payload.scopes.includes("test:health")
    )
      throw new IntegrationFailure("AUTHENTICATION_FAILED");
  },
  async refresh(binding, secret) {
    await verify(secret.refreshToken, binding, "refresh");
    return credentials(binding);
  },
  async revoke() {
    enabled();
    return { scope: "LOCAL_TEST" };
  },
  capabilities: () => ["test:health"],
  normalizeError: normalizeFailure,
};
