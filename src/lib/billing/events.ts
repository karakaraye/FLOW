import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Client } from "pg";
import { db } from "../db";
import {
  assertJson,
  canonical,
  isObject,
  EngineError,
} from "../engine/definition";
import { billingError } from "./config";
import { paystackSettings, paystackConfigured } from "./provider";
import {
  providerCode,
  reconcileCheckout,
  reconcileSubscription,
} from "./service";
export function paystackSignature(secret: string, raw: Uint8Array) {
  return createHmac("sha512", secret).update(raw).digest("hex");
}
export function verifyPaystackSignature(
  raw: Uint8Array,
  header: string | null,
) {
  return (
    !!header &&
    /^[A-Fa-f0-9]{128}$/.test(header) &&
    timingSafeEqual(
      Buffer.from(header, "hex"),
      Buffer.from(paystackSignature(paystackSettings().key, raw), "hex"),
    )
  );
}
export async function receivePaystack(raw: Uint8Array, header: string | null) {
  if (raw.byteLength > 65536) billingError("BILLING_WEBHOOK_LIMIT", 413);
  if (!verifyPaystackSignature(raw, header))
    billingError("BILLING_SIGNATURE_INVALID", 401);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    billingError("BILLING_WEBHOOK_INVALID", 400);
  }
  assertJson(value, 65536);
  if (
    !isObject(value) ||
    typeof value.event !== "string" ||
    value.event.length > 80 ||
    !isObject(value.data)
  )
    billingError("BILLING_WEBHOOK_INVALID", 400);
  const kind = value.event,
    data = value.data,
    reference =
      typeof data.reference === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.=-]{0,149}$/.test(data.reference)
        ? data.reference
        : null;
  const sub = providerCode(data.subscription_code, "SUB")
    ? data.subscription_code
    : isObject(data.subscription) &&
        providerCode(data.subscription.subscription_code, "SUB")
      ? data.subscription.subscription_code
      : null;
  const checkout = reference
    ? await db.billingCheckout.findUnique({ where: { reference } })
    : sub
      ? await db.billingCheckout.findUnique({
          where: { subscriptionCode: sub },
        })
      : null;
  const subscription = sub
    ? await db.subscription.findUnique({ where: { providerCode: sub } })
    : null;
  const supported = [
    "charge.success",
    "subscription.create",
    "invoice.update",
    "invoice.payment_failed",
    "subscription.not_renew",
    "subscription.disable",
  ].includes(kind);
  const digest = createHash("sha256").update(canonical(value)).digest("hex");
  await db.billingEvent.upsert({
    where: { digest },
    create: {
      id: randomUUID(),
      digest,
      kind,
      reference,
      subscriptionCode: sub,
      workspaceId: checkout?.workspaceId ?? subscription?.workspaceId,
      status: supported ? "PENDING" : "IGNORED",
    },
    update: {},
  });
  return { accepted: true };
}
export async function processBillingEvent() {
  if (!paystackConfigured()) return false;
  const candidates = await db.billingEvent.findMany({
    where: {
      status: { in: ["PENDING", "RUNNING"] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  for (const event of candidates) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", () => {});
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const lock = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,721)) AS acquired",
        [event.id],
      );
      if (!lock.rows[0].acquired) continue;
      const latest = await db.billingEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (!["PENDING", "RUNNING"].includes(latest.status)) continue;
      await db.billingEvent.update({
        where: { id: event.id },
        data: { status: "RUNNING", attempts: { increment: 1 } },
      });
      try {
        const checkout = event.reference
          ? await db.billingCheckout.findUnique({
              where: { reference: event.reference },
            })
          : event.subscriptionCode
            ? await db.billingCheckout.findUnique({
                where: { subscriptionCode: event.subscriptionCode },
              })
            : null;
        const subscription = event.subscriptionCode
          ? await db.subscription.findUnique({
              where: { providerCode: event.subscriptionCode },
            })
          : null;
        if (checkout)
          await reconcileCheckout(
            checkout.id,
            undefined,
            "SIGNED_EVENT",
            event.kind === "subscription.create"
              ? (event.subscriptionCode ?? undefined)
              : undefined,
          );
        if (subscription?.providerCode)
          await reconcileSubscription(
            subscription.providerCode,
            undefined,
            "SIGNED_EVENT",
          );
        await db.billingEvent.update({
          where: { id: event.id },
          data: {
            status: checkout || subscription ? "PROCESSED" : "UNMATCHED",
            workspaceId:
              checkout?.workspaceId ?? subscription?.workspaceId ?? null,
            error: null,
            processedAt: new Date(),
          },
        });
      } catch (e) {
        await db.billingEvent.update({
          where: { id: event.id },
          data: {
            status: latest.attempts >= 7 ? "NEEDS_REVIEW" : "PENDING",
            error:
              e instanceof EngineError
                ? e.code
                : "BILLING_RECONCILIATION_UNAVAILABLE",
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 5000 * 2 ** latest.attempts),
            ),
          },
        });
      }
      return true;
    } finally {
      if (connected) await client.end().catch(() => {});
    }
  }
  return false;
}
let nextTick = 0;
export async function reconcileDueBilling() {
  if (!paystackConfigured() || Date.now() < nextTick) return false;
  nextTick = Date.now() + 60000;
  const before = new Date(Date.now() - 300000);
  const checkout = await db.billingCheckout.findFirst({
    where: {
      status: {
        in: ["INITIALIZING", "OPEN", "UNKNOWN", "PAID_PENDING_SUBSCRIPTION"],
      },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: before } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (checkout) {
    await db.billingCheckout.update({
      where: { id: checkout.id },
      data: { lastReconciledAt: new Date() },
    });
    try {
      await reconcileCheckout(checkout.id);
    } catch {}
    return true;
  }
  const s = await db.subscription.findFirst({
    where: {
      provider: "PAYSTACK",
      mode: "TEST",
      providerCode: { not: null },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: before } }],
    },
    orderBy: { lastReconciledAt: "asc" },
  });
  if (s?.providerCode) {
    await db.subscription.update({
      where: { id: s.id },
      data: { lastReconciledAt: new Date() },
    });
    try {
      await reconcileSubscription(s.providerCode);
    } catch {}
    return true;
  }
  return false;
}
