export function production(
  env: Record<string, string | undefined> = process.env,
) {
  return env.FLOWPILOT_ENV === "production";
}
export function loopback(host: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}
export function runtimeIssues(
  env: Record<string, string | undefined> = process.env,
) {
  const issues: string[] = [];
  if (
    !["development", "test", "production", undefined].includes(
      env.FLOWPILOT_ENV,
    )
  )
    issues.push("ENVIRONMENT_INVALID");
  if (!production(env)) return issues;
  let origin: URL | undefined;
  try {
    origin = new URL(env.BETTER_AUTH_URL || env.RENDER_EXTERNAL_URL || "");
    if (
      origin.protocol !== "https:" ||
      loopback(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      issues.push("PUBLIC_ORIGIN_INVALID");
  } catch {
    issues.push("PUBLIC_ORIGIN_INVALID");
  }
  if (
    !env.BETTER_AUTH_SECRET ||
    env.BETTER_AUTH_SECRET.length < 32 ||
    /change.?me|replace|example|development|fixture/i.test(
      env.BETTER_AUTH_SECRET,
    )
  )
    issues.push("AUTH_SECRET_INVALID");
  try {
    const u = new URL(env.DATABASE_URL ?? "");
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      (!["verify-full", "require"].includes(u.searchParams.get("sslmode") ?? "") && !u.hostname.includes("dpg-") && !u.hostname.endsWith(".render.com"))
    )
      issues.push("DATABASE_TLS_REQUIRED");
  } catch {
    issues.push("DATABASE_URL_INVALID");
  }
  if (!env.OPERATIONS_TOKEN || env.OPERATIONS_TOKEN.length < 32)
    issues.push("OPERATIONS_TOKEN_REQUIRED");
  try {
    const ring = JSON.parse(env.INTEGRATION_ENCRYPTION_KEYS ?? "{}"),
      active = env.INTEGRATION_ACTIVE_KEY_ID;
    if (
      !active ||
      !ring[active] ||
      !Object.values(ring).every(
        (v) => typeof v === "string" && /^[A-Za-z0-9+/]{43}=$/.test(v),
      )
    )
      issues.push("VAULT_KEYS_INVALID");
  } catch {
    issues.push("VAULT_KEYS_INVALID");
  }
  if (
    env.INTEGRATION_TEST_ADAPTER_ENABLED === "true" ||
    Object.keys(env).some((k) => k.includes("FIXTURE") && !!env[k]) ||
    env.PAYSTACK_TEST_LABEL === "MOCK" ||
    env.META_TEST_LABEL === "MOCK" ||
    env.FLOWPILOT_AI_TEST_LABEL === "MOCK"
  )
    issues.push("TEST_CONFIGURATION_FORBIDDEN");

  if (env.FLOWPILOT_PROVIDERS_VERIFIED === "true") {
    if (
      env.FLOWPILOT_OPENAI_API_KEY &&
      (!env.FLOWPILOT_OPENAI_API_KEY.startsWith("sk-") ||
        env.FLOWPILOT_OPENAI_API_KEY.length < 20)
    )
      issues.push("OPENAI_KEY_INVALID");
    if (
      env.META_WHATSAPP_DEVELOPER_ENABLED === "true" &&
      (!env.META_APP_ID ||
        !env.META_APP_SECRET ||
        !env.META_RECIPIENT_HASH_KEY)
    )
      issues.push("WHATSAPP_CREDENTIALS_INCOMPLETE");
    if (
      env.GOOGLE_GMAIL_SEND_ENABLED === "true" &&
      (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET)
    )
      issues.push("GOOGLE_CREDENTIALS_INCOMPLETE");
  } else {
    if (
      env.PAYSTACK_TEST_ENABLED === "true" ||
      env.META_WHATSAPP_DEVELOPER_ENABLED === "true" ||
      env.GOOGLE_GMAIL_SEND_ENABLED === "true" ||
      !!env.FLOWPILOT_OPENAI_API_KEY ||
      !!env.GOOGLE_OAUTH_CLIENT_ID ||
      !!env.GOOGLE_OAUTH_CLIENT_SECRET
    )
      issues.push("UNVERIFIED_EXTERNAL_ACTIVATION_FORBIDDEN");
  }

  if (
    env.PAYSTACK_SECRET_KEY?.startsWith("sk_live_") &&
    env.PAYSTACK_LIVE_ENABLED !== "true"
  )
    issues.push("LIVE_BILLING_FORBIDDEN");

  if (env.AUTH_REGISTRATION_ENABLED === "true") {
    const hasEmail = Boolean(
      env.RESEND_API_KEY || env.SMTP_URL || env.SMTP_HOST,
    );
    if (!hasEmail) issues.push("PUBLIC_REGISTRATION_EMAIL_REQUIRED");
  }

  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    issues.push("TLS_VERIFICATION_DISABLED");
  if (
    env.NODE_OPTIONS &&
    /fixture|--inspect|--require|--import/i.test(env.NODE_OPTIONS)
  )
    issues.push("UNSAFE_NODE_OPTIONS");
  return [...new Set(issues)];
}
export function assertRuntime() {
  const issues = runtimeIssues();
  if (issues.length)
    throw Error(`RUNTIME_CONFIGURATION_INVALID:${issues.join(",")}`);
}
export function boundedInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max)
    throw Error("RUNTIME_NUMERIC_CONFIGURATION_INVALID");
  return n;
}
