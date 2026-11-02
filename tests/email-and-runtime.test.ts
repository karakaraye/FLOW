import test from "node:test";
import assert from "node:assert/strict";
import {
  isEmailConfigured,
  sendUserVerificationEmail,
  sendUserPasswordResetEmail,
} from "../src/lib/email/dispatcher";
import {
  verificationEmailTemplate,
  resetPasswordEmailTemplate,
} from "../src/lib/email/templates";
import { runtimeIssues } from "../src/lib/security/runtime";

test("Email Dispatcher: detects configuration states correctly", () => {
  assert.equal(isEmailConfigured({}), false);
  assert.equal(isEmailConfigured({ RESEND_API_KEY: "re_12345678" }), true);
  assert.equal(isEmailConfigured({ SMTP_URL: "smtp://user:pass@smtp.example.com" }), true);
  assert.equal(isEmailConfigured({ SMTP_HOST: "smtp.example.com" }), true);
});

test("Email Templates: generates valid HTML and plain text for verification and reset", () => {
  const verify = verificationEmailTemplate("Alex Smith", "https://flowpilot.ai/verify?token=abc");
  assert.equal(verify.subject.includes("Verify"), true);
  assert.equal(verify.text.includes("Alex"), true);
  assert.equal(verify.text.includes("https://flowpilot.ai/verify?token=abc"), true);
  assert.equal(verify.html.includes("Verify email address"), true);

  const reset = resetPasswordEmailTemplate("Alex Smith", "https://flowpilot.ai/reset?token=xyz");
  assert.equal(reset.subject.includes("Reset"), true);
  assert.equal(reset.text.includes("Alex"), true);
  assert.equal(reset.text.includes("https://flowpilot.ai/reset?token=xyz"), true);
  assert.equal(reset.html.includes("Reset password"), true);
});

test("Email Dispatcher: falls back to dev logging safely without throwing", async () => {
  const verifyResult = await sendUserVerificationEmail(
    { name: "Test User", email: "test@example.com" },
    "https://example.com/verify-url",
    {}, // empty env
  );
  assert.equal(verifyResult.success, true);
  assert.equal(verifyResult.messageId, "dev-simulated-id");

  const resetResult = await sendUserPasswordResetEmail(
    { name: "Test User", email: "test@example.com" },
    "https://example.com/reset-url",
    {},
  );
  assert.equal(resetResult.success, true);
});

test("Runtime Security: validates email requirement for public registration in production", () => {
  const baseProdEnv = {
    FLOWPILOT_ENV: "production",
    BETTER_AUTH_URL: "https://flowpilot.ai",
    BETTER_AUTH_SECRET: "0123456789012345678901234567890123456789",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db?sslmode=verify-full",
    OPERATIONS_TOKEN: "0123456789012345678901234567890123456789",
    INTEGRATION_ACTIVE_KEY_ID: "k1",
    INTEGRATION_ENCRYPTION_KEYS: JSON.stringify({
      k1: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    }),
  };

  // With registration enabled and NO email -> fails with PUBLIC_REGISTRATION_EMAIL_REQUIRED
  const issuesNoEmail = runtimeIssues({
    ...baseProdEnv,
    AUTH_REGISTRATION_ENABLED: "true",
  });
  assert.equal(issuesNoEmail.includes("PUBLIC_REGISTRATION_EMAIL_REQUIRED"), true);

  // With registration enabled AND email configured -> passes
  const issuesWithResend = runtimeIssues({
    ...baseProdEnv,
    AUTH_REGISTRATION_ENABLED: "true",
    RESEND_API_KEY: "re_test_key_12345",
  });
  assert.equal(issuesWithResend.includes("PUBLIC_REGISTRATION_EMAIL_REQUIRED"), false);
});

test("Runtime Security: validates provider verification gating in production", () => {
  const baseProdEnv = {
    FLOWPILOT_ENV: "production",
    BETTER_AUTH_URL: "https://flowpilot.ai",
    BETTER_AUTH_SECRET: "0123456789012345678901234567890123456789",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db?sslmode=verify-full",
    OPERATIONS_TOKEN: "0123456789012345678901234567890123456789",
    INTEGRATION_ACTIVE_KEY_ID: "k1",
    INTEGRATION_ENCRYPTION_KEYS: JSON.stringify({
      k1: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    }),
    FLOWPILOT_OPENAI_API_KEY: "sk-proj-valid-length-sample-key-123456",
  };

  // Without FLOWPILOT_PROVIDERS_VERIFIED -> blocked
  const issuesUnverified = runtimeIssues({
    ...baseProdEnv,
    FLOWPILOT_PROVIDERS_VERIFIED: "false",
  });
  assert.equal(issuesUnverified.includes("UNVERIFIED_EXTERNAL_ACTIVATION_FORBIDDEN"), true);

  // With FLOWPILOT_PROVIDERS_VERIFIED=true -> allowed
  const issuesVerified = runtimeIssues({
    ...baseProdEnv,
    FLOWPILOT_PROVIDERS_VERIFIED: "true",
  });
  assert.equal(issuesVerified.includes("UNVERIFIED_EXTERNAL_ACTIVATION_FORBIDDEN"), false);
  assert.equal(issuesVerified.includes("OPENAI_KEY_INVALID"), false);
});

