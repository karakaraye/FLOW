import { EngineError, isObject } from "../engine/definition";
export const tiers = ["FREE", "STARTER", "BUSINESS", "PRO"] as const;
export type Tier = (typeof tiers)[number];
export type Interval = "monthly" | "annually";
export type Limits = {
  activeWorkflows: number;
  executions: number;
  aiMicros: number;
  integrations: number;
  messages: number;
  concurrency: number;
};
export type Plan = {
  code: Tier;
  name: string;
  monthly: number;
  annually: number | null;
  currency: "NGN";
  limits: Limits;
};
const defaults: Plan[] = [
  {
    code: "FREE",
    name: "Free",
    monthly: 0,
    annually: null,
    currency: "NGN",
    limits: {
      activeWorkflows: 100,
      executions: 1000,
      aiMicros: 5000000,
      integrations: 100,
      messages: 100,
      concurrency: 2,
    },
  },
  {
    code: "STARTER",
    name: "Starter",
    monthly: 500000,
    annually: null,
    currency: "NGN",
    limits: {
      activeWorkflows: 200,
      executions: 10000,
      aiMicros: 20000000,
      integrations: 100,
      messages: 1000,
      concurrency: 4,
    },
  },
  {
    code: "BUSINESS",
    name: "Business",
    monthly: 1500000,
    annually: null,
    currency: "NGN",
    limits: {
      activeWorkflows: 500,
      executions: 100000,
      aiMicros: 100000000,
      integrations: 100,
      messages: 10000,
      concurrency: 8,
    },
  },
  {
    code: "PRO",
    name: "Pro",
    monthly: 3500000,
    annually: null,
    currency: "NGN",
    limits: {
      activeWorkflows: 1000,
      executions: 500000,
      aiMicros: 250000000,
      integrations: 100,
      messages: 100000,
      concurrency: 16,
    },
  },
];
export function billingError(code: string, status = 422): never {
  throw new EngineError(
    code,
    "Billing operation could not be verified. Review the billing status or contact the operator.",
    status,
  );
}
export function catalog(): Plan[] {
  if (!process.env.FLOWPILOT_BILLING_CATALOG_JSON)
    return structuredClone(defaults);
  let raw: unknown;
  try {
    raw = JSON.parse(process.env.FLOWPILOT_BILLING_CATALOG_JSON);
  } catch {
    billingError("BILLING_CONFIG_INVALID", 503);
  }
  if (!Array.isArray(raw) || raw.length !== 4)
    billingError("BILLING_CONFIG_INVALID", 503);
  return tiers.map((code) => {
    const p = raw.find((x) => isObject(x) && x.code === code);
    if (
      !isObject(p) ||
      Object.keys(p).some(
        (k) =>
          ![
            "code",
            "name",
            "monthly",
            "annually",
            "currency",
            "limits",
          ].includes(k),
      ) ||
      typeof p.name !== "string" ||
      p.name.length > 80 ||
      !p.name ||
      p.currency !== "NGN" ||
      !Number.isSafeInteger(p.monthly) ||
      Number(p.monthly) < 0 ||
      Number(p.monthly) > 1000000000 ||
      (code === "FREE" && p.monthly !== 0) ||
      (code !== "FREE" && p.monthly === 0) ||
      (p.annually !== null &&
        (!Number.isSafeInteger(p.annually) ||
          Number(p.annually) < 1 ||
          Number(p.annually) > 1000000000)) ||
      (code === "FREE" && p.annually !== null) ||
      !isObject(p.limits)
    )
      billingError("BILLING_CONFIG_INVALID", 503);
    const keys = Object.keys(defaults[0].limits);
    if (
      Object.keys(p.limits).length !== keys.length ||
      keys.some(
        (k) =>
          !Number.isSafeInteger((p.limits as Record<string, unknown>)[k]) ||
          Number((p.limits as Record<string, unknown>)[k]) < 0 ||
          Number((p.limits as Record<string, unknown>)[k]) > 1000000000,
      ) ||
      Number(p.limits.concurrency) < 1 ||
      Number(p.limits.concurrency) > 32 ||
      Number(p.limits.activeWorkflows) > 2000 ||
      Number(p.limits.integrations) > 100
    )
      billingError("BILLING_CONFIG_INVALID", 503);
    return p as unknown as Plan;
  });
}
export function planFor(code: string) {
  const p = catalog().find((p) => p.code === code);
  if (!p) billingError("BILLING_PLAN_INVALID");
  return p;
}
export function planMapping(code: Tier, interval: Interval) {
  let map: unknown;
  try {
    map = JSON.parse(process.env.PAYSTACK_TEST_PLAN_CODES_JSON ?? "{}");
  } catch {}
  const p = isObject(map) ? map[code] : undefined,
    value = isObject(p) ? p[interval] : undefined;
  if (typeof value !== "string" || !/^PLN_[A-Za-z0-9]{3,100}$/.test(value))
    billingError("BILLING_PLAN_NOT_CONFIGURED", 503);
  return value;
}
export function period(now = new Date()) {
  return now.toISOString().slice(0, 7);
}
export function paidPeriodEnd(start: Date, interval: Interval) {
  const end = new Date(start),
    day = end.getUTCDate();
  end.setUTCDate(1);
  if (interval === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  const max = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, max));
  return end;
}
