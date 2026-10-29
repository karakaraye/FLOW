import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../src/lib/db";
import { createConnection } from "../src/lib/integrations/service";
import {
  createWorkflow,
  publishWorkflow,
  enqueue,
  getRun,
} from "../src/lib/engine/service";
import {
  validateDefinition,
  EngineError,
  type WorkflowNode,
  type Definition,
  type Json,
} from "../src/lib/engine/definition";
import {
  connectWhatsApp,
  manageWhatsApp,
  templatesWhatsApp,
  whatsappOverview,
  contactHash,
} from "../src/lib/whatsapp/service";
import { metaAdapter, parseTemplate } from "../src/lib/whatsapp/provider";
import { executeWhatsApp } from "../src/lib/whatsapp/execute";
import {
  receiveMeta,
  processMetaEvent,
  metaSignature,
  challengeMeta,
  deriveStatus,
  parseMetaEvents,
} from "../src/lib/whatsapp/webhooks";
import {
  whatsappFixture,
  metaTest,
  inboundMeta,
  statusMeta,
  approvedTemplate,
} from "./whatsapp-fixture";
import { installWhatsAppFixture } from "./whatsapp-fixture-preload.mjs";
function child(env: Record<string, string>, runId?: string) {
  return spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./tests/whatsapp-fixture-preload.mjs",
      "scripts/worker.ts",
      ...(runId ? ["--once", "--run-id", runId] : ["--once"]),
    ],
    { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
  );
}
async function exited(p: ChildProcess) {
  return new Promise<number | null>((r, j) => {
    p.on("exit", r);
    p.on("error", j);
  });
}
function code(c: string) {
  return (e: unknown) => e instanceof EngineError && e.code === c;
}
test("WhatsApp official adapter, durable events and messaging policy (MOCK; no real recipients)", async (t) => {
  const fixture = await whatsappFixture(),
    old = { ...process.env };
  Object.assign(process.env, fixture.env);
  const restore = installWhatsAppFixture(
    fixture.env.FLOW_META_FIXTURE_PORT,
    fixture.env.FLOW_META_FIXTURE_CA,
  );
  const ids = [randomUUID(), randomUUID(), randomUUID()],
    wid = randomUUID(),
    other = randomUUID();
  await db.user.createMany({
    data: ids.map((id, i) => ({
      id,
      email: `wa-${id}@example.test`,
      name: `WA ${i}`,
    })),
  });
  await db.workspace.create({
    data: {
      id: wid,
      name: "WA test",
      members: {
        create: [
          { userId: ids[0], role: "OWNER" },
          { userId: ids[1], role: "VIEWER" },
        ],
      },
    },
  });
  await db.workspace.create({
    data: {
      id: other,
      name: "Other",
      members: { create: { userId: ids[2], role: "OWNER" } },
    },
  });
  const actor = { workspaceId: wid, userId: ids[0] },
    viewer = { workspaceId: wid, userId: ids[1] },
    outsider = { workspaceId: other, userId: ids[2] };
  let connectionId = "",
    phoneId = "",
    integrationId = "";
  const body = {
    revision: 1,
    messagingAccountId: metaTest.accountId,
    phoneNumberId: metaTest.phoneId,
    accessToken: metaTest.token,
    dailyLimit: 20,
  };
  async function incoming(payload: unknown) {
    const raw = Buffer.from(JSON.stringify(payload));
    return receiveMeta(raw, metaSignature(metaTest.secret, raw));
  }
  async function makeRun(
    node: WorkflowNode,
    input: Json = {},
    name = "WA send",
  ) {
    const definition: Definition = {
      schemaVersion: 1,
      nodes: [{ id: "start", type: "manual_trigger", config: {} }, node],
      edges: [{ from: "start", to: node.id }],
    };
    const w = await createWorkflow(actor, { name, definition }),
      v = await publishWorkflow(actor, w.id, 1),
      r = await enqueue(actor, w.id, { versionId: v.id, input }, randomUUID());
    return { ...r, workflowId: w.id, versionId: v.id };
  }
  const textNode = (): WorkflowNode => ({
    id: "reply",
    type: "whatsapp_send_message",
    config: {
      connectionId,
      to: metaTest.recipient,
      body: "Controlled fixture text",
    },
  });
  const templateNode = (id = "400001"): WorkflowNode => ({
    id: "template",
    type: "whatsapp_send_template",
    config: {
      connectionId,
      to: metaTest.recipient,
      templateId: id,
      language: "en_US",
      parameters: ["123"],
      parameterPaths: [""],
    },
  });
  async function clearRate() {
    await db.whatsAppMessage.updateMany({
      where: { workspaceId: wid },
      data: { createdAt: new Date(Date.now() - 120000) },
    });
  }
  try {
    await t.test(
      "strict builder/node validation rejects arbitrary URLs, malformed recipients and extra permissions",
      () => {
        assert.throws(() =>
          validateDefinition({
            schemaVersion: 1,
            nodes: [
              {
                id: "start",
                type: "whatsapp_message_received",
                config: { connectionId: "test", phoneNumberId: "bad" },
              },
            ],
            edges: [],
          }),
        );
        assert.equal(
          parseTemplate({ ...approvedTemplate, category: "MARKETING" })
            ?.supported,
          false,
        );
        assert.equal(
          parseTemplate({
            ...approvedTemplate,
            components: [{ type: "BODY", text: "{{name}}" }],
          })?.supported,
          false,
        );
        assert.throws(() =>
          parseMetaEvents(inboundMeta("future", "hello", Date.now() + 900000)),
        );
        assert.equal(deriveStatus("READ", "SENT"), "READ");
        assert.equal(deriveStatus("DELIVERED", "FAILED"), "DELIVERED");
      },
    );
    await t.test(
      "invalid tokens and unauthorized phone assets never connect",
      async () => {
        const metadata = await createConnection(actor, {
          providerId: "whatsapp-business",
          label: "Controlled test",
        });
        integrationId = metadata.id;
        await assert.rejects(
          connectWhatsApp(actor, integrationId, {
            ...body,
            accessToken: "invalid-token-not-real-123456",
          }),
          code("WHATSAPP_VERIFICATION_FAILED"),
        );
        assert.equal(
          (
            await db.workspaceIntegration.findUniqueOrThrow({
              where: { id: integrationId },
            })
          ).status,
          "DISCONNECTED",
        );
        await assert.rejects(
          metaAdapter.verify(metaTest.token, metaTest.accountId, "999999"),
        );
        for (const mode of ["BAD_SCOPE", "MISSING_EXPIRY"]) {
          fixture.setMode(mode);
          await assert.rejects(
            connectWhatsApp(actor, integrationId, body),
            code("WHATSAPP_VERIFICATION_FAILED"),
          );
        }
        fixture.setMode("OK");
        const verified = await connectWhatsApp(actor, integrationId, body);
        connectionId = verified.id;
        const p = await db.whatsAppPhone.findFirstOrThrow({
          where: { connectionId },
        });
        phoneId = p.id;
        assert.equal(verified.mode, "MOCK");
        assert.equal(verified.status, "CONNECTED");
        const cred = await db.integrationCredential.findUniqueOrThrow({
          where: { integrationId },
        });
        assert.ok(!cred.ciphertext.includes(metaTest.token));
      },
    );
    await t.test(
      "server RBAC, workspace isolation, asset binding and credential redaction",
      async () => {
        await assert.rejects(
          connectWhatsApp(viewer, integrationId, { ...body, revision: 2 }),
          code("FORBIDDEN"),
        );
        await assert.rejects(
          connectWhatsApp(outsider, integrationId, { ...body, revision: 2 }),
          code("NOT_FOUND"),
        );
        await assert.rejects(
          manageWhatsApp(viewer, {
            action: "consent",
            phoneId,
            recipient: metaTest.recipient,
            decision: "GRANT",
            source: "test",
          }),
          code("FORBIDDEN"),
        );
        await assert.rejects(
          manageWhatsApp(outsider, {
            action: "consent",
            phoneId,
            recipient: metaTest.recipient,
            decision: "GRANT",
            source: "test",
          }),
        );
        const d = JSON.stringify(await whatsappOverview(actor));
        assert.ok(!d.includes(metaTest.token));
        assert.ok(!d.includes(metaTest.secret));
        assert.ok(!d.includes(metaTest.recipient));
      },
    );
    await t.test(
      "challenge and raw-body signatures; invalid, unknown and cross-account payloads rejected",
      async () => {
        assert.equal(
          challengeMeta(
            new URL(
              `https://example.com/?hub.mode=subscribe&hub.verify_token=${metaTest.verifyToken}&hub.challenge=12345`,
            ),
          ),
          "12345",
        );
        assert.throws(() =>
          challengeMeta(
            new URL(
              "https://example.com/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
            ),
          ),
        );
        const raw = Buffer.from(
          JSON.stringify(inboundMeta("invalid-signature")),
        );
        await assert.rejects(
          receiveMeta(raw, "sha256=" + "0".repeat(64)),
          code("WHATSAPP_SIGNATURE_INVALID"),
        );
        await assert.rejects(
          incoming(inboundMeta("unknown", "hello", Date.now(), "999999")),
          code("WHATSAPP_WEBHOOK_CONNECTION_DENIED"),
        );
        await assert.rejects(
          incoming(
            inboundMeta(
              "wrong-account",
              "hello",
              Date.now(),
              metaTest.phoneId,
              "999999",
            ),
          ),
          code("WHATSAPP_WEBHOOK_CONNECTION_DENIED"),
        );
      },
    );
    let triggerWorkflow = "",
      triggerVersion = "";
    await t.test(
      "published incoming workflow binding, durable duplicate events and real-worker recovery",
      async () => {
        const d: Definition = {
          schemaVersion: 1,
          nodes: [
            {
              id: "incoming",
              type: "whatsapp_message_received",
              config: { connectionId, phoneNumberId: metaTest.phoneId },
            },
            {
              id: "log",
              type: "log_event",
              config: { message: "Internal event" },
            },
          ],
          edges: [{ from: "incoming", to: "log" }],
        };
        const w = await createWorkflow(actor, {
          name: "Incoming test",
          definition: d,
        });
        triggerWorkflow = w.id;
        const v = await publishWorkflow(actor, w.id, 1);
        triggerVersion = v.id;
        await assert.rejects(
          enqueue(actor, w.id, { versionId: v.id, input: {} }, randomUUID()),
          code("WEBHOOK_ONLY"),
        );
        await assert.rejects(
          db.workflowVersion.update({
            where: { id: v.id },
            data: { definition: { changed: true } },
          }),
        );
        await manageWhatsApp(actor, {
          action: "subscribe",
          connectionId,
          phoneId,
          versionId: v.id,
        });
        assert.equal(
          (await incoming(inboundMeta("durable-inbound"))).accepted,
          1,
        );
        assert.equal(
          (await incoming(inboundMeta("durable-inbound"))).accepted,
          0,
        );
        assert.equal(await exited(child(fixture.env)), 0); // actual child drains the persisted event
        const delivery = await db.whatsAppEventRun.findFirstOrThrow({
          where: { workspaceId: wid },
        });
        assert.equal(await exited(child(fixture.env, delivery.runId)), 0);
        const run = await getRun(actor, delivery.runId);
        assert.equal(run.status, "SUCCEEDED");
        assert.equal(run.nodes.length, 2);
        assert.ok(
          !(
            await db.workflowRun.findUniqueOrThrow({
              where: { id: delivery.runId },
            })
          ).payload,
        );
      },
    );
    await t.test(
      "permitted service reply is accepted once; provider identity stored, not delivery fabricated",
      async () => {
        const r = await makeRun(textNode());
        const before = fixture.sends;
        const workers = [child(fixture.env, r.id), child(fixture.env, r.id)];
        assert.deepEqual(await Promise.all(workers.map(exited)), [0, 0]);
        assert.equal(fixture.sends, before + 1);
        assert.equal((await getRun(actor, r.id)).status, "SUCCEEDED");
        const message = await db.whatsAppMessage.findUniqueOrThrow({
          where: { runId_nodeId: { runId: r.id, nodeId: "reply" } },
        });
        assert.equal(message.state, "ACCEPTED");
        assert.match(message.providerMessageId!, /^wamid\./);
        const payload = fixture.payloads.at(-1) as Record<string, unknown>;
        assert.equal(payload.messaging_account_id, metaTest.accountId);
        assert.equal(payload.to, metaTest.recipient);
        assert.equal(
          await db.whatsAppAttempt.count({ where: { messageId: message.id } }),
          1,
        );
        await assert.rejects(
          executeWhatsApp(r.id, textNode(), {}, Date.now() + 5000),
        );
        const redacted = JSON.stringify(await getRun(actor, r.id));
        assert.ok(!redacted.includes("Controlled fixture text"));
        assert.ok(!redacted.includes(metaTest.token));
      },
    );
    await t.test(
      "closed service window, missing template consent and unapproved templates blocked",
      async () => {
        await clearRate();
        await db.whatsAppContact.updateMany({
          where: { phoneId },
          data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
        });
        let r = await makeRun(textNode());
        await exited(child(fixture.env, r.id));
        assert.equal(
          (await getRun(actor, r.id)).error,
          "WHATSAPP_WINDOW_CLOSED",
        );
        r = await makeRun(templateNode());
        await exited(child(fixture.env, r.id));
        assert.equal(
          (await getRun(actor, r.id)).error,
          "WHATSAPP_CONSENT_REQUIRED",
        );
        const templates = await templatesWhatsApp(actor, connectionId);
        assert.equal(templates.length, 4);
        r = await makeRun(templateNode("400002"));
        await exited(child(fixture.env, r.id));
        assert.equal(
          (await getRun(actor, r.id)).error,
          "WHATSAPP_TEMPLATE_NOT_APPROVED",
        );
      },
    );
    let acceptedProvider = "",
      acceptedMessage = "";
    await t.test(
      "explicit utility consent permits a fresh provider-approved positional template",
      async () => {
        await clearRate();
        await manageWhatsApp(actor, {
          action: "consent",
          phoneId,
          recipient: metaTest.recipient,
          decision: "GRANT",
          source: "MOCK explicit consent evidence #1",
        });
        const r = await makeRun(templateNode());
        await exited(child(fixture.env, r.id));
        assert.equal((await getRun(actor, r.id)).status, "SUCCEEDED");
        const m = await db.whatsAppMessage.findUniqueOrThrow({
          where: { runId_nodeId: { runId: r.id, nodeId: "template" } },
        });
        acceptedProvider = m.providerMessageId!;
        acceptedMessage = m.id;
      },
    );
    await t.test(
      "duplicate and out-of-order status receipts retain audit and derive non-regressing delivery",
      async () => {
        const now = Date.now();
        await incoming(statusMeta(acceptedProvider, "read", now));
        await processMetaEvent();
        await incoming(statusMeta(acceptedProvider, "delivered", now - 1000));
        await processMetaEvent();
        await incoming(statusMeta(acceptedProvider, "sent", now - 2000));
        await processMetaEvent();
        assert.equal(
          (await incoming(statusMeta(acceptedProvider, "read", now))).accepted,
          0,
        );
        assert.equal(
          (
            await db.whatsAppMessage.findUniqueOrThrow({
              where: { id: acceptedMessage },
            })
          ).state,
          "READ",
        );
        assert.equal(
          await db.whatsAppStatus.count({
            where: { messageId: acceptedMessage },
          }),
          3,
        );
        await incoming(statusMeta("wamid.unknown-message", "delivered"));
        await processMetaEvent();
        assert.equal(
          await db.whatsAppEvent.count({
            where: { workspaceId: wid, state: "UNMATCHED" },
          }),
          1,
        );
      },
    );
    await t.test(
      "opt-out suppresses both message types; incoming messages do not silently regrant consent",
      async () => {
        await incoming(inboundMeta("stop", "STOP"));
        await processMetaEvent();
        await incoming(inboundMeta("after-stop", "Hello again"));
        await processMetaEvent();
        const contact = await db.whatsAppContact.findUniqueOrThrow({
          where: {
            phoneId_recipientHash: {
              phoneId,
              recipientHash: contactHash(phoneId, metaTest.recipient),
            },
          },
        });
        assert.ok(contact.optedOutAt);
        assert.equal(contact.consentAt, null);
        const r = await makeRun(textNode());
        await exited(child(fixture.env, r.id));
        assert.equal((await getRun(actor, r.id)).error, "WHATSAPP_SUPPRESSED");
        await manageWhatsApp(actor, {
          action: "consent",
          phoneId,
          recipient: metaTest.recipient,
          decision: "GRANT",
          source: "MOCK renewed authorization",
        });
      },
    );
    await t.test(
      "definitive failures are recorded; explicit rate rejections retry at most three times",
      async () => {
        await clearRate();
        fixture.setMode("REJECT");
        let r = await makeRun(textNode());
        await exited(child(fixture.env, r.id));
        assert.equal(
          (await getRun(actor, r.id)).error,
          "WHATSAPP_PROVIDER_REJECTED",
        );
        await clearRate();
        fixture.setMode("RATE");
        r = await makeRun(textNode());
        const before = fixture.sends;
        await exited(child(fixture.env, r.id));
        assert.equal(fixture.sends, before + 3);
        assert.equal(
          await db.whatsAppAttempt.count({
            where: { message: { runId: r.id } },
          }),
          3,
        );
      },
    );
    await t.test(
      "ambiguous outages are UNKNOWN and never automatically resent",
      async () => {
        await clearRate();
        fixture.setMode("OUTAGE");
        const r = await makeRun(textNode()),
          before = fixture.sends;
        await exited(child(fixture.env, r.id));
        assert.equal(fixture.sends, before + 1);
        assert.equal(
          (
            await db.whatsAppMessage.findFirstOrThrow({
              where: { runId: r.id },
            })
          ).state,
          "UNKNOWN",
        );
        await exited(child(fixture.env, r.id));
        assert.equal(fixture.sends, before + 1);
        const uncertain = await db.whatsAppMessage.findFirstOrThrow({
          where: { runId: r.id },
        });
        await clearRate();
        const blocked = await makeRun(textNode());
        await exited(child(fixture.env, blocked.id));
        assert.equal(
          (await getRun(actor, blocked.id)).error,
          "WHATSAPP_UNCERTAIN_RECIPIENT_REVIEW_REQUIRED",
        );
        await assert.rejects(
          manageWhatsApp(viewer, {
            action: "review-unknown",
            messageId: uncertain.id,
            acknowledgeNoAutomaticResend: true,
          }),
          code("FORBIDDEN"),
        );
        await manageWhatsApp(actor, {
          action: "review-unknown",
          messageId: uncertain.id,
          acknowledgeNoAutomaticResend: true,
        });
        assert.equal(
          (
            await db.whatsAppMessage.findUniqueOrThrow({
              where: { id: uncertain.id },
            })
          ).state,
          "UNKNOWN",
        );
      },
    );
    await t.test(
      "SIGKILL after dispatch recovers as UNKNOWN without resend; signed correlated receipt reconciles",
      async () => {
        await clearRate();
        fixture.setMode("HANG");
        const r = await makeRun(textNode()),
          before = fixture.sends,
          p = child(fixture.env, r.id);
        for (let i = 0; i < 100 && fixture.sends === before; i++)
          await sleep(50);
        assert.equal(fixture.sends, before + 1);
        p.kill("SIGKILL");
        await exited(p);
        fixture.setMode("OK");
        await exited(child(fixture.env, r.id));
        const m = await db.whatsAppMessage.findFirstOrThrow({
          where: { runId: r.id },
        });
        assert.equal(m.state, "UNKNOWN");
        assert.equal(fixture.sends, before + 1);
        await incoming(
          statusMeta("wamid.reconciled-worker", "delivered", Date.now(), m.id),
        );
        await processMetaEvent();
        assert.equal(
          (await db.whatsAppMessage.findUniqueOrThrow({ where: { id: m.id } }))
            .state,
          "DELIVERED",
        );
      },
    );
    await t.test(
      "cross-workspace send binding and malformed parameters cannot dispatch",
      async () => {
        await clearRate();
        fixture.setMode("OK");
        const foreign = await createWorkflow(outsider, {
            name: "Foreign send",
            definition: {
              schemaVersion: 1,
              nodes: [
                { id: "start", type: "manual_trigger", config: {} },
                textNode(),
              ],
              edges: [{ from: "start", to: "reply" }],
            },
          }),
          version = await publishWorkflow(outsider, foreign.id, 1),
          run = await enqueue(
            outsider,
            foreign.id,
            { versionId: version.id, input: {} },
            randomUUID(),
          ),
          before = fixture.sends;
        await exited(child(fixture.env, run.id));
        assert.equal(
          (await getRun(outsider, run.id)).error,
          "WHATSAPP_CONNECTION_UNAVAILABLE",
        );
        assert.equal(fixture.sends, before);
        const n = templateNode();
        n.config.parameterPaths = ["missing.path"];
        const invalid = await makeRun(n);
        await exited(child(fixture.env, invalid.id));
        assert.equal(
          (await getRun(actor, invalid.id)).error,
          "WHATSAPP_PARAMETERS",
        );
        assert.equal(fixture.sends, before);
      },
    );
    await t.test(
      "unsupported media is audited without pretending to process contents",
      async () => {
        const payload = inboundMeta("unsupported-media");
        const message = payload.entry[0].changes[0].value
          .messages[0] as unknown as Record<string, unknown>;
        message.type = "image";
        delete message.text;
        message.image = { id: "untrusted-media-id", mime_type: "image/jpeg" };
        await incoming(payload);
        await processMetaEvent();
        assert.equal(
          (
            await db.whatsAppEvent.findFirstOrThrow({
              where: {
                workspaceId: wid,
                providerId: "wamid.unsupported-media",
              },
            })
          ).state,
          "UNSUPPORTED",
        );
      },
    );
    await t.test(
      "short TLS timeout is UNKNOWN; independent App Secret rotation preserves suppressions",
      async () => {
        await clearRate();
        fixture.setMode("HANG");
        const r = await makeRun(textNode());
        await db.workflowRun.update({
          where: { id: r.id },
          data: { status: "RUNNING", startedAt: new Date() },
        });
        const before = fixture.sends;
        await assert.rejects(
          executeWhatsApp(r.id, textNode(), {}, Date.now() + 500),
          code("WHATSAPP_OUTCOME_UNKNOWN"),
        );
        assert.equal(fixture.sends, before + 1);
        const message = await db.whatsAppMessage.findFirstOrThrow({
          where: { runId: r.id },
        });
        assert.equal(message.state, "UNKNOWN");
        await manageWhatsApp(actor, {
          action: "review-unknown",
          messageId: message.id,
          acknowledgeNoAutomaticResend: true,
        });
        const hash = contactHash(phoneId, metaTest.recipient),
          secret = process.env.META_APP_SECRET;
        process.env.META_APP_SECRET = "different-test-app-secret-rotation";
        assert.equal(contactHash(phoneId, metaTest.recipient), hash);
        process.env.META_APP_SECRET = secret;
        fixture.setMode("OK");
      },
    );
    await t.test(
      "workspace send ceiling is atomic across distinct worker jobs",
      async () => {
        await clearRate();
        await db.whatsAppConnection.update({
          where: { id: connectionId },
          data: { dailyLimit: 1 },
        });
        await db.whatsAppMessage.updateMany({
          where: { workspaceId: wid },
          data: { createdAt: new Date(Date.now() - 2 * 86400000) },
        });
        const a = await makeRun(textNode()),
          b = await makeRun(textNode()),
          before = fixture.sends;
        await Promise.all([
          exited(child(fixture.env, a.id)),
          exited(child(fixture.env, b.id)),
        ]);
        assert.equal(fixture.sends, before + 1);
        const runs = await Promise.all([
          getRun(actor, a.id),
          getRun(actor, b.id),
        ]);
        assert.equal(runs.filter((r) => r.status === "SUCCEEDED").length, 1);
        assert.equal(
          runs.find((r) => r.status === "FAILED")?.error,
          "WHATSAPP_DAILY_LIMIT",
        );
      },
    );
    await t.test(
      "per-workspace zero limit and revocation prevent side effects; disabled hooks reject",
      async () => {
        await clearRate();
        await db.whatsAppConnection.update({
          where: { id: connectionId },
          data: { dailyLimit: 0 },
        });
        const r = await makeRun(textNode());
        await exited(child(fixture.env, r.id));
        assert.equal((await getRun(actor, r.id)).error, "WHATSAPP_DAILY_LIMIT");
        await manageWhatsApp(actor, {
          action: "revoke",
          connectionId,
          revision: 2,
        });
        await assert.rejects(
          incoming(inboundMeta("revoked")),
          code("WHATSAPP_WEBHOOK_CONNECTION_DENIED"),
        );
        assert.ok(
          (
            await db.integrationCredential.findUniqueOrThrow({
              where: { integrationId },
            })
          ).destroyedAt,
        );
        assert.equal(
          await db.whatsAppSubscription.count({
            where: {
              workflowId: triggerWorkflow,
              versionId: triggerVersion,
              enabled: true,
            },
          }),
          0,
        );
      },
    );
  } finally {
    restore();
    await fixture.close();
    await db.workspace.deleteMany({ where: { id: { in: [wid, other] } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    for (const k of Object.keys(fixture.env))
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    await db.$disconnect();
  }
});
