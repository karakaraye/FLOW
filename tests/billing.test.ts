import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { db } from "../src/lib/db";
import { catalog, planFor, paidPeriodEnd } from "../src/lib/billing/config";
import {
  initializeCheckout,
  reconcileCheckout,
  reconcileBilling,
  cancelBilling,
  billingOverview,
} from "../src/lib/billing/service";
import { paystackSettings } from "../src/lib/billing/provider";
import {
  receivePaystack,
  paystackSignature,
  processBillingEvent,
} from "../src/lib/billing/events";
import { consumeQuota, claimEntitledRun } from "../src/lib/billing/quotas";
import {
  createWorkflow,
  publishWorkflow,
  enqueue,
  getRun,
} from "../src/lib/engine/service";
import { createConnection } from "../src/lib/integrations/service";
import { workflowState } from "../src/lib/webhooks/service";
import { EngineError, type WorkflowNode } from "../src/lib/engine/definition";
import { prepareAI } from "../src/lib/ai/prepare";
import { reserveAI, settleAI } from "../src/lib/ai/accounting";
import { mockModel } from "./ai-fixture";
import { executeGoogle } from "../src/lib/google/execute";
import { executeWhatsApp } from "../src/lib/whatsapp/execute";
import { connectWhatsApp, contactHash } from "../src/lib/whatsapp/service";
import { metaTest } from "./whatsapp-fixture";
import { billingFixture, billingTestKey } from "./billing-fixture";
import { installBillingFixture } from "./billing-fixture-preload.mjs";
const hasCode = (code: string) => (e: unknown) =>
  e instanceof EngineError && e.code === code;
