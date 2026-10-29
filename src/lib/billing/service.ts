import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma, type BillingCheckout } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { isObject } from "../engine/definition";
import { encryptSecret, decryptSecret, loadKeys } from "../integrations/crypto";
import {
  catalog,
  planFor,
  planMapping,
  paidPeriodEnd,
  billingError,
  type Interval,
  type Tier,
} from "./config";
import {
  paystackAdapter,
  paystackSettings,
  paystackConfigured,
  billingMode,
  type PaystackAdapter,
} from "./provider";
import { effectivePlan, quotaLock, usageView } from "./quotas";
export type Actor = { userId: string; workspaceId: string };
const manage = ["OWNER", "ADMIN"] as const;
export const billingContext = (id: string, workspaceId: string) => ({
  workspaceId,
  integrationId: `billing:${id}`,
  providerId: "paystack",
  recordId: id,
  purpose: "billing-secret" as const,
});
function emailHash(email: string, workspaceId: string) {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key || key.length < 32) billingError("BILLING_SECRET_UNAVAILABLE", 503);
  return createHmac("sha256", key)
    .update(`${workspaceId}:${email.trim().toLowerCase()}`)
    .digest("hex");
}
export function providerCode(value: unknown, prefix: string): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${prefix}_[A-Za-z0-9]{3,100}$`).test(value)
  );
}
function date(value: unknown) {
  if (typeof value !== "string") billingError("BILLING_PROVIDER_DATE_INVALID");
  const d = new Date(value);
  if (!Number.isFinite(d.getTime()))
    billingError("BILLING_PROVIDER_DATE_INVALID");
  return d;
}
async function audit(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  code: string,
  source: string,
  actorId = "billing-worker",
  reference?: string,
  fromStatus?: string,
  toStatus?: string,
) {
  await tx.billingAudit.create({
    data: {
      id: randomUUID(),
      workspaceId,
      actorId,
      code,
      source,
      reference,
      fromStatus,
      toStatus,
    },
  });
}
async function localPlan(tx: Prisma.TransactionClient, code: string) {
  const p = planFor(code);
  return tx.subscriptionPlan.upsert({
    where: { code: p.code },
    create: {
      code: p.code,
      name: p.name,
      monthlyPriceCents: p.monthly,
      currency: p.currency,
    },
    update: {},
  });
}
export async function billingOverview(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const current = await effectivePlan(tx, actor.workspaceId);
    return {
      mode: billingMode(),
      configured: paystackConfigured(),
      period: new Date().toISOString().slice(0, 7),
      effectivePlan: current.plan,
      plans: catalog().map((p) => ({
        ...p,
        monthlyAvailable: configuredPrice(p.code, "monthly"),
        annualAvailable: configuredPrice(p.code, "annually"),
      })),
      subscription: current.subscription
        ? {
            id: current.subscription.id,
            status: current.subscription.status,
            plan: current.subscription.plan.code,
            paidThrough: current.subscription.currentPeriodEnd,
            nextPaymentDue:
              current.subscription.status === "CANCELED"
                ? null
                : current.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: current.subscription.cancelAtPeriodEnd,
            revision: current.subscription.revision,
            lastVerifiedAt: current.subscription.lastReconciledAt,
          }
        : null,
      usage: await usageView(tx, actor.workspaceId, current.plan.limits),
      checkouts: await tx.billingCheckout.findMany({
        where: { workspaceId: actor.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          reference: true,
          tier: true,
          interval: true,
          amountMinor: true,
          currency: true,
          status: true,
          error: true,
          createdAt: true,
        },
      }),
      payments: await tx.billingPayment.findMany({
        where: { workspaceId: actor.workspaceId },
        orderBy: { paidAt: "desc" },
        take: 30,
        select: {
          reference: true,
          amountMinor: true,
          currency: true,
          paidAt: true,
          periodEnd: true,
          source: true,
        },
      }),
      audits: await tx.billingAudit.findMany({
        where: { workspaceId: actor.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          code: true,
          source: true,
          createdAt: true,
          fromStatus: true,
          toStatus: true,
        },
      }),
    };
  });
}
function configuredPrice(code: Tier, interval: Interval) {
  if (code === "FREE") return false;
  try {
    return (
      (interval === "monthly"
        ? planFor(code).monthly
        : planFor(code).annually) !== null && !!planMapping(code, interval)
    );
  } catch {
    return false;
  }
}
function checkoutDTO(c: BillingCheckout) {
  return {
    id: c.id,
    reference: c.reference,
    status: c.status,
    ...(c.status === "OPEN" && c.urlCiphertext
      ? {
          url: decryptSecret<{ url: string }>(
            c.urlCiphertext,
            billingContext(c.id, c.workspaceId),
          ).url,
        }
      : {}),
  };
}
export async function initializeCheckout(
  actor: Actor,
  body: unknown,
  key: string | null,
  adapter: PaystackAdapter = paystackAdapter,
) {
  if (
    !isObject(body) ||
    Object.keys(body).some((k) => !["plan", "interval"].includes(k)) ||
    typeof body.plan !== "string" ||
    !["monthly", "annually"].includes(String(body.interval)) ||
    !key ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(key)
  )
    billingError("BILLING_CHECKOUT_BODY");
  const selected = planFor(body.plan),
    interval = body.interval as Interval,
    amount = interval === "monthly" ? selected.monthly : selected.annually;
  if (selected.code === "FREE" || !amount)
    billingError("BILLING_PRICE_NOT_AVAILABLE");
  const hash = createHash("sha256")
    .update(`${selected.code}:${interval}`)
    .digest("hex");
  const pre = await db.$transaction(async (tx) => {
    await authorize(tx, actor, [...manage]);
    await quotaLock(tx, actor.workspaceId);
    const old = await tx.billingCheckout.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: actor.workspaceId,
          idempotencyKey: key,
        },
      },
    });
    if (old) {
      if (old.requestHash !== hash)
        billingError("BILLING_IDEMPOTENCY_CONFLICT", 409);
      return old;
    }
    return null;
  });
  if (pre) return checkoutDTO(pre);
  paystackSettings();
  loadKeys();
  const mapping = planMapping(selected.code, interval),
    remote = await adapter.plan(mapping);
  if (
    remote.domain !== "test" ||
    remote.plan_code !== mapping ||
    remote.amount !== amount ||
    remote.currency !== "NGN" ||
    remote.interval !== interval ||
    !Number.isSafeInteger(remote.id) ||
    Number(remote.id) < 1
  )
    billingError("BILLING_PROVIDER_PLAN_MISMATCH");
  const captured = await db.$transaction(async (tx) => {
    await authorize(tx, actor, [...manage]);
    await quotaLock(tx, actor.workspaceId);
    const repeat = await tx.billingCheckout.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: actor.workspaceId,
          idempotencyKey: key,
        },
      },
    });
    if (repeat) {
      if (repeat.requestHash !== hash)
        billingError("BILLING_IDEMPOTENCY_CONFLICT", 409);
      return { row: repeat, initialize: false, email: "" };
    }
    const current = await effectivePlan(tx, actor.workspaceId);
    if (
      current.paid ||
      (current.subscription?.providerCode &&
        current.subscription.status !== "CANCELED")
    )
      billingError("BILLING_EXISTING_SUBSCRIPTION", 409);
    const pending = await tx.billingCheckout.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        status: {
          in: [
            "INITIALIZING",
            "OPEN",
            "UNKNOWN",
            "PAID_PENDING_SUBSCRIPTION",
            "PAID_REQUIRES_REVIEW",
          ],
        },
      },
    });
    if (pending) {
      if (pending.requestHash !== hash)
        billingError("BILLING_UNRESOLVED_CHECKOUT", 409);
      return { row: pending, initialize: false, email: "" };
    }
    const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
      }),
      id = randomUUID();
    const row = await tx.billingCheckout.create({
      data: {
        id,
        workspaceId: actor.workspaceId,
        requestedBy: actor.userId,
        emailHash: emailHash(user.email, actor.workspaceId),
        idempotencyKey: key,
        requestHash: hash,
        reference: `flow-test-${id.replaceAll("-", "")}`,
        tier: selected.code,
        interval,
        amountMinor: amount,
        currency: "NGN",
        providerPlanCode: mapping,
        providerPlanId: Number(remote.id),
      },
    });
    await audit(
      tx,
      actor.workspaceId,
      "CHECKOUT_INITIALIZING",
      "USER",
      actor.userId,
      row.reference,
    );
    return { row, initialize: true, email: user.email };
  });
  if (!captured.initialize) return checkoutDTO(captured.row);
  const row = captured.row;
  try {
    const response = await adapter.initialize({
      email: captured.email,
      amount: row.amountMinor,
      currency: row.currency,
      reference: row.reference,
      callback_url: new URL("/billing", process.env.BETTER_AUTH_URL!).href,
      metadata: { checkout_id: row.id },
      channels: ["card"],
    });
    const sealed = encryptSecret(
      { url: response.url },
      billingContext(row.id, actor.workspaceId),
    );
    await db.billingCheckout.updateMany({
      where: { id: row.id, status: "INITIALIZING" },
      data: { status: "OPEN", urlCiphertext: sealed.ciphertext },
    });
    return checkoutDTO(
      await db.billingCheckout.findUniqueOrThrow({ where: { id: row.id } }),
    );
  } catch {
    await db.billingCheckout.updateMany({
      where: { id: row.id, status: "INITIALIZING" },
      data: { status: "UNKNOWN", error: "CHECKOUT_OUTCOME_UNKNOWN" },
    });
    billingError("BILLING_CHECKOUT_UNKNOWN", 503);
  }
}
type Verified = {
  id: string;
  reference: string;
  customerCode: string;
  customerId: number;
  paidAt: Date;
};
function verifiedTransaction(
  d: Record<string, unknown>,
  expected: {
    reference: string;
    amountMinor: number;
    currency: string;
    workspaceId: string;
    emailHash?: string;
    customerCode?: string | null;
  },
): Verified {
  if (
    d.domain !== "test" ||
    d.status !== "success" ||
    d.reference !== expected.reference ||
    d.amount !== expected.amountMinor ||
    d.currency !== expected.currency ||
    !Number.isSafeInteger(d.id) ||
    Number(d.id) < 1 ||
    !isObject(d.customer) ||
    !providerCode(d.customer.customer_code, "CUS") ||
    !Number.isSafeInteger(d.customer.id) ||
    Number(d.customer.id) < 1 ||
    (expected.customerCode &&
      d.customer.customer_code !== expected.customerCode) ||
    (expected.emailHash &&
      (typeof d.customer.email !== "string" ||
        emailHash(d.customer.email, expected.workspaceId) !==
          expected.emailHash))
  )
    billingError("BILLING_PAYMENT_NOT_VERIFIED");
  const paidAt = date(d.paid_at ?? d.paidAt);
  if (paidAt.getTime() > Date.now() + 300000)
    billingError("BILLING_PAYMENT_NOT_VERIFIED");
  return {
    id: String(d.id),
    reference: expected.reference,
    customerCode: d.customer.customer_code,
    customerId: Number(d.customer.id),
    paidAt,
  };
}
function validateSubscription(
  s: Record<string, unknown>,
  customerCode: string,
  planCode: string,
  amount: number,
  interval: string,
) {
  if (
    s.domain !== "test" ||
    !providerCode(s.subscription_code, "SUB") ||
    !isObject(s.customer) ||
    s.customer.customer_code !== customerCode ||
    !isObject(s.plan) ||
    s.plan.domain !== "test" ||
    s.plan.plan_code !== planCode ||
    s.plan.amount !== amount ||
    s.plan.currency !== "NGN" ||
    s.plan.interval !== interval ||
    s.amount !== amount ||
    !["active", "non-renewing", "attention", "cancelled", "completed"].includes(
      String(s.status),
    )
  )
    billingError("BILLING_SUBSCRIPTION_NOT_VERIFIED");
  return s.subscription_code;
}
export async function reconcileCheckout(
  id: string,
  adapter: PaystackAdapter = paystackAdapter,
  source = "RECONCILIATION",
  hint?: string,
) {
  const c = await db.billingCheckout.findUniqueOrThrow({ where: { id } });
  if (["ACTIVE", "PAID_REQUIRES_REVIEW"].includes(c.status)) return;
  const raw = await adapter.verify(c.reference);
  if (raw.status !== "success") {
    await db.billingCheckout.update({
      where: { id },
      data: { lastReconciledAt: new Date(), error: "PAYMENT_NOT_CONFIRMED" },
    });
    return;
  }
  const v = verifiedTransaction(raw, c);
  await db.billingCheckout.update({
    where: { id },
    data: {
      status: "PAID_PENDING_SUBSCRIPTION",
      providerTransactionId: v.id,
      customerCode: v.customerCode,
      customerId: v.customerId,
      paidAt: v.paidAt,
      lastReconciledAt: new Date(),
      error:
        c.subscriptionAttemptedAt && !c.subscriptionCode
          ? "SUBSCRIPTION_CREATE_UNKNOWN"
          : null,
    },
  });
  await db.$transaction(async (tx) => {
    await quotaLock(tx, c.workspaceId);
    if (
      !(await tx.billingPayment.findUnique({
        where: { reference: c.reference },
      }))
    ) {
      await tx.billingPayment.create({
        data: {
          reference: c.reference,
          checkoutId: c.id,
          workspaceId: c.workspaceId,
          providerTransactionId: v.id,
          subscriptionCode: null,
          amountMinor: c.amountMinor,
          currency: c.currency,
          paidAt: v.paidAt,
          periodEnd: paidPeriodEnd(v.paidAt, c.interval as Interval),
          source,
        },
      });
      await audit(
        tx,
        c.workspaceId,
        "PAYMENT_VERIFIED",
        source,
        "billing-worker",
        c.reference,
      );
    }
  });
  const currentCheckout = await db.billingCheckout.findUniqueOrThrow({
    where: { id },
  });
  let subscriptionCode = currentCheckout.subscriptionCode;
  if (hint && subscriptionCode !== hint)
    billingError("BILLING_SUBSCRIPTION_BINDING_INVALID");
  if (!subscriptionCode) {
    const end = paidPeriodEnd(v.paidAt, c.interval as Interval);
    if (end <= new Date()) {
      await db.billingCheckout.update({
        where: { id },
        data: {
          status: "PAID_REQUIRES_REVIEW",
          error: "PAID_PERIOD_EXPIRED_REVIEW_REQUIRED",
        },
      });
      return;
    }
    const freshPlan = await adapter.plan(c.providerPlanCode);
    if (
      freshPlan.domain !== "test" ||
      freshPlan.plan_code !== c.providerPlanCode ||
      freshPlan.amount !== c.amountMinor ||
      freshPlan.currency !== c.currency ||
      freshPlan.interval !== c.interval
    )
      billingError("BILLING_PROVIDER_PLAN_MISMATCH");
    const claimed = await db.billingCheckout.updateMany({
      where: { id, subscriptionAttemptedAt: null },
      data: { subscriptionAttemptedAt: new Date() },
    });
    if (!claimed.count) return; // unknown create intent: never blindly retry
    if (
      !isObject(raw.authorization) ||
      raw.authorization.reusable !== true ||
      typeof raw.authorization.authorization_code !== "string"
    )
      billingError("BILLING_REUSABLE_AUTHORIZATION_REQUIRED");
    let created;
    try {
      created = await adapter.createSubscription({
        customer: v.customerCode,
        plan: c.providerPlanCode,
        authorization: raw.authorization.authorization_code,
        start_date: paidPeriodEnd(
          v.paidAt,
          c.interval as Interval,
        ).toISOString(),
      });
    } catch {
      await db.billingCheckout.update({
        where: { id },
        data: { error: "SUBSCRIPTION_CREATE_UNKNOWN" },
      });
      billingError("BILLING_SUBSCRIPTION_CREATE_UNKNOWN", 503);
    }
    if (!providerCode(created.subscription_code, "SUB"))
      billingError("BILLING_SUBSCRIPTION_CREATE_UNKNOWN", 503);
    subscriptionCode = created.subscription_code;
    await db.billingCheckout.update({
      where: { id },
      data: { subscriptionCode },
    });
  }
  {
    const s = await adapter.subscription(subscriptionCode);
    if (s.subscription_code !== subscriptionCode)
      billingError("BILLING_SUBSCRIPTION_BINDING_INVALID");
    const code = validateSubscription(
      s,
      v.customerCode,
      c.providerPlanCode,
      c.amountMinor,
      c.interval,
    );
    if (!["active", "non-renewing", "attention"].includes(String(s.status)))
      return;
    const periodEnd = paidPeriodEnd(v.paidAt, c.interval as Interval);
    await db.$transaction(async (tx) => {
      await quotaLock(tx, c.workspaceId);
      if (
        (await tx.billingCheckout.findUniqueOrThrow({ where: { id } }))
          .status === "ACTIVE"
      )
        return;
      const current = await tx.subscription.findUnique({
          where: { workspaceId: c.workspaceId },
        }),
        other = await tx.subscription.findUnique({
          where: { providerCode: code },
        });
      if (other && other.workspaceId !== c.workspaceId)
        billingError("BILLING_SUBSCRIPTION_BINDING_INVALID");
      if (
        current?.providerCode &&
        current.providerCode !== code &&
        current.currentPeriodEnd &&
        current.currentPeriodEnd > new Date()
      ) {
        await tx.billingCheckout.update({
          where: { id },
          data: {
            status: "PAID_REQUIRES_REVIEW",
            error: "OVERLAPPING_PAYMENT_REVIEW_REQUIRED",
          },
        });
        await audit(
          tx,
          c.workspaceId,
          "OVERLAPPING_PAYMENT_REVIEW_REQUIRED",
          source,
          "billing-worker",
          c.reference,
        );
        return;
      }
      const payment = await tx.billingPayment.findUnique({
        where: { reference: c.reference },
      });
      if (!payment) {
        await tx.billingPayment.create({
          data: {
            reference: c.reference,
            checkoutId: c.id,
            workspaceId: c.workspaceId,
            providerTransactionId: v.id,
            subscriptionCode: code,
            amountMinor: c.amountMinor,
            currency: c.currency,
            paidAt: v.paidAt,
            periodEnd,
            source,
          },
        });
      }
      const plan = await localPlan(tx, c.tier),
        subId = current?.id ?? randomUUID();
      const encrypted =
        typeof s.email_token === "string" && s.email_token.length <= 512
          ? encryptSecret(
              { emailToken: s.email_token },
              billingContext(subId, c.workspaceId),
            ).ciphertext
          : null;
      const patch = {
        planId: plan.id,
        provider: "PAYSTACK",
        mode: "TEST",
        providerCode: code,
        customerCode: v.customerCode,
        providerPlanCode: c.providerPlanCode,
        interval: c.interval,
        amountMinor: c.amountMinor,
        currency: c.currency,
        status:
          s.status === "attention"
            ? ("PAST_DUE" as const)
            : ("ACTIVE" as const),
        currentPeriodEnd: periodEnd,
        paidVerifiedAt: new Date(),
        lastPaidAt: v.paidAt,
        cancelAtPeriodEnd: s.status === "non-renewing",
        credentialCiphertext: encrypted,
        lastReconciledAt: new Date(),
      };
      if (!current || !current.lastPaidAt || v.paidAt >= current.lastPaidAt) {
        await tx.subscription.upsert({
          where: { workspaceId: c.workspaceId },
          create: { id: subId, workspaceId: c.workspaceId, ...patch },
          update: { ...patch, revision: { increment: 1 } },
        });
        await audit(
          tx,
          c.workspaceId,
          "VERIFIED_PAYMENT_ACTIVATED",
          source,
          "billing-worker",
          c.reference,
          current?.status,
          "ACTIVE",
        );
      }
      await tx.billingCheckout.update({
        where: { id },
        data: { status: "ACTIVE", error: null, urlCiphertext: null },
      });
    });
    return;
  }
}
async function transactionFromInvoice(
  invoice: Record<string, unknown>,
  adapter: PaystackAdapter,
) {
  if (
    isObject(invoice.transaction) &&
    typeof invoice.transaction.reference === "string"
  )
    return invoice.transaction.reference;
  if (
    Number.isSafeInteger(invoice.transaction) &&
    Number(invoice.transaction) > 0
  ) {
    const t = await adapter.transaction(Number(invoice.transaction));
    return typeof t.reference === "string" ? t.reference : null;
  }
  return null;
}
export async function reconcileSubscription(
  code: string,
  adapter: PaystackAdapter = paystackAdapter,
  source = "RECONCILIATION",
) {
  const local = await db.subscription.findUnique({
    where: { providerCode: code },
  });
  if (!local || local.provider !== "PAYSTACK" || local.mode !== "TEST") return;
  const remote = await adapter.subscription(code);
  if (remote.subscription_code !== code)
    billingError("BILLING_SUBSCRIPTION_BINDING_INVALID");
  validateSubscription(
    remote,
    local.customerCode!,
    local.providerPlanCode!,
    local.amountMinor,
    local.interval,
  );
  const invoices = [
    ...(Array.isArray(remote.invoices) ? remote.invoices.filter(isObject) : []),
    ...(isObject(remote.most_recent_invoice)
      ? [remote.most_recent_invoice]
      : []),
  ].slice(-20);
  for (const invoice of invoices) {
    if (
      (invoice.paid !== true && invoice.paid !== 1) ||
      invoice.status !== "success" ||
      invoice.amount !== local.amountMinor ||
      (invoice.domain !== undefined && invoice.domain !== "test")
    )
      continue;
    const reference = await transactionFromInvoice(invoice, adapter);
    if (!reference || !/^[A-Za-z0-9][A-Za-z0-9_.=-]{0,149}$/.test(reference))
      continue;
    const raw = await adapter.verify(reference),
      v = verifiedTransaction(raw, {
        reference,
        amountMinor: local.amountMinor,
        currency: local.currency,
        workspaceId: local.workspaceId,
        customerCode: local.customerCode!,
      });
    const start = date(invoice.period_start),
      end = date(invoice.period_end),
      max = paidPeriodEnd(start, local.interval as Interval);
    if (
      end <= start ||
      end.getTime() > max.getTime() + 300000 ||
      start.getTime() > v.paidAt.getTime() + 86400000 ||
      start.getTime() < v.paidAt.getTime() - 7 * 86400000
    )
      billingError("BILLING_INVOICE_PERIOD_INVALID");
    await db.$transaction(async (tx) => {
      await quotaLock(tx, local.workspaceId);
      const latest = await tx.subscription.findUniqueOrThrow({
        where: { providerCode: code },
      });
      const existing = await tx.billingPayment.findUnique({
        where: { reference },
      });
      if (existing) return;
      const origin = await tx.billingCheckout.findUniqueOrThrow({
        where: { subscriptionCode: code },
      });
      await tx.billingPayment.create({
        data: {
          reference,
          checkoutId: origin.id,
          workspaceId: local.workspaceId,
          providerTransactionId: v.id,
          subscriptionCode: code,
          amountMinor: local.amountMinor,
          currency: local.currency,
          paidAt: v.paidAt,
          periodEnd: end,
          source,
        },
      });
      if (!latest.currentPeriodEnd || end > latest.currentPeriodEnd) {
        await tx.subscription.update({
          where: { id: latest.id },
          data: {
            currentPeriodEnd: end,
            lastPaidAt: v.paidAt,
            paidVerifiedAt: new Date(),
            status: "ACTIVE",
            revision: { increment: 1 },
          },
        });
        await audit(
          tx,
          local.workspaceId,
          "VERIFIED_RENEWAL",
          source,
          "billing-worker",
          reference,
          latest.status,
          "ACTIVE",
        );
      }
    });
  }
  await db.$transaction(async (tx) => {
    await quotaLock(tx, local.workspaceId);
    const s = await tx.subscription.findUniqueOrThrow({
      where: { providerCode: code },
    });
    const cancelled = ["cancelled", "completed", "non-renewing"].includes(
        String(remote.status),
      ),
      status =
        remote.status === "attention"
          ? "PAST_DUE"
          : cancelled
            ? "CANCELED"
            : "ACTIVE";
    const changed = s.status !== status || (cancelled && !s.cancelAtPeriodEnd);
    await tx.subscription.update({
      where: { id: s.id },
      data: {
        status,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd || cancelled,
        lastReconciledAt: new Date(),
        ...(changed ? { revision: { increment: 1 } } : {}),
      },
    });
    if (changed)
      await audit(
        tx,
        s.workspaceId,
        remote.status === "attention"
          ? "RENEWAL_PAYMENT_FAILED"
          : cancelled
            ? "PROVIDER_CANCELLATION"
            : "SUBSCRIPTION_RECONCILED",
        source,
        "billing-worker",
        undefined,
        s.status,
        status,
      );
  });
}
export async function reconcileBilling(
  actor: Actor,
  body: unknown,
  adapter: PaystackAdapter = paystackAdapter,
) {
  await db.$transaction((tx) => authorize(tx, actor, [...manage]));
  paystackSettings();
  if (
    !isObject(body) ||
    Object.keys(body).some((k) => !["checkoutId"].includes(k))
  )
    billingError("BILLING_RECONCILE_BODY");
  if (body.checkoutId !== undefined) {
    const c = await db.billingCheckout.findFirst({
      where: { id: String(body.checkoutId), workspaceId: actor.workspaceId },
    });
    if (!c) billingError("NOT_FOUND", 404);
    await reconcileCheckout(c.id, adapter, "USER_RECONCILIATION");
  }
  const s = await db.subscription.findUnique({
    where: { workspaceId: actor.workspaceId },
  });
  if (s?.providerCode)
    await reconcileSubscription(s.providerCode, adapter, "USER_RECONCILIATION");
  return { reconciled: true };
}
export async function cancelBilling(
  actor: Actor,
  body: unknown,
  adapter: PaystackAdapter = paystackAdapter,
) {
  if (
    !isObject(body) ||
    Object.keys(body).some((k) => k !== "revision") ||
    !Number.isSafeInteger(body.revision)
  )
    billingError("BILLING_CANCEL_BODY");
  const captured = await db.$transaction(async (tx) => {
    await authorize(tx, actor, [...manage]);
    await quotaLock(tx, actor.workspaceId);
    const s = await tx.subscription.findUnique({
      where: { workspaceId: actor.workspaceId },
    });
    if (
      !s ||
      s.provider !== "PAYSTACK" ||
      !s.providerCode ||
      s.revision !== body.revision
    )
      billingError("BILLING_REVISION_CONFLICT", 409);
    if (s.cancelAtPeriodEnd) return { row: s, already: true };
    const row = await tx.subscription.update({
      where: { id: s.id },
      data: { cancelAtPeriodEnd: true, revision: { increment: 1 } },
    });
    await audit(
      tx,
      actor.workspaceId,
      "CANCELLATION_REQUESTED",
      "USER",
      actor.userId,
      undefined,
      s.status,
      s.status,
    );
    return { row, already: false };
  });
  const providerState = await adapter.subscription(captured.row.providerCode!);
  if (
    !["non-renewing", "cancelled", "completed"].includes(
      String(providerState.status),
    )
  ) {
    if (!captured.row.credentialCiphertext)
      billingError("BILLING_CANCELLATION_UNVERIFIED", 503);
    const secret = decryptSecret<{ emailToken: string }>(
      captured.row.credentialCiphertext,
      billingContext(captured.row.id, actor.workspaceId),
    );
    await adapter.disable(captured.row.providerCode!, secret.emailToken);
  }
  await reconcileSubscription(
    captured.row.providerCode!,
    adapter,
    "CANCELLATION_RECONCILIATION",
  );
  const current = await db.subscription.findUniqueOrThrow({
    where: { workspaceId: actor.workspaceId },
  });
  if (current.status !== "CANCELED")
    billingError("BILLING_CANCELLATION_UNVERIFIED", 503);
  return { cancelled: true, paidThrough: current.currentPeriodEnd };
}
