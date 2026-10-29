import { production } from "./security/runtime";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
export const auth = betterAuth({
  trustedOrigins: process.env.BETTER_AUTH_URL
    ? [new URL(process.env.BETTER_AUTH_URL).origin]
    : [],
  logger: { disabled: true },
  advanced: {
    useSecureCookies:
      process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    ipAddress: {
      ipAddressHeaders: production()
        ? ["x-flowpilot-client-ip"]
        : ["x-forwarded-for"],
    },
  },
  appName: "FlowPilot AI",
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: production(),
    minPasswordLength: 12,
    maxPasswordLength: 128,
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