test("Paystack TEST billing, durable verification and central entitlements (controlled TLS fixture)", async (t) => {
  const fixture = await billingFixture(),
    saved = { ...process.env };
  Object.assign(process.env, fixture.env);
  const restore = installBillingFixture(
      fixture.env.FLOW_BILLING_FIXTURE_PORT,
      fixture.env.FLOW_BILLING_FIXTURE_CA,
    ),
    users = [randomUUID(), randomUUID()],
    spaces: string[] = [];
  await db.user.createMany({
    data: users.map((id, i) => ({
      id,
      email: `billing-${id}@example.test`,
      name: `Billing ${i}`,
    })),
  });
  async function space() {
    const id = randomUUID();
    spaces.push(id);
    await db.workspace.create({
      data: {
        id,
        name: "Billing controlled test",
        members: {
          create: [
            { userId: users[0], role: "OWNER" },
            { userId: users[1], role: "VIEWER" },
          ],
        },
      },
    });
    return { workspaceId: id, userId: users[0] };
  }
  const actor = await space(),
    viewer = { ...actor, userId: users[1] };
  function limits(overrides: Record<string, number> = {}) {
    delete process.env.FLOWPILOT_BILLING_CATALOG_JSON;
    const plans = catalog();
    plans[0].limits = { ...plans[0].limits, ...overrides };
    process.env.FLOWPILOT_BILLING_CATALOG_JSON = JSON.stringify(plans);
  }
  async function checkout(a = actor, plan = "STARTER") {
    return initializeCheckout(a, { plan, interval: "monthly" }, randomUUID());
  }
  async function queued(a = actor) {
    const w = await createWorkflow(a, {
        name: "Quota workflow",
        definition: {
          schemaVersion: 1,
          nodes: [{ id: "start", type: "manual_trigger", config: {} }],
          edges: [],
        },
      }),
      v = await publishWorkflow(a, w.id, 1);
    return { workflow: w, version: v };
  }
  async function work(runId?: string) {
    const p = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        "./tests/billing-fixture-preload.mjs",
        "scripts/worker.ts",
        "--once",
        ...(runId ? ["--run-id", runId] : []),
      ],
      { env: { ...process.env, ...fixture.env }, stdio: "ignore" },
    );
    assert.equal(
      await new Promise<number | null>((r, j) => {
        p.once("exit", r);
        p.once("error", j);
      }),
      0,
    );
  }
  async function event(value: unknown) {
    const raw = Buffer.from(JSON.stringify(value));
    return receivePaystack(raw, paystackSignature(billingTestKey, raw));
  }
  let checkoutId = "",
    reference = "",
    subscriptionCode = "";
  try {
    await t.test(
      "configured proposals use NGN minor units, annual is separate and live keys are refused",
      () => {
        assert.equal(planFor("STARTER").monthly, 500000);
        assert.equal(planFor("BUSINESS").monthly, 1500000);
        assert.equal(planFor("PRO").monthly, 3500000);
        assert.equal(planFor("FREE").monthly, 0);
        assert.equal(planFor("STARTER").annually, null);
        assert.equal(
          paidPeriodEnd(
            new Date("2025-01-31T12:00:00Z"),
            "monthly",
          ).toISOString(),
          "2025-02-28T12:00:00.000Z",
        );
        process.env.PAYSTACK_SECRET_KEY = "sk_live_12345678901234567890";
        assert.throws(
          paystackSettings,
          hasCode("PAYSTACK_TEST_NOT_CONFIGURED"),
        );
        process.env.PAYSTACK_SECRET_KEY = billingTestKey;
      },
    );
    await t.test(
      "RBAC, missing membership and caller-supplied prices reject checkout",
      async () => {
        await assert.rejects(
          initializeCheckout(
            viewer,
            { plan: "STARTER", interval: "monthly" },
            randomUUID(),
          ),
          hasCode("FORBIDDEN"),
        );
        await assert.rejects(
          initializeCheckout(
            actor,
            { plan: "STARTER", interval: "monthly", amount: 1 },
            randomUUID(),
          ),
          hasCode("BILLING_CHECKOUT_BODY"),
        );
        await assert.rejects(
          initializeCheckout(
            { workspaceId: actor.workspaceId, userId: randomUUID() },
            { plan: "STARTER", interval: "monthly" },
            randomUUID(),
          ),
          hasCode("NOT_FOUND"),
        );
        await assert.rejects(
          initializeCheckout(
            actor,
            { plan: "STARTER", interval: "annually" },
            randomUUID(),
          ),
          hasCode("BILLING_PRICE_NOT_AVAILABLE"),
        );
      },
    );
    await t.test(
      "remote TEST plan amount/currency must match the immutable server proposal",
      async () => {
        fixture.setMode("PLAN_MISMATCH");
        await assert.rejects(
          checkout(),
          hasCode("BILLING_PROVIDER_PLAN_MISMATCH"),
        );
        fixture.setMode("OK");
        assert.equal(fixture.initCalls, 0);
      },
    );
    await t.test(
      "concurrent repeated checkout keys create one provider session, with encrypted URL",
      async () => {
        const key = randomUUID(),
          rows = await Promise.all([
            initializeCheckout(
              actor,
              { plan: "STARTER", interval: "monthly" },
              key,
            ),
            initializeCheckout(
              actor,
              { plan: "STARTER", interval: "monthly" },
              key,
            ),
          ]);
        assert.equal(rows[0].id, rows[1].id);
        checkoutId = rows[0].id;
        reference = rows[0].reference;
        assert.equal(fixture.initCalls, 1);
        const c = await db.billingCheckout.findUniqueOrThrow({
          where: { id: checkoutId },
        });
        assert.equal(c.status, "OPEN");
        assert.ok(
          c.urlCiphertext &&
            !c.urlCiphertext.includes("https://checkout.paystack.com"),
        );
        assert.equal((await checkout()).id, checkoutId);
        await assert.rejects(
          initializeCheckout(
            actor,
            { plan: "BUSINESS", interval: "monthly" },
            key,
          ),
          hasCode("BILLING_IDEMPOTENCY_CONFLICT"),
        );
      },
    );
    await t.test(
      "redirect and unverified charge events never activate unpaid subscription",
      async () => {
        assert.equal((await billingOverview(actor)).effectivePlan.code, "FREE");
        await reconcileCheckout(checkoutId);
        assert.equal((await billingOverview(actor)).effectivePlan.code, "FREE");
        await event({
          event: "charge.success",
          data: { reference, status: "pending" },
        });
        await processBillingEvent();
        assert.equal(
          await db.subscription.count({
            where: { workspaceId: actor.workspaceId },
          }),
          0,
        );
        const raw = Buffer.from("{}");
        await assert.rejects(
          receivePaystack(raw, "0".repeat(128)),
          hasCode("BILLING_SIGNATURE_INVALID"),
        );
      },
    );
    await t.test(
      "verified TEST payment activates a server-created tenant-bound subscription through real worker",
      async () => {
        fixture.pay(reference, new Date(Date.now() - 86400000));
        const payload = {
          event: "charge.success",
          data: fixture.transactions[reference],
        };
        await event(payload);
        await work();
        const s = await db.subscription.findUniqueOrThrow({
          where: { workspaceId: actor.workspaceId },
        });
        subscriptionCode = s.providerCode!;
        assert.equal(s.mode, "TEST");
        assert.equal(
          (await billingOverview(actor)).effectivePlan.code,
          "STARTER",
        );
        assert.equal(fixture.createCalls, 1);
        assert.ok(
          s.credentialCiphertext &&
            !s.credentialCiphertext.includes("fixture-cancellation-secret"),
        );
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          1,
        );
        const serialized = JSON.stringify(await billingOverview(actor));
        for (const sensitive of [
          billingTestKey,
          "AUTH_fixture_sensitive",
          "408408",
          "fixture-cancellation-secret",
          "email_token",
          "credentialCiphertext",
        ])
          assert.ok(!serialized.includes(sensitive));
      },
    );
    await t.test(
      "canonical duplicate events and out-of-order creation events do not extend access or duplicate payments",
      async () => {
        const before = await db.subscription.findUniqueOrThrow({
            where: { workspaceId: actor.workspaceId },
          }),
          payload = {
            event: "charge.success",
            data: fixture.transactions[reference],
          };
        await event(payload);
        await event({
          data: fixture.transactions[reference],
          event: "charge.success",
        });
        await processBillingEvent();
        await event({
          event: "subscription.create",
          data: { subscription_code: subscriptionCode },
        });
        await processBillingEvent();
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          1,
        );
        assert.equal(
          (
            await db.subscription.findUniqueOrThrow({
              where: { workspaceId: actor.workspaceId },
            })
          ).currentPeriodEnd?.getTime(),
          before.currentPeriodEnd?.getTime(),
        );
        assert.equal(fixture.createCalls, 1);
      },
    );
    await t.test(
      "unknown/unpaid provider subscriptions cannot select a workspace; foreign reconciliation is denied",
      async () => {
        await event({
          event: "subscription.create",
          data: {
            subscription_code: "SUB_unpaidfixture",
            metadata: { workspaceId: actor.workspaceId, plan: "PRO" },
          },
        });
        await processBillingEvent();
        assert.equal(
          (await billingOverview(actor)).effectivePlan.code,
          "STARTER",
        );
        const outside = await space();
        await assert.rejects(
          reconcileBilling(outside, { checkoutId }),
          hasCode("NOT_FOUND"),
        );
        await assert.rejects(
          cancelBilling(viewer, { revision: 1 }),
          hasCode("FORBIDDEN"),
        );
      },
    );
    await t.test(
      "verified payment amount, currency, customer and domain cannot be substituted",
      async () => {
        const a = await space(),
          c = await checkout(a);
        fixture.pay(c.reference);
        const tx = fixture.transactions[c.reference],
          original = { ...tx };
        for (const patch of [
          { amount: 1 },
          { currency: "USD" },
          { domain: "live" },
          {
            customer: {
              id: 1,
              customer_code: "CUS_wrongpayer",
              email: "other@example.test",
            },
          },
        ]) {
          Object.assign(tx, original, patch);
          await assert.rejects(
            reconcileCheckout(c.id),
            hasCode("BILLING_PAYMENT_NOT_VERIFIED"),
          );
          assert.equal((await billingOverview(a)).effectivePlan.code, "FREE");
        }
        Object.assign(tx, original);
      },
    );
    await t.test(
      "missing renewal events reconcile only verified invoice transactions, once",
      async () => {
        fixture.renew(subscriptionCode);
        const before = (
          await db.subscription.findUniqueOrThrow({
            where: { workspaceId: actor.workspaceId },
          })
        ).currentPeriodEnd!;
        await reconcileBilling(actor, {});
        const after = await db.subscription.findUniqueOrThrow({
          where: { workspaceId: actor.workspaceId },
        });
        assert.ok(after.currentPeriodEnd! > before);
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          2,
        );
        await reconcileBilling(actor, {});
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          2,
        );
      },
    );
    await t.test(
      "failed renewal has zero unpaid grace; delayed failed events use fresh provider state",
      async () => {
        const before = (
          await db.subscription.findUniqueOrThrow({
            where: { workspaceId: actor.workspaceId },
          })
        ).currentPeriodEnd!;
        fixture.renew(subscriptionCode, false);
        await event({
          event: "invoice.payment_failed",
          data: { subscription: { subscription_code: subscriptionCode } },
        });
        await processBillingEvent();
        assert.equal(
          (
            await db.subscription.findUniqueOrThrow({
              where: { workspaceId: actor.workspaceId },
            })
          ).status,
          "PAST_DUE",
        );
        assert.equal(
          (
            await db.subscription.findUniqueOrThrow({
              where: { workspaceId: actor.workspaceId },
            })
          ).currentPeriodEnd?.getTime(),
          before.getTime(),
        );
        fixture.subscriptions[subscriptionCode].status = "active";
        await event({
          event: "invoice.payment_failed",
          data: {
            subscription: { subscription_code: subscriptionCode },
            id: 999,
          },
        });
        await processBillingEvent();
        assert.equal(
          (
            await db.subscription.findUniqueOrThrow({
              where: { workspaceId: actor.workspaceId },
            })
          ).status,
          "ACTIVE",
        );
      },
    );
    await t.test(
      "cancellation keeps verified paid time, confirms provider disable and blocks overlapping paid-tier checkout",
      async () => {
        const s = await db.subscription.findUniqueOrThrow({
          where: { workspaceId: actor.workspaceId },
        });
        await cancelBilling(actor, { revision: s.revision });
        assert.equal(
          fixture.subscriptions[subscriptionCode].status,
          "non-renewing",
        );
        assert.equal(
          (await billingOverview(actor)).effectivePlan.code,
          "STARTER",
        );
        await assert.rejects(
          checkout(actor, "BUSINESS"),
          hasCode("BILLING_EXISTING_SUBSCRIPTION"),
        );
      },
    );
    await t.test(
      "expiry/downgrade preserves history and usage; a new paid tier can begin at the period boundary",
      async () => {
        await db.subscription.update({
          where: { workspaceId: actor.workspaceId },
          data: { currentPeriodEnd: new Date(Date.now() - 1000) },
        });
        assert.equal((await billingOverview(actor)).effectivePlan.code, "FREE");
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          2,
        );
        const c = await checkout(actor, "BUSINESS");
        fixture.pay(c.reference);
        await reconcileCheckout(c.id);
        assert.equal(
          (await billingOverview(actor)).effectivePlan.code,
          "BUSINESS",
        );
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: actor.workspaceId },
          }),
          3,
        );
        await event({
          event: "subscription.disable",
          data: { subscription_code: subscriptionCode, id: 777 },
        });
        await processBillingEvent();
        assert.equal(
          (await billingOverview(actor)).effectivePlan.code,
          "BUSINESS",
        );
      },
    );
    await t.test(
      "explicit annual amount uses its separate provider plan, with no inferred discount",
      async () => {
        const a = await space(),
          plans = catalog();
        plans.find((p) => p.code === "STARTER")!.annually = 6000000;
        process.env.FLOWPILOT_BILLING_CATALOG_JSON = JSON.stringify(plans);
        const c = await initializeCheckout(
          a,
          { plan: "STARTER", interval: "annually" },
          randomUUID(),
        );
        fixture.pay(c.reference);
        await reconcileCheckout(c.id);
        const s = await db.subscription.findUniqueOrThrow({
          where: { workspaceId: a.workspaceId },
        });
        assert.equal(s.interval, "annually");
        assert.equal(s.amountMinor, 6000000);
        assert.ok(s.currentPeriodEnd!.getTime() - Date.now() > 360 * 86400000);
        limits();
      },
    );
    await t.test(
      "unknown initialization and subscription creation are durable and never blindly repeated",
      async () => {
        const a = await space(),
          before = fixture.initCalls,
          key = randomUUID();
        fixture.setMode("INIT_UNKNOWN");
        await assert.rejects(
          initializeCheckout(a, { plan: "STARTER", interval: "monthly" }, key),
          hasCode("BILLING_CHECKOUT_UNKNOWN"),
        );
        await initializeCheckout(
          a,
          { plan: "STARTER", interval: "monthly" },
          key,
        );
        assert.equal(fixture.initCalls, before + 1);
        fixture.setMode("OK");
        const b = await space(),
          c = await checkout(b);
        fixture.pay(c.reference);
        fixture.setMode("CREATE_UNKNOWN");
        const creates = fixture.createCalls;
        await assert.rejects(
          reconcileCheckout(c.id),
          hasCode("BILLING_SUBSCRIPTION_CREATE_UNKNOWN"),
        );
        await reconcileCheckout(c.id);
        assert.equal(fixture.createCalls, creates + 1);
        assert.equal((await billingOverview(b)).effectivePlan.code, "FREE");
        fixture.setMode("OK");
      },
    );
    await t.test(
      "expired initial payments and changed remote plans cannot start an unintended recurring charge",
      async () => {
        const a = await space(),
          c = await checkout(a);
        fixture.pay(c.reference, new Date(Date.now() - 60 * 86400000));
        const before = fixture.createCalls;
        await reconcileCheckout(c.id);
        assert.equal(fixture.createCalls, before);
        assert.equal(
          (await db.billingCheckout.findUniqueOrThrow({ where: { id: c.id } }))
            .status,
          "PAID_REQUIRES_REVIEW",
        );
        assert.equal(
          await db.billingPayment.count({
            where: { workspaceId: a.workspaceId },
          }),
          1,
        );
        assert.equal((await billingOverview(a)).effectivePlan.code, "FREE");
        const b = await space(),
          d = await checkout(b);
        fixture.pay(d.reference);
        fixture.setMode("PLAN_MISMATCH");
        await assert.rejects(
          reconcileCheckout(d.id),
          hasCode("BILLING_PROVIDER_PLAN_MISMATCH"),
        );
        assert.equal(fixture.createCalls, before);
        fixture.setMode("OK");
        await reconcileCheckout(d.id);
        assert.equal((await billingOverview(b)).effectivePlan.code, "STARTER");
      },
    );
    await t.test(
      "concurrent workflow run admission consumes one allowance; duplicate keys and worker retries consume none",
      async () => {
        limits({ executions: 1 });
        const a = await space(),
          { workflow, version } = await queued(a),
          key = randomUUID();
        const results = await Promise.allSettled([
          enqueue(a, workflow.id, { versionId: version.id, input: {} }, key),
          enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          ),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const admitted = results.find(
          (r) => r.status === "fulfilled",
        ) as PromiseFulfilledResult<{ id: string }>;
        const row = await db.workflowRun.findUniqueOrThrow({
          where: { id: admitted.value.id },
        });
        await enqueue(
          a,
          workflow.id,
          { versionId: version.id, input: {} },
          row.idempotencyKey,
        );
        await work(row.id);
        await work(row.id);
        assert.equal((await getRun(a, row.id)).status, "SUCCEEDED");
        assert.equal(
          await db.quotaEntry.count({
            where: { workspaceId: a.workspaceId, metric: "executions" },
          }),
          1,
        );
        limits();
      },
    );
    await t.test(
      "workflow activation and integration creation enforce atomic centralized resource caps",
      async () => {
        const a = await space();
        limits({ activeWorkflows: 1, integrations: 1 });
        const w = await queued(a);
        await assert.rejects(queued(a), hasCode("PLAN_QUOTA_EXCEEDED"));
        await workflowState(a, w.workflow.id, {
          enabled: false,
          archived: false,
        });
        const other = await queued(a);
        await assert.rejects(
          workflowState(a, w.workflow.id, { enabled: true, archived: false }),
          hasCode("PLAN_QUOTA_EXCEEDED"),
        );
        assert.ok(other.workflow.id);
        const results = await Promise.allSettled([
          createConnection(a, { providerId: "gmail", label: "one" }),
          createConnection(a, { providerId: "google-sheets", label: "two" }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        limits();
      },
    );
    await t.test(
      "AI plan reservation and existing operator budget are independently enforced; actual settlement adjusts usage",
      async () => {
        const a = await space(),
          { workflow, version } = await queued(a),
          r = await enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          );
        await db.workflowRun.update({
          where: { id: r.id },
          data: { status: "RUNNING" },
        });
        Object.assign(process.env, {
          FLOWPILOT_AI_MODELS_JSON: JSON.stringify([mockModel]),
          FLOWPILOT_AI_DEFAULT_MODEL: "mock-model",
          FLOWPILOT_OPENAI_API_KEY: "fixture-ai-key",
          FLOWPILOT_AI_TEST_LABEL: "MOCK",
        });
        const n: WorkflowNode = {
            id: "ai",
            type: "ai_summarize",
            config: {
              modelId: "default",
              textPath: "text",
              maxOutputTokens: 256,
              length: "short",
            },
          },
          p = prepareAI(n, { text: "controlled source" });
        await assert.rejects(
          reserveAI(r.id, n.id, p),
          hasCode("AI_BUDGET_EXCEEDED"),
        );
        await db.aIWorkspaceBudget.upsert({
          where: { workspaceId: a.workspaceId },
          create: {
            workspaceId: a.workspaceId,
            dailyLimitMicros: 1000000n,
            monthlyLimitMicros: 1000000n,
          },
          update: { dailyLimitMicros: 1000000n, monthlyLimitMicros: 1000000n },
        });
        limits({ aiMicros: 0 });
        await assert.rejects(
          reserveAI(r.id, n.id, p),
          hasCode("PLAN_QUOTA_EXCEEDED"),
        );
        limits();
        const usage = await reserveAI(r.id, n.id, p);
        await settleAI(
          usage,
          {
            state: "SUCCEEDED",
            output: { summary: "MOCK" },
            usage: { input: 40, output: 20, total: 60, cachedInput: 0 },
          },
          { summary: "MOCK" },
        );
        assert.equal(
          (
            await db.quotaEntry.findFirstOrThrow({
              where: { workspaceId: a.workspaceId, metric: "aiMicros" },
            })
          ).amount,
          80n,
        );
      },
    );
    await t.test(
      "message quota blocks real Gmail dispatch before provider calls and survives monthly resets",
      async () => {
        const a = await space(),
          { workflow, version } = await queued(a),
          r = await enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          );
        await db.workflowRun.update({
          where: { id: r.id },
          data: { status: "RUNNING" },
        });
        limits({ messages: 0 });
        Object.assign(process.env, {
          GOOGLE_GMAIL_SEND_ENABLED: "true",
          GOOGLE_GMAIL_ALLOWED_RECIPIENTS: JSON.stringify([
            "fixture@example.test",
          ]),
        });
        await assert.rejects(
          executeGoogle(
            r.id,
            {
              id: "gmail",
              type: "gmail_send_email",
              config: {
                connectionId: randomUUID(),
                to: ["fixture@example.test"],
                subject: "Controlled",
                body: "Mock only",
              },
            },
            {},
            Date.now() + 5000,
          ),
          hasCode("PLAN_QUOTA_EXCEEDED"),
        );
        limits({ messages: 1 });
        await db.quotaEntry.create({
          data: {
            id: randomUUID(),
            workspaceId: a.workspaceId,
            metric: "messages",
            period: "2020-01",
            key: "previous-month",
            amount: 1n,
          },
        });
        await db.$transaction((tx) =>
          consumeQuota(tx, a.workspaceId, "messages", "current-month"),
        );
        await assert.rejects(
          db.$transaction((tx) =>
            consumeQuota(tx, a.workspaceId, "messages", "another-message"),
          ),
          hasCode("PLAN_QUOTA_EXCEEDED"),
        );
        limits();
      },
    );
    await t.test(
      "WhatsApp messaging admission cannot bypass the subscription message allowance",
      async () => {
        const a = await space();
        Object.assign(process.env, {
          META_WHATSAPP_DEVELOPER_ENABLED: "true",
          META_APP_ID: metaTest.appId,
          META_APP_SECRET: metaTest.secret,
          META_RECIPIENT_HASH_KEY: metaTest.hashKey,
          META_WEBHOOK_VERIFY_TOKEN: metaTest.verifyToken,
          META_GRAPH_API_VERSION: "v26.0",
          META_WHATSAPP_TEST_ASSETS: JSON.stringify([
            { messagingAccountId: metaTest.accountId, phoneNumberId: "300099" },
          ]),
          META_WHATSAPP_TEST_RECIPIENTS: JSON.stringify([metaTest.recipient]),
        });
        let sends = 0;
        const adapter = {
          verify: async () => ({
            name: "MOCK",
            phone: "15550009999",
            phoneName: "MOCK",
            expiresAt: new Date(Date.now() + 3600000),
          }),
          templates: async () => [],
          send: async () => {
            sends++;
            return { id: "wamid.should_not_send" };
          },
        };
        const i = await createConnection(a, {
            providerId: "whatsapp-business",
            label: "MOCK quota",
          }),
          c = await connectWhatsApp(
            a,
            i.id,
            {
              revision: i.revision,
              messagingAccountId: metaTest.accountId,
              phoneNumberId: "300099",
              accessToken: metaTest.token,
              dailyLimit: 20,
            },
            adapter,
          ),
          phone = await db.whatsAppPhone.findFirstOrThrow({
            where: { connectionId: c.id },
          });
        await db.whatsAppContact.create({
          data: {
            id: randomUUID(),
            workspaceId: a.workspaceId,
            phoneId: phone.id,
            recipientHash: contactHash(phone.id, metaTest.recipient),
            last4: "0001",
            lastInboundAt: new Date(),
          },
        });
        const { workflow, version } = await queued(a),
          r = await enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          );
        await db.workflowRun.update({
          where: { id: r.id },
          data: { status: "RUNNING" },
        });
        limits({ messages: 0 });
        await assert.rejects(
          executeWhatsApp(
            r.id,
            {
              id: "reply",
              type: "whatsapp_send_message",
              config: {
                connectionId: c.id,
                to: metaTest.recipient,
                body: "MOCK only",
              },
            },
            {},
            Date.now() + 5000,
            adapter,
          ),
          hasCode("PLAN_QUOTA_EXCEEDED"),
        );
        assert.equal(sends, 0);
        limits();
      },
    );
    await t.test(
      "concurrent claims respect the lease cap, pending jobs recover, and lease tenant substitution fails",
      async () => {
        const a = await space(),
          { workflow, version } = await queued(a),
          r1 = await enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          ),
          r2 = await enqueue(
            a,
            workflow.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          );
        limits({ concurrency: 1 });
        const results = await Promise.all([
          db.$transaction((tx) => claimEntitledRun(tx, r1.id)),
          db.$transaction((tx) => claimEntitledRun(tx, r2.id)),
        ]);
        assert.equal(results.filter(Boolean).length, 1);
        const active = results[0] ? r1 : r2,
          pending = results[0] ? r2 : r1;
        await work(pending.id);
        assert.equal((await getRun(a, pending.id)).status, "QUEUED");
        await db.workflowRun.update({
          where: { id: active.id },
          data: { status: "FAILED", error: "CONTROLLED_TEST_END" },
        });
        await db.executionLease.update({
          where: { runId: active.id },
          data: { releasedAt: new Date() },
        });
        await work(pending.id);
        assert.equal((await getRun(a, pending.id)).status, "SUCCEEDED");
        const other = await space();
        await assert.rejects(
          db.executionLease.update({
            where: { runId: pending.id },
            data: { workspaceId: other.workspaceId },
          }),
        );
        limits();
      },
    );
    await t.test(
      "financial audit and checkout snapshots are immutable and members receive metadata only",
      async () => {
        await assert.rejects(
          db.billingCheckout.update({
            where: { id: checkoutId },
            data: { amountMinor: 1 },
          }),
        );
        await assert.rejects(
          db.billingPayment.update({
            where: { reference },
            data: { amountMinor: 1 },
          }),
        );
        const entry = await db.billingAudit.findFirstOrThrow({
          where: { workspaceId: actor.workspaceId },
        });
        await assert.rejects(
          db.billingAudit.update({
            where: { id: entry.id },
            data: { code: "FAKE" },
          }),
        );
        const view = await billingOverview(viewer);
        assert.ok(view.payments.length >= 3);
        assert.ok(!JSON.stringify(view).includes("urlCiphertext"));
      },
    );
  } finally {
    restore();
    await fixture.close();
    await db.workspace.deleteMany({ where: { id: { in: spaces } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
    await db.$disconnect();
  }
});
