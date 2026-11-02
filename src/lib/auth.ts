import { production } from "./security/runtime";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import {
  sendUserVerificationEmail,
  sendUserPasswordResetEmail,
} from "./email/dispatcher";

const resolvedBaseUrl = process.env.BETTER_AUTH_URL || process.env.RENDER_EXTERNAL_URL;

export const auth = betterAuth({
  trustedOrigins: resolvedBaseUrl
    ? [new URL(resolvedBaseUrl).origin]
    : [],
  logger: { disabled: true },
  advanced: {
    useSecureCookies:
      resolvedBaseUrl?.startsWith("https://") ?? false,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    ipAddress: {
      ipAddressHeaders: ["x-flowpilot-client-ip", "x-forwarded-for"],
    },
  },
  appName: "FlowPilot AI",
  baseURL: resolvedBaseUrl,
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendUserVerificationEmail(user, url);
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: production(),
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendUserPasswordResetEmail(user, url);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 600,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
});
