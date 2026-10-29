import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const metaTest = {
  appId: "100001",
  accountId: "200001",
  phoneId: "300001",
  recipient: "15550000001",
  token: "fixture-meta-access-token-not-real",
  secret: "fixture-meta-app-secret-not-real-123456",
  hashKey: "fixture-stable-recipient-hmac-not-real-123456",
  verifyToken: "fixture-meta-verify-token-not-real-123456",
};
export const approvedTemplate = {
  id: "400001",
  name: "order_update",
  language: "en_US",
  status: "APPROVED",
  category: "UTILITY",
  parameter_format: "POSITIONAL",
  components: [{ type: "BODY", text: "Your order {{1}} is ready." }],
};
export async function whatsappFixture() {
  const dir = mkdtempSync(join(tmpdir(), "flow-meta-"));
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
      "/CN=graph.facebook.com",
      "-addext",
      "subjectAltName=DNS:graph.facebook.com",
    ],
    { stdio: "ignore" },
  );
  let sends = 0,
    mode = "OK";
  const payloads: unknown[] = [];
  const server = https.createServer(
    {
      key: readFileSync(join(dir, "tls.key")),
      cert: readFileSync(join(dir, "tls.pem")),
    },
    async (req, res) => {
      const u = new URL(req.url!, "https://graph.facebook.com");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const reply = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (u.pathname === "/v26.0/debug_token") {
        const valid =
          u.searchParams.get("input_token") === metaTest.token &&
          req.headers.authorization ===
            `Bearer ${metaTest.appId}|${metaTest.secret}`;
        return reply(200, {
          data: {
            is_valid: valid,
            app_id: valid ? metaTest.appId : "999999",
            ...(mode === "MISSING_EXPIRY"
              ? {}
              : { expires_at: Math.floor(Date.now() / 1000) + 3600 }),
            granular_scopes: [
              {
                scope: "whatsapp_business_messaging",
                target_ids: [
                  mode === "BAD_SCOPE" ? "999999" : metaTest.accountId,
                ],
              },
            ],
            scopes: [
              "whatsapp_business_messaging",
              "whatsapp_business_management",
            ],
          },
        });
      }
      if (req.headers.authorization !== `Bearer ${metaTest.token}`)
        return reply(401, { error: { code: 190 } });
      if (u.pathname === `/v26.0/${metaTest.accountId}`)
        return reply(200, {
          id: metaTest.accountId,
          name: "MOCK Meta test business",
        });
      if (u.pathname === `/v26.0/${metaTest.accountId}/phone_numbers`)
        return reply(200, {
          data: [
            {
              id: metaTest.phoneId,
              display_phone_number: "15550009999",
              verified_name: "MOCK test phone",
            },
          ],
        });
      if (u.pathname === `/v26.0/${metaTest.accountId}/message_templates`)
        return reply(200, {
          data: [
            approvedTemplate,
            {
              ...approvedTemplate,
              id: "400002",
              name: "pending_order",
              status: "PENDING",
            },
            {
              ...approvedTemplate,
              id: "400003",
              name: "promo_update",
              category: "MARKETING",
            },
            {
              ...approvedTemplate,
              id: "400004",
              name: "photo_update",
              components: [
                { type: "HEADER", format: "IMAGE" },
                { type: "BODY", text: "Photo" },
              ],
            },
          ],
        });
      if (
        u.pathname === `/v26.0/${metaTest.phoneId}/messages` &&
        req.method === "POST"
      ) {
        sends++;
        payloads.push(body);
        if (mode === "HANG") return;
        if (mode === "OUTAGE") return reply(503, { error: { code: 2 } });
        if (mode === "RATE") return reply(429, { error: { code: 130429 } });
        if (mode === "REJECT") return reply(400, { error: { code: 131047 } });
        return reply(200, {
          messaging_product: "whatsapp",
          contacts: [{ input: metaTest.recipient, wa_id: metaTest.recipient }],
          messages: [{ id: `wamid.fixture_${sends}` }],
        });
      }
      return reply(404, { error: { code: 100 } });
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    env: {
      META_WHATSAPP_DEVELOPER_ENABLED: "true",
      META_APP_ID: metaTest.appId,
      META_APP_SECRET: metaTest.secret,
      META_RECIPIENT_HASH_KEY: metaTest.hashKey,
      META_WEBHOOK_VERIFY_TOKEN: metaTest.verifyToken,
      META_GRAPH_API_VERSION: "v26.0",
      META_WHATSAPP_TEST_ASSETS: JSON.stringify([
        {
          messagingAccountId: metaTest.accountId,
          phoneNumberId: metaTest.phoneId,
        },
      ]),
      META_WHATSAPP_TEST_RECIPIENTS: JSON.stringify([metaTest.recipient]),
      META_TEST_LABEL: "MOCK",
      HTTP_ACTION_ALLOWED_ORIGINS: JSON.stringify([
        "https://graph.facebook.com",
      ]),
      FLOW_META_FIXTURE_PORT: String(port),
      FLOW_META_FIXTURE_CA: join(dir, "tls.pem"),
    },
    get sends() {
      return sends;
    },
    payloads,
    setMode(value: string) {
      mode = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function inboundMeta(
  id: string,
  text = "Hello",
  at = Date.now(),
  phoneId = metaTest.phoneId,
  accountId = metaTest.accountId,
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: accountId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneId },
              messages: [
                {
                  id: `wamid.${id}`,
                  from: metaTest.recipient,
                  timestamp: String(Math.floor(at / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
export function statusMeta(
  id: string,
  state: string,
  at = Date.now(),
  correlation?: string,
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: metaTest.accountId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: metaTest.phoneId },
              statuses: [
                {
                  id,
                  status: state,
                  timestamp: String(Math.floor(at / 1000)),
                  recipient_id: metaTest.recipient,
                  ...(correlation
                    ? { biz_opaque_callback_data: correlation }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
