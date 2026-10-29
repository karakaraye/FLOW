import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paidPeriodEnd, type Interval } from "../src/lib/billing/config";
export const billingTestKey = "sk_test_fixture0000000000000000000000000000";
export async function billingFixture() {
  const dir = mkdtempSync(join(tmpdir(), "flow-billing-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "tls.key"),
      "-out",
      join(dir, "tls.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=api.paystack.co",
      "-addext",
      "subjectAltName=DNS:api.paystack.co",
    ],
    { stdio: "ignore" },
  );
  const plans: Record<string, Record<string, unknown>> = {
    PLN_startermonthly: {
      id: 1,
      plan_code: "PLN_startermonthly",
      domain: "test",
      amount: 500000,
      currency: "NGN",
      interval: "monthly",
    },
    PLN_businessmonthly: {
      id: 2,
      plan_code: "PLN_businessmonthly",
      domain: "test",
      amount: 1500000,
      currency: "NGN",
      interval: "monthly",
    },
    PLN_promonthly: {
      id: 3,
      plan_code: "PLN_promonthly",
      domain: "test",
      amount: 3500000,
      currency: "NGN",
      interval: "monthly",
    },
    PLN_starterannual: {
      id: 4,
      plan_code: "PLN_starterannual",
      domain: "test",
      amount: 6000000,
      currency: "NGN",
      interval: "annually",
    },
  };
  const transactions: Record<string, Record<string, unknown>> = {},
    subscriptions: Record<string, Record<string, unknown>> = {},
    customers: Record<
      string,
      { id: number; email: string; customer_code: string }
    > = {};
  let txId = 100,
    subId = 0,
    initCalls = 0,
    createCalls = 0,
    mode = "OK";
  const customer = (email: string) =>
    (customers[email] ??= {
      id: Object.keys(customers).length + 1,
      email,
      customer_code: `CUS_fixture${Object.keys(customers).length + 1}`,
    });
  const server = https.createServer(
    {
      key: readFileSync(join(dir, "tls.key")),
      cert: readFileSync(join(dir, "tls.pem")),
    },
    async (req, res) => {
      const u = new URL(req.url!, "https://api.paystack.co");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const reply = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: status === 200, data }));
      };
      if (req.headers.authorization !== `Bearer ${billingTestKey}`)
        return reply(401, {});
      if (u.pathname.startsWith("/plan/")) {
        const p = plans[u.pathname.split("/").at(-1)!];
        return reply(
          p ? 200 : 404,
          mode === "PLAN_MISMATCH" ? { ...p, amount: 1 } : p,
        );
      }
      if (u.pathname === "/transaction/initialize" && req.method === "POST") {
        initCalls++;
        const c = customer(body.email);
        transactions[body.reference] = {
          id: ++txId,
          domain: "test",
          reference: body.reference,
          status: "pending",
          amount: body.amount,
          currency: body.currency,
          customer: c,
          authorization: {
            authorization_code: "AUTH_fixture_sensitive" + c.id,
            reusable: true,
            bin: "408408",
            last4: "4081",
          },
        };
        if (mode === "INIT_UNKNOWN") return reply(503, {});
        return reply(200, {
          authorization_url: `https://checkout.paystack.com/fixture${txId}`,
          access_code: `fixture${txId}`,
          reference: body.reference,
        });
      }
      if (u.pathname.startsWith("/transaction/verify/")) {
        const t = transactions[u.pathname.split("/").at(-1)!];
        return reply(t ? 200 : 404, t);
      }
      if (/^\/transaction\/\d+$/.test(u.pathname)) {
        const t = Object.values(transactions).find(
          (t) => String(t.id) === u.pathname.split("/").at(-1),
        );
        return reply(t ? 200 : 404, t);
      }
      if (u.pathname === "/subscription" && req.method === "POST") {
        createCalls++;
        const c = Object.values(customers).find(
            (c) => c.customer_code === body.customer,
          ),
          plan = plans[body.plan];
        if (!c || !plan) return reply(400, {});
        const code = `SUB_fixture${++subId}`;
        subscriptions[code] = {
          id: subId,
          subscription_code: code,
          customer: c,
          plan,
          domain: "test",
          amount: plan.amount,
          status: "active",
          email_token: "fixture-cancellation-secret-" + subId,
          next_payment_date: body.start_date,
          invoices: [],
        };
        if (mode === "CREATE_UNKNOWN") return reply(503, {});
        return reply(200, subscriptions[code]);
      }
      if (u.pathname === "/subscription/disable" && req.method === "POST") {
        const s = subscriptions[body.code];
        if (!s || s.email_token !== body.token) return reply(400, {});
        s.status = "non-renewing";
        return reply(200, {});
      }
      if (u.pathname.startsWith("/subscription/")) {
        const s = subscriptions[u.pathname.split("/").at(-1)!];
        return reply(s ? 200 : 404, s);
      }
      return reply(404, {});
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    env: {
      PAYSTACK_TEST_ENABLED: "true",
      PAYSTACK_SECRET_KEY: billingTestKey,
      PAYSTACK_TEST_LABEL: "MOCK",
      PAYSTACK_TEST_PLAN_CODES_JSON: JSON.stringify({
        STARTER: {
          monthly: "PLN_startermonthly",
          annually: "PLN_starterannual",
        },
        BUSINESS: { monthly: "PLN_businessmonthly" },
        PRO: { monthly: "PLN_promonthly" },
      }),
      HTTP_ACTION_ALLOWED_ORIGINS: JSON.stringify(["https://api.paystack.co"]),
      FLOW_BILLING_FIXTURE_PORT: String(port),
      FLOW_BILLING_FIXTURE_CA: join(dir, "tls.pem"),
    },
    transactions,
    subscriptions,
    get initCalls() {
      return initCalls;
    },
    get createCalls() {
      return createCalls;
    },
    setMode(v: string) {
      mode = v;
    },
    pay(reference: string, at = new Date()) {
      const t = transactions[reference];
      if (!t) throw Error("No fixture reference");
      t.status = "success";
      t.paid_at = at.toISOString();
    },
    renew(code: string, success = true, reference = `renewal_${++txId}`) {
      const s = subscriptions[code];
      if (!s) throw Error("No fixture subscription");
      const now = new Date(),
        end = paidPeriodEnd(
          now,
          (s.plan as Record<string, unknown>).interval as Interval,
        ),
        c = s.customer;
      transactions[reference] = {
        id: ++txId,
        reference,
        domain: "test",
        status: success ? "success" : "failed",
        amount: s.amount,
        currency: "NGN",
        customer: c,
        paid_at: now.toISOString(),
      };
      const invoice = {
        domain: "test",
        amount: s.amount,
        paid: success,
        status: success ? "success" : "failed",
        period_start: now.toISOString(),
        period_end: end.toISOString(),
        transaction: { reference },
        invoice_code: `INV_fixture${txId}`,
      };
      s.status = success ? "active" : "attention";
      s.most_recent_invoice = invoice;
      (s.invoices as unknown[]).push(invoice);
      return reference;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
