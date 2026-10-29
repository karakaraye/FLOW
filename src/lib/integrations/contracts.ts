import { EngineError, isObject } from "../engine/definition";
export const providerIds = [
  "gmail",
  "google-sheets",
  "whatsapp-business",
  "http-api",
  "https-bearer",
  "openai",
  "local-test",
] as const;
export type ProviderId = (typeof providerIds)[number];
export type Binding = {
  workspaceId: string;
  integrationId: string;
  providerId: string;
};
export type CredentialSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  account?: { sub: string; email: string };
};
export type AuthenticationState = {
  state: string;
  verifier: string;
  challenge: string;
  callbackUri: string;
};
export type AdapterErrorCode =
  | "AUTHENTICATION_FAILED"
  | "TOKEN_EXPIRED"
  | "PROVIDER_OPERATION_FAILED"
  | "CREDENTIAL_CONFIGURATION_UNAVAILABLE"
  | "CREDENTIAL_UNAVAILABLE"
  | "AUTH_ATTEMPT_EXPIRED"
  | "AUTH_BINDING_INVALID";
export class IntegrationFailure extends Error {
  constructor(public code: AdapterErrorCode) {
    super("Integration operation failed.");
  }
}
export const failureCodes = [
  "AUTHENTICATION_FAILED",
  "TOKEN_EXPIRED",
  "PROVIDER_OPERATION_FAILED",
  "CREDENTIAL_CONFIGURATION_UNAVAILABLE",
  "CREDENTIAL_UNAVAILABLE",
  "AUTH_ATTEMPT_EXPIRED",
  "AUTH_BINDING_INVALID",
] as const;
export function normalizeFailure(cause: unknown): {
  code: AdapterErrorCode;
  message: string;
  httpStatus: number;
} {
  const code =
    cause instanceof IntegrationFailure && failureCodes.includes(cause.code)
      ? cause.code
      : "PROVIDER_OPERATION_FAILED";
  return {
    code,
    message:
      code === "CREDENTIAL_CONFIGURATION_UNAVAILABLE"
        ? "Server credential configuration is unavailable. Contact the operator."
        : code === "TOKEN_EXPIRED"
          ? "The connection credential has expired. Refresh or reauthorize it."
          : code === "AUTH_ATTEMPT_EXPIRED"
            ? "The authentication attempt expired. Start again."
            : "The integration operation could not be verified. Reauthorize or contact the operator.",
    httpStatus: code === "CREDENTIAL_CONFIGURATION_UNAVAILABLE" ? 503 : 422,
  };
}
export interface ProviderAdapter {
  id: ProviderId;
  initiate(
    binding: Binding,
    userId: string,
    callbackUri: string,
  ): Promise<AuthenticationState>;
  validateCallback(
    binding: Binding,
    userId: string,
    state: AuthenticationState,
    proof: unknown,
  ): Promise<CredentialSet>;
  refresh(binding: Binding, credentials: CredentialSet): Promise<CredentialSet>;
  health(binding: Binding, credentials: CredentialSet): Promise<void>;
  revoke(binding: Binding): Promise<{ scope: "LOCAL_TEST" }>;
  capabilities(): readonly string[];
  normalizeError(cause: unknown): ReturnType<typeof normalizeFailure>;
}
export function checkRevision(body: unknown): number {
  if (
    !isObject(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 1 ||
    Object.keys(body).some((k) => k !== "revision")
  )
    throw new EngineError("INVALID_BODY", "Supply only the current revision.");
  return body.revision as number;
}
export function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    throw new EngineError(
      "INVALID_LABEL",
      "Use a display label of 1–80 characters.",
    );
  return value.trim();
}

// A store is bound by the core service to an already authorized, locked
// connection. Adapters cannot select another tenant or retrieve raw records.
export interface CredentialPersistence {
  persistVerified(
    credentials: CredentialSet,
    refreshed?: boolean,
  ): Promise<void>;
  erase(): Promise<void>;
  rotateToActiveKey(): Promise<void>;
}
