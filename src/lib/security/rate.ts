import { createHash } from "node:crypto";
import { db } from "../db";
import { EngineError } from "../engine/definition";
import { boundedInteger } from "./runtime";
export async function apiRate(userId: string) {
  const key =
      "flowpilot:api:" + createHash("sha256").update(userId).digest("hex"),
    now = BigInt(Date.now()),
    old = now - 60000n,
    limit = boundedInteger("API_USER_RATE_PER_MINUTE", 600, 30, 5000);
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" (id,key,count,"lastRequest") VALUES (${key},${key},1,${now}) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "RateLimit"."lastRequest"<${old} THEN 1 ELSE LEAST("RateLimit".count+1,${limit + 1}) END,"lastRequest"=CASE WHEN "RateLimit"."lastRequest"<${old} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING count`;
  if (rows[0].count > limit)
    throw new EngineError(
      "API_RATE_LIMIT",
      "Request allowance exceeded. Try again in one minute.",
      429,
    );
}
