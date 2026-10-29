import {
  OAuth2Client,
  CodeChallengeMethod,
  type Credentials,
} from "google-auth-library";
import { EngineError } from "../engine/definition";
import { requestJson } from "../http-actions/network";
import { allowedOrigin } from "../http-actions/credentials";
import { validateCallbackUri } from "../integrations/oauth-state";
import { googleScopes, type GoogleProvider, emailAddress } from "./config";
import type {
  CredentialSet,
  AuthenticationState,
} from "../integrations/contracts";
export const trustedGoogleOrigins = [
  "https://oauth2.googleapis.com",
  "https://www.googleapis.com",
  "https://sheets.googleapis.com",
  "https://gmail.googleapis.com",
] as const;
export function googleSettings() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  try {
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    const expected = new URL("/api/integrations/google/callback", origin).href;
    if (!id || !secret || id.length > 512 || secret.length > 1024 || !redirect)
      throw Error();
    validateCallbackUri(redirect, expected);
    return { id, secret, redirect };
  } catch {
    throw new EngineError(
      "GOOGLE_NOT_CONFIGURED",
      "Google OAuth is not configured by the operator.",
      503,
    );
  }
}
export function googleConfigured() {
  try {
    googleSettings();
    return true;
  } catch {
    return false;
  }
}
export async function googleRequest(
  url: URL,
  options: Parameters<typeof requestJson>[1],
) {
  if (!(trustedGoogleOrigins as readonly string[]).includes(url.origin))
    throw new EngineError(
      "GOOGLE_ENDPOINT_DENIED",
      "Untrusted provider endpoint.",
    );
  allowedOrigin(url);
  return requestJson(url, options);
}
class PinnedGoogleClient extends OAuth2Client {
  refreshVerified(token: string) {
    return this.refreshToken(token);
  }
}
export function googleClient() {
  const config = googleSettings();
  const client = new PinnedGoogleClient({
    clientId: config.id,
    clientSecret: config.secret,
    redirectUri: config.redirect,
  });
  // Keep the maintained library's PKCE exchange, token handling and ID-token verification,
  // while forcing its transport through the existing pinned TLS policy without hidden retries.
  client.transporter.request = (async (
    options: Parameters<typeof client.transporter.request>[0],
  ) => {
    if (!options)
      throw new EngineError(
        "GOOGLE_ENDPOINT_DENIED",
        "OAuth request is missing.",
      );
    const url = new URL(String(options.url));
    const method = String(options.method ?? "GET").toUpperCase();
    if (!(
      (url.href === "https://oauth2.googleapis.com/token" &&
        method === "POST") ||
      (url.href === "https://www.googleapis.com/oauth2/v1/certs" &&
        method === "GET") ||
      (url.href === "https://www.googleapis.com/oauth2/v3/certs" &&
        method === "GET")
    ))
      throw new EngineError(
        "GOOGLE_ENDPOINT_DENIED",
        "Untrusted OAuth endpoint.",
      );
    const headers = Object.fromEntries(
      new Headers(options.headers as HeadersInit).entries(),
    );
    const result = await googleRequest(url, {
      method,
      headers,
      timeoutMs: 8000,
      ...(options.data instanceof URLSearchParams
        ? { form: options.data }
        : {}),
    });
    if (result.status !== 200)
      throw new EngineError(
        result.status === 400 || result.status === 401
          ? "GOOGLE_REAUTHORIZE"
          : "GOOGLE_AUTH_UNAVAILABLE",
        "Google authorization could not be verified.",
        422,
      );
    const response = new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
    return Object.assign(response, { config: options, data: result.data });
  }) as typeof client.transporter.request;
  return client;
}
export function authorizationUrl(
  provider: GoogleProvider,
  state: AuthenticationState,
  nonce: string,
) {
  return googleClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [...googleScopes[provider]],
    state: state.state,
    code_challenge: state.challenge,
    code_challenge_method: CodeChallengeMethod.S256,
    nonce,
  });
}
export function normalizeScopes(values: string[]) {
  return [
    ...new Set(
      values.map((v) =>
        v === "https://www.googleapis.com/auth/userinfo.email" ? "email" : v,
      ),
    ),
  ].sort();
}
export function validateScopes(
  provider: GoogleProvider,
  scope: string | string[] | undefined,
) {
  const granted = normalizeScopes(
    typeof scope === "string"
      ? scope.split(" ").filter(Boolean)
      : (scope ?? []),
  );
  const expected = normalizeScopes([...googleScopes[provider]]);
  if (JSON.stringify(granted) !== JSON.stringify(expected))
    throw new EngineError(
      "GOOGLE_SCOPE_MISMATCH",
      "Grant only the requested permissions. Reconnect this provider separately.",
      422,
    );
  return granted;
}
export async function exchangeGoogle(
  provider: GoogleProvider,
  code: string,
  state: AuthenticationState,
  nonce: string,
): Promise<CredentialSet> {
  const client = googleClient();
  const { tokens } = await client.getToken({
    code,
    codeVerifier: state.verifier,
    redirect_uri: state.callbackUri,
  });
  if (!tokens.id_token)
    throw new EngineError(
      "GOOGLE_IDENTITY_INVALID",
      "Google identity could not be verified.",
      422,
    );
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: googleSettings().id,
  });
  const identity = ticket.getPayload();
  if (
    !identity ||
    identity.email_verified !== true ||
    !emailAddress(identity.email) ||
    !identity.sub ||
    identity.sub.length > 255 ||
    (identity as unknown as { nonce?: string }).nonce !== nonce
  )
    throw new EngineError(
      "GOOGLE_IDENTITY_INVALID",
      "Google identity could not be verified.",
      422,
    );
  return tokenSet(provider, tokens, {
    sub: identity.sub,
    email: identity.email,
  });
}
function tokenSet(
  provider: GoogleProvider,
  tokens: Credentials,
  account: NonNullable<CredentialSet["account"]>,
  old?: CredentialSet,
): CredentialSet {
  if (
    typeof tokens.access_token !== "string" ||
    !tokens.access_token ||
    !/^[\x21-\x7e]+$/.test(tokens.access_token) ||
    tokens.access_token.length > 4096 ||
    /[\r\n]/.test(tokens.access_token) ||
    typeof (tokens.refresh_token ?? old?.refreshToken) !== "string" ||
    !(tokens.refresh_token ?? old?.refreshToken) ||
    !tokens.expiry_date ||
    tokens.expiry_date <= Date.now() ||
    tokens.expiry_date > Date.now() + 86400000
  )
    throw new EngineError(
      "GOOGLE_REAUTHORIZE",
      "Offline authorization is missing or expired. Reconnect with consent.",
      422,
    );
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? old!.refreshToken,
    expiresAt: new Date(tokens.expiry_date).toISOString(),
    scopes: validateScopes(provider, tokens.scope ?? old?.scopes),
    account,
  };
}
export async function refreshGoogle(
  provider: GoogleProvider,
  old: CredentialSet,
) {
  if (!old.account)
    throw new EngineError(
      "GOOGLE_REAUTHORIZE",
      "Reconnect to verify account identity.",
      422,
    );
  const client = googleClient();
  // Capture the original response because Google may rotate a refresh token; some
  // convenience methods replace it with the old value when updating client state.
  const { tokens } = await client.refreshVerified(old.refreshToken);
  return tokenSet(provider, tokens, old.account, old);
}
export async function revokeGoogle(token: string) {
  const url = new URL("https://oauth2.googleapis.com/revoke");
  const result = await googleRequest(url, {
    method: "POST",
    headers: {},
    form: new URLSearchParams({ token }),
    timeoutMs: 8000,
  });
  if (
    result.status !== 200 &&
    !(
      result.status === 400 &&
      result.data &&
      typeof result.data === "object" &&
      !Array.isArray(result.data) &&
      result.data.error === "invalid_token"
    )
  )
    throw new EngineError(
      "GOOGLE_REVOKE_FAILED",
      "Local access is removed. Remote revocation could not be confirmed.",
      422,
    );
}
export function googleError(error: unknown) {
  const permitted = [
    "GOOGLE_REAUTHORIZE",
    "GOOGLE_SCOPE_MISMATCH",
    "GOOGLE_AUTH_UNAVAILABLE",
    "GOOGLE_NOT_CONFIGURED",
    "GOOGLE_IDENTITY_INVALID",
    "GOOGLE_REVOKE_FAILED",
    "DESTINATION_NOT_APPROVED",
    "DESTINATION_DENIED",
    "GOOGLE_MAPPING_MISSING",
    "GOOGLE_MESSAGE_LIMIT",
    "GOOGLE_SEND_DISABLED",
    "GOOGLE_RECIPIENT_DENIED",
    "GOOGLE_RATE_LIMIT",
    "GOOGLE_PERMISSION_DENIED",
    "GOOGLE_NOT_FOUND",
    "GOOGLE_QUOTA_LIMIT",
    "GOOGLE_INVALID_REQUEST",
    "GOOGLE_OUTCOME_UNKNOWN",
    "GOOGLE_RESPONSE_INVALID",
  ];
  return error instanceof EngineError && permitted.includes(error.code)
    ? error
    : new EngineError(
        "GOOGLE_OPERATION_FAILED",
        "The Google operation failed. Reconnect or contact the operator.",
        422,
      );
}
