import { boundedInteger } from "./security/runtime";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
  globalDb.prisma ??
  new PrismaClient({
    errorFormat: "minimal",
    log: [],
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: boundedInteger("DB_POOL_MAX", 5, 1, 32),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name:
        process.env.FLOWPILOT_PROCESS_ROLE === "worker" ||
        process.argv.some((a) => a.endsWith("scripts/worker.ts"))
          ? `flowpilot-worker${process.env.FLOWPILOT_WORKER_ID ? ":" + process.env.FLOWPILOT_WORKER_ID.slice(0, 40) : ""}`
          : "flowpilot-web",
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
