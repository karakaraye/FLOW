import { resourceLimit, consumeQuota } from "../billing/quotas";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import {
  audit,
  canonical,
  EngineError,
  isObject,
  validateDefinition,
  type Data,
} from "../engine/definition";
import { seal } from "../engine/payload";
import { encryptSecret, decryptSecret } from "../integrations/crypto";
import { metaSettings } from "./provider";
import { contactHash, credentialForWhatsApp } from "./service";
import { asset, recipient, waError } from "./config";
export function metaSignature(secret: string, raw: Uint8Array) {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}
export function verifyMetaSignature(
  secret: string,
  raw: Uint8Array,
  header: string | null,
) {
  return (
    !!header &&
    /^sha256=[a-f0-9]{64}$/.test(header) &&
    timingSafeEqual(
      Buffer.from(metaSignature(secret, raw)),
      Buffer.from(header),
    )
  );
}
export function challengeMeta(url: URL) {
  const s = metaSettings(),
    token = url.searchParams.get("hub.verify_token") ?? "",
    challenge = url.searchParams.get("hub.challenge") ?? "";
  if (
    url.searchParams.get("hub.mode") !== "subscribe" ||
    token.length > 1024 ||
    !timingSafeEqual(
      createHash("sha256").update(token).digest(),
      createHash("sha256").update(s.verifyToken).digest(),
    ) ||
    !/^\d{1,100}$/.test(challenge)
  )
    waError("WHATSAPP_VERIFY_DENIED", 403);
  return challenge;
}
export function eventContext(event: {
  id: string;
  workspaceId: string;
  phoneId: string;
}) {
  return {
    workspaceId: event.workspaceId,
    integrationId: event.phoneId,
    providerId: "whatsapp-business",
    recordId: event.id,
    purpose: "whatsapp-event" as const,
  };
}
type Event = {
  accountId: string;
  phoneId: string;
  kind: string;
  providerId: string;
  at: Date;
  payload: Data;
  dedup: string;
};
export function parseMetaEvents(value: unknown): Event[] {
  if (
    !isObject(value) ||
    value.object !== "whatsapp_business_account" ||
    !Array.isArray(value.entry) ||
    !value.entry.length ||
    value.entry.length > 20
  )
    waError("WHATSAPP_WEBHOOK_SHAPE", 400);
  const events: Event[] = [];
  for (const entry of value.entry) {
    if (
      !isObject(entry) ||
      !asset(entry.id) ||
      !Array.isArray(entry.changes) ||
      entry.changes.length > 20
    )
      waError("WHATSAPP_WEBHOOK_SHAPE", 400);
    for (const change of entry.changes) {
      if (
        !isObject(change) ||
        change.field !== "messages" ||
        !isObject(change.value)
      )
        waError("WHATSAPP_WEBHOOK_UNSUPPORTED", 400);
      const v = change.value;
      if (
        v.messaging_product !== "whatsapp" ||
        !isObject(v.metadata) ||
        !asset(v.metadata.phone_number_id)
      )
        waError("WHATSAPP_WEBHOOK_SHAPE", 400);
      const messages = v.messages ?? [],
        statuses = v.statuses ?? [];
      if (
        !Array.isArray(messages) ||
        !Array.isArray(statuses) ||
        messages.length + statuses.length > 100
      )
        waError("WHATSAPP_WEBHOOK_SHAPE", 400);
      for (const item of [...messages, ...statuses]) {
        if (
          !isObject(item) ||
          typeof item.id !== "string" ||
          !/^wamid\.[A-Za-z0-9_+/=.-]{1,250}$/.test(item.id) ||
          typeof item.timestamp !== "string" ||
          !/^\d{10}$/.test(item.timestamp)
        )
          waError("WHATSAPP_WEBHOOK_SHAPE", 400);
        const at = new Date(Number(item.timestamp) * 1000);
        if (
          at.getTime() > Date.now() + 300000 ||
          at.getTime() < Date.now() - 7 * 86400000
        )
          waError("WHATSAPP_WEBHOOK_STALE", 400);
        const status = Object.hasOwn(item, "status");
        let payload: Data;
        let kind: string;
        if (status) {
          if (
            !["sent", "delivered", "read", "failed"].includes(
              String(item.status),
            ) ||
            !recipient(item.recipient_id)
          )
            waError("WHATSAPP_WEBHOOK_SHAPE", 400);
          kind = "STATUS";
          payload = {
            to: item.recipient_id,
            state: String(item.status).toUpperCase(),
            ...(typeof item.biz_opaque_callback_data === "string" &&
            /^[a-zA-Z0-9-]{1,100}$/.test(item.biz_opaque_callback_data)
              ? { correlation: item.biz_opaque_callback_data }
              : {}),
            ...(Array.isArray(item.errors) &&
            isObject(item.errors[0]) &&
            Number.isSafeInteger(item.errors[0].code)
              ? { errorCode: String(item.errors[0].code) }
              : {}),
          };
        } else {
          if (!recipient(item.from) || typeof item.type !== "string")
            waError("WHATSAPP_WEBHOOK_SHAPE", 400);
          kind = item.type === "text" ? "INBOUND" : "UNSUPPORTED_MEDIA";
          if (
            kind === "INBOUND" &&
            (!isObject(item.text) ||
              typeof item.text.body !== "string" ||
              !item.text.body.trim() ||
              item.text.body.length > 4096)
          )
            waError("WHATSAPP_WEBHOOK_SHAPE", 400);
          payload = {
            from: item.from,
            type: item.type,
            ...(kind === "INBOUND" ? { text: (item.text as Data).body } : {}),
          };
        }
        const dedup = createHash("sha256")
          .update(
            canonical({
              kind,
              id: item.id,
              ...(status
                ? { state: payload.state, timestamp: item.timestamp }
                : {}),
            }),
          )
          .digest("hex");
        events.push({
          accountId: entry.id,
          phoneId: v.metadata.phone_number_id,
          kind,
          providerId: item.id,
          at,
          payload,
          dedup,
        });
      }
    }
  }
  if (!events.length || events.length > 100)
    waError("WHATSAPP_WEBHOOK_EMPTY", 400);
  return events;
}
export async function receiveMeta(raw: Uint8Array, header: string | null) {
  if (raw.byteLength > 65536) waError("WHATSAPP_WEBHOOK_LIMIT", 413);
  if (!verifyMetaSignature(metaSettings().appSecret, raw, header))
    waError("WHATSAPP_SIGNATURE_INVALID", 401);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    waError("WHATSAPP_WEBHOOK_JSON", 400);
  }
  const parsed = parseMetaEvents(value);
  return db.$transaction(
    async (tx) => {
      let accepted = 0;
      for (const e of parsed) {
        const phone = await tx.whatsAppPhone.findUnique({
          where: { providerPhoneId: e.phoneId },
          include: {
            connection: {
              include: {
                integration: { include: { credential: true, provider: true } },
              },
            },
          },
        });
        if (
          !phone ||
          !phone.enabled ||
          phone.connection.messagingAccountId !== e.accountId ||
          phone.connection.integration.status !== "CONNECTED" ||
          phone.connection.integration.deletedAt ||
          phone.connection.integration.provider.state === "DISABLED" ||
          !phone.connection.integration.credential ||
          phone.connection.integration.credential.expiresAt <= new Date()
        )
          waError("WHATSAPP_WEBHOOK_CONNECTION_DENIED", 404);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-hook:${phone.id}`},612))`;
        if (
          await tx.whatsAppEvent.findUnique({
            where: {
              phoneId_dedupKey: { phoneId: phone.id, dedupKey: e.dedup },
            },
          })
        )
          continue;
        if (
          (await tx.whatsAppEvent.count({
            where: {
              phoneId: phone.id,
              createdAt: { gte: new Date(Date.now() - 60000) },
            },
          })) >= 120
        )
          waError("WHATSAPP_WEBHOOK_RATE", 429);
        const id = randomUUID(),
          context = eventContext({
            id,
            workspaceId: phone.workspaceId,
            phoneId: phone.id,
          });
        await tx.whatsAppEvent.create({
          data: {
            id,
            workspaceId: phone.workspaceId,
            phoneId: phone.id,
            dedupKey: e.dedup,
            kind: e.kind,
            providerId: e.providerId,
            providerAt: e.at,
            ciphertext: encryptSecret(e.payload, context).ciphertext,
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        accepted++;
      }
      return { accepted };
    },
    { timeout: 10000 },
  );
}
const rank: Record<string, number> = {
  RESERVED: 0,
  IN_FLIGHT: 0,
  UNKNOWN: 0,
  ACCEPTED: 1,
  FAILED: 3,
  SENT: 2,
  DELIVERED: 4,
  READ: 5,
};
export function deriveStatus(current: string, next: string) {
  return (rank[next] ?? 0) > (rank[current] ?? 0) ? next : current;
}
export async function processMetaEvent() {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "WhatsAppEvent" WHERE state='PENDING' ORDER BY "createdAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return false;
      const e = await tx.whatsAppEvent.findUniqueOrThrow({
        where: { id: rows[0].id },
        include: { phone: { include: { connection: true } } },
      });
      if (e.expiresAt <= new Date() || !e.ciphertext) {
        await tx.whatsAppEvent.update({
          where: { id: e.id },
          data: { state: "EXPIRED", ciphertext: null, processedAt: new Date() },
        });
        return true;
      }
      try {
        await credentialForWhatsApp(tx, e.workspaceId, e.phone.connectionId);
      } catch {
        await tx.whatsAppEvent.update({
          where: { id: e.id },
          data: {
            state: "REJECTED",
            error: "CONNECTION_UNAVAILABLE",
            ciphertext: null,
            processedAt: new Date(),
          },
        });
        return true;
      }
      const p = decryptSecret<Data>(e.ciphertext, eventContext(e));
      if (e.kind === "STATUS") {
        let message = await tx.whatsAppMessage.findFirst({
          where: {
            workspaceId: e.workspaceId,
            phoneId: e.phoneId,
            providerMessageId: e.providerId,
          },
        });
        if (!message && typeof p.correlation === "string")
          message = await tx.whatsAppMessage.findFirst({
            where: {
              id: p.correlation,
              workspaceId: e.workspaceId,
              phoneId: e.phoneId,
              providerMessageId: null,
              state: { in: ["IN_FLIGHT", "UNKNOWN"] },
            },
          });
        if (
          message &&
          message.recipientHash === contactHash(e.phoneId, String(p.to))
        ) {
          await tx.$executeRaw`SELECT id FROM "WhatsAppMessage" WHERE id=${message.id} FOR UPDATE`;
          message = await tx.whatsAppMessage.findUniqueOrThrow({
            where: { id: message.id },
          });
          const next = deriveStatus(message.state, String(p.state));
          await tx.whatsAppStatus.create({
            data: {
              id: randomUUID(),
              workspaceId: e.workspaceId,
              messageId: message.id,
              eventId: e.id,
              state: String(p.state),
              providerAt: e.providerAt,
              errorCode: typeof p.errorCode === "string" ? p.errorCode : null,
            },
          });
          await tx.whatsAppMessage.update({
            where: { id: message.id },
            data: {
              providerMessageId: e.providerId,
              state: next,
              ...(next !== message.state ? { statusAt: e.providerAt } : {}),
              error:
                next === "FAILED"
                  ? "PROVIDER_DELIVERY_FAILED"
                  : ["SENT", "DELIVERED", "READ"].includes(next)
                    ? null
                    : message.error,
            },
          });
          await tx.whatsAppAttempt.updateMany({
            where: {
              messageId: message.id,
              state: { in: ["IN_FLIGHT", "UNKNOWN"] },
            },
            data: { state: "RECONCILED_BY_STATUS", finishedAt: new Date() },
          });
        } else {
          await tx.whatsAppEvent.update({
            where: { id: e.id },
            data: {
              state: "UNMATCHED",
              error: "UNKNOWN_PROVIDER_MESSAGE",
              ciphertext: e.ciphertext,
              processedAt: new Date(),
            },
          });
          return true;
        }
      } else {
        const from = String(p.from),
          hash = contactHash(e.phoneId, from),
          stop =
            e.kind === "INBOUND" &&
            /^(?:stop|unsubscribe|cancel|end|quit|opt[ -]?out)$/i.test(
              String(p.text).trim(),
            );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-contact:${e.phoneId}:${hash}`},613))`;
        const old = await tx.whatsAppContact.findUnique({
          where: {
            phoneId_recipientHash: { phoneId: e.phoneId, recipientHash: hash },
          },
        });
        await tx.whatsAppContact.upsert({
          where: {
            phoneId_recipientHash: { phoneId: e.phoneId, recipientHash: hash },
          },
          create: {
            id: randomUUID(),
            workspaceId: e.workspaceId,
            phoneId: e.phoneId,
            recipientHash: hash,
            last4: from.slice(-4),
            lastInboundAt: e.providerAt,
            ...(stop
              ? {
                  optedOutAt: new Date(),
                  consentAt: null,
                  consentSource: "INBOUND_OPT_OUT",
                }
              : {}),
          },
          update: {
            lastInboundAt:
              old?.lastInboundAt && old.lastInboundAt > e.providerAt
                ? old.lastInboundAt
                : e.providerAt,
            ...(stop
              ? {
                  optedOutAt: new Date(),
                  consentAt: null,
                  consentSource: "INBOUND_OPT_OUT",
                }
              : {}),
          },
        });
        if (e.kind === "INBOUND" && !stop) {
          const subscriptions = await tx.whatsAppSubscription.findMany({
            where: {
              phoneId: e.phoneId,
              workspaceId: e.workspaceId,
              enabled: true,
            },
            take: 20,
          });
          for (const sub of subscriptions) {
            const version = await tx.workflowVersion.findFirst({
              where: {
                id: sub.versionId,
                workflowId: sub.workflowId,
                workflow: {
                  workspaceId: e.workspaceId,
                  enabled: true,
                  archivedAt: null,
                  internalKind: null,
                },
              },
            });
            const member = await tx.workspaceMember.findUnique({
              where: {
                workspaceId_userId: {
                  workspaceId: e.workspaceId,
                  userId: sub.createdBy,
                },
              },
            });
            if (!version || !member || member.role === "VIEWER") continue;
            const trigger = validateDefinition(version.definition).nodes.find(
              (n) => n.type === "whatsapp_message_received",
            );
            if (
              !trigger ||
              trigger.config.connectionId !== e.phone.connectionId ||
              trigger.config.phoneNumberId !== e.phone.providerPhoneId ||
              (typeof trigger.config.contains === "string" &&
                !String(p.text).includes(trigger.config.contains))
            )
              continue;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${e.workspaceId}))`;
            if (
              (await tx.workflowRun.count({
                where: {
                  workflow: { workspaceId: e.workspaceId },
                  status: { in: ["QUEUED", "RUNNING"] },
                },
              })) >= 100
            )
              throw new Error("QUEUE_FULL");
            const id = randomUUID(),
              input: Data = {
                from,
                text: String(p.text),
                providerMessageId: e.providerId,
                phoneNumberId: e.phone.providerPhoneId,
                receivedAt: e.providerAt.toISOString(),
              };
            try {
              await resourceLimit(tx, e.workspaceId, "activeWorkflows", 0);
              await consumeQuota(tx, e.workspaceId, "executions", id);
            } catch (error) {
              if (
                !(error instanceof EngineError) ||
                error.code !== "PLAN_QUOTA_EXCEEDED"
              )
                throw error;
              await tx.whatsAppEvent.update({
                where: { id: e.id },
                data: { error: "PLAN_QUOTA_EXCEEDED" },
              });
              continue;
            }
            await tx.workflowRun.create({
              data: {
                id,
                workflowId: sub.workflowId,
                versionId: sub.versionId,
                requestedBy: sub.createdBy,
                idempotencyKey: `wa-${e.id}`,
                requestHash: createHash("sha256")
                  .update(canonical(input))
                  .digest("hex"),
                payload: seal(input, id),
                input: audit(input) as Prisma.InputJsonValue,
              },
            });
            await tx.whatsAppEventRun.create({
              data: {
                id: randomUUID(),
                workspaceId: e.workspaceId,
                eventId: e.id,
                workflowId: sub.workflowId,
                runId: id,
              },
            });
          }
        }
      }
      await tx.whatsAppEvent.update({
        where: { id: e.id },
        data: {
          state: e.kind === "UNSUPPORTED_MEDIA" ? "UNSUPPORTED" : "PROCESSED",
          ciphertext: e.kind === "STATUS" ? e.ciphertext : null,
          processedAt: new Date(),
        },
      });
      return true;
    },
    { timeout: 10000 },
  );
}
export async function purgeMetaEvents() {
  await db.whatsAppMessage.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
      state: { notIn: ["RESERVED", "IN_FLIGHT", "UNKNOWN"] },
    },
  });
  await db.whatsAppEvent.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
      state: { not: "PENDING" },
    },
  });
  await db.whatsAppEvent.updateMany({
    where: { expiresAt: { lte: new Date() }, state: "PENDING" },
    data: { ciphertext: null, state: "EXPIRED" },
  });
  await db.whatsAppEvent.updateMany({
    where: { expiresAt: { lte: new Date() }, ciphertext: { not: null } },
    data: { ciphertext: null },
  });
}
