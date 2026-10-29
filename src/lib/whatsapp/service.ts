import { randomUUID, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { isObject, validateDefinition } from "../engine/definition";
import {
  lock,
  readCredential,
  saveCredential,
  bindCredentialPersistence,
} from "../integrations/service";
import {
  metaAdapter,
  metaSettings,
  metaConfigured,
  provenance,
  type WhatsAppAdapter,
} from "./provider";
import { asset, recipient, waError } from "./config";
export type Actor = { workspaceId: string; userId: string };
export const MANAGE = ["OWNER", "ADMIN"] as const;
function recipientHashKey() {
  const key = process.env.META_RECIPIENT_HASH_KEY;
  if (!key || key.length < 32) waError("WHATSAPP_HASH_KEY_UNAVAILABLE", 503);
  return key;
}
export function contactHash(phoneId: string, to: string) {
  return createHmac("sha256", recipientHashKey())
    .update(`whatsapp:${phoneId}:${to}`)
    .digest("hex");
}
export function approvedAsset(accountId: string, phoneId: string) {
  let values: unknown;
  try {
    values = JSON.parse(process.env.META_WHATSAPP_TEST_ASSETS ?? "[]");
  } catch {}
  if (
    !Array.isArray(values) ||
    !values.some(
      (x) =>
        isObject(x) &&
        x.messagingAccountId === accountId &&
        x.phoneNumberId === phoneId,
    )
  )
    waError("WHATSAPP_ASSET_NOT_APPROVED");
}
export function approvedRecipient(to: string) {
  let values: unknown;
  try {
    values = JSON.parse(process.env.META_WHATSAPP_TEST_RECIPIENTS ?? "[]");
  } catch {}
  if (!Array.isArray(values) || !values.includes(to))
    waError("WHATSAPP_RECIPIENT_NOT_APPROVED");
}
export async function connectWhatsApp(
  actor: Actor,
  integrationId: string,
  body: unknown,
  adapter: WhatsAppAdapter = metaAdapter,
) {
  if (
    !isObject(body) ||
    Object.keys(body).some(
      (k) =>
        ![
          "revision",
          "messagingAccountId",
          "phoneNumberId",
          "accessToken",
          "dailyLimit",
        ].includes(k),
    ) ||
    !Number.isSafeInteger(body.revision) ||
    !asset(body.messagingAccountId) ||
    !asset(body.phoneNumberId) ||
    typeof body.accessToken !== "string" ||
    !/^[\x21-\x7e]{20,4096}$/.test(body.accessToken) ||
    !Number.isInteger(body.dailyLimit) ||
    Number(body.dailyLimit) < 0 ||
    Number(body.dailyLimit) > 20
  )
    waError("WHATSAPP_CONNECT_BODY");
  const accountId = body.messagingAccountId,
    phoneId = body.phoneNumberId,
    token = body.accessToken;
  await db.$transaction(async (tx) => {
    const row = await lock(tx, actor, integrationId, Number(body.revision));
    if (
      row.providerId !== "whatsapp-business" ||
      row.provider.state === "DISABLED"
    )
      waError("WHATSAPP_CONNECTION_DENIED");
  });
  approvedAsset(accountId, phoneId);
  let verified;
  try {
    verified = await adapter.verify(token, accountId, phoneId);
  } catch {
    waError("WHATSAPP_VERIFICATION_FAILED");
  }
  return db.$transaction(async (tx) => {
    const row = await lock(tx, actor, integrationId, Number(body.revision));
    const existing = await tx.whatsAppConnection.findUnique({
      where: { integrationId },
    });
    // Identity replacement must be a fresh integration; rotation may only refresh this exact asset.
    if (
      existing &&
      (existing.messagingAccountId !== accountId ||
        !(await tx.whatsAppPhone.findFirst({
          where: { connectionId: existing.id, providerPhoneId: phoneId },
        })))
    )
      waError("WHATSAPP_IDENTITY_IMMUTABLE");
    const other = await tx.whatsAppPhone.findUnique({
      where: { providerPhoneId: phoneId },
    });
    if (other && other.connectionId !== existing?.id)
      waError("WHATSAPP_ASSET_ALREADY_BOUND");
    const connection = await tx.whatsAppConnection.upsert({
      where: { integrationId },
      create: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        integrationId,
        messagingAccountId: accountId,
        legacyWabaId: accountId,
        businessName: verified.name,
        graphVersion: metaSettings().version,
        createdBy: actor.userId,
        mode: provenance(),
        dailyLimit: Number(body.dailyLimit),
      },
      update: {
        businessName: verified.name,
        graphVersion: metaSettings().version,
        mode: provenance(),
        dailyLimit: Number(body.dailyLimit),
      },
    });
    await tx.whatsAppPhone.upsert({
      where: { providerPhoneId: phoneId },
      create: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        connectionId: connection.id,
        providerPhoneId: phoneId,
        displayLast4: verified.phone.slice(-4),
        verifiedName: verified.phoneName,
      },
      update: { enabled: true, verifiedName: verified.phoneName },
    });
    await saveCredential(tx, row, {
      accessToken: token,
      refreshToken: "",
      scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
      expiresAt: verified.expiresAt.toISOString(),
    });
    const updated = await tx.workspaceIntegration.update({
      where: { id: integrationId },
      data: {
        status: "CONNECTED",
        scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
        accountSubject: accountId,
        lastVerifiedAt: new Date(),
        revokedAt: null,
        lastErrorCode: null,
        revision: { increment: 1 },
      },
    });
    await tx.integrationAuditEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        integrationId,
        providerId: "whatsapp-business",
        actorId: actor.userId,
        kind: "AUTHENTICATION_SUCCEEDED",
        status: "CONNECTED",
        revision: updated.revision,
      },
    });
    return {
      id: connection.id,
      status: updated.status,
      revision: updated.revision,
      mode: connection.mode,
    };
  });
}
export async function credentialForWhatsApp(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  id: string,
) {
  const c = await tx.whatsAppConnection.findFirst({
    where: { id, workspaceId },
    include: {
      phones: true,
      integration: { include: { provider: true, credential: true } },
    },
  });
  if (
    !c ||
    c.integration.status !== "CONNECTED" ||
    c.integration.deletedAt ||
    c.integration.provider.state === "DISABLED" ||
    !c.integration.credential ||
    c.integration.credential.expiresAt <= new Date()
  )
    waError("WHATSAPP_CONNECTION_UNAVAILABLE");
  approvedAsset(c.messagingAccountId, c.phones[0]?.providerPhoneId ?? "");
  const secret = readCredential(c.integration);
  return { connection: c, token: secret.accessToken };
}
export async function templatesWhatsApp(
  actor: Actor,
  id: string,
  adapter: WhatsAppAdapter = metaAdapter,
) {
  const c = await db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN", "EDITOR"]);
    return credentialForWhatsApp(tx, actor.workspaceId, id);
  });
  try {
    return await adapter.templates(c.token, c.connection.messagingAccountId);
  } catch {
    waError("WHATSAPP_TEMPLATES_UNAVAILABLE");
  }
}
export async function whatsappOverview(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const connections = await tx.whatsAppConnection.findMany({
      where: { workspaceId: actor.workspaceId },
      include: {
        phones: true,
        integration: {
          select: {
            id: true,
            status: true,
            revision: true,
            lastVerifiedAt: true,
            credential: { select: { expiresAt: true } },
          },
        },
      },
      take: 50,
    });
    return {
      integrations: await tx.workspaceIntegration.findMany({
        where: {
          workspaceId: actor.workspaceId,
          providerId: "whatsapp-business",
          deletedAt: null,
        },
        select: { id: true, revision: true, status: true },
      }),
      configured: metaConfigured(),
      mode: metaConfigured() ? provenance() : "UNCONFIGURED",
      connections: connections.map((c) => ({
        ...c,
        integration: {
          ...c.integration,
          status:
            c.integration.credential &&
            c.integration.credential.expiresAt <= new Date()
              ? "EXPIRED"
              : c.integration.status,
        },
        endpoint: `${new URL(process.env.BETTER_AUTH_URL!).origin}/api/integrations/whatsapp/webhook`,
      })),
      events: await tx.whatsAppEvent.findMany({
        where: { workspaceId: actor.workspaceId },
        take: 50,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          phoneId: true,
          kind: true,
          providerId: true,
          providerAt: true,
          state: true,
          error: true,
          createdAt: true,
          deliveries: { select: { runId: true } },
        },
      }),
      messages: await tx.whatsAppMessage.findMany({
        where: { workspaceId: actor.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          attempts: true,
          statuses: { orderBy: { providerAt: "asc" } },
        },
      }),
      contacts: await tx.whatsAppContact.findMany({
        where: { workspaceId: actor.workspaceId },
        take: 50,
        orderBy: { updatedAt: "desc" },
      }),
      subscriptions: await tx.whatsAppSubscription.findMany({
        where: { workspaceId: actor.workspaceId },
        take: 50,
      }),
    };
  });
}
export async function manageWhatsApp(actor: Actor, body: unknown) {
  if (!isObject(body) || typeof body.action !== "string")
    waError("WHATSAPP_MANAGEMENT_BODY");
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, [...MANAGE]);
    if (body.action === "review-unknown") {
      if (
        body.acknowledgeNoAutomaticResend !== true ||
        typeof body.messageId !== "string"
      )
        waError("WHATSAPP_REVIEW_ACK_REQUIRED");
      const message = await tx.whatsAppMessage.findFirst({
        where: {
          id: body.messageId,
          workspaceId: actor.workspaceId,
          state: "UNKNOWN",
          reviewedAt: null,
        },
        include: { phone: { include: { connection: true } } },
      });
      if (!message) waError("WHATSAPP_UNKNOWN_NOT_FOUND", 404);
      await tx.whatsAppMessage.updateMany({
        where: { id: message.id, state: "UNKNOWN", reviewedAt: null },
        data: { reviewedAt: new Date(), reviewedBy: actor.userId },
      });
      const integration = await tx.workspaceIntegration.findUniqueOrThrow({
        where: { id: message.phone.connection.integrationId },
      });
      await tx.integrationAuditEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          integrationId: integration.id,
          providerId: "whatsapp-business",
          actorId: actor.userId,
          kind: "LABEL_UPDATED",
          status: integration.status,
          revision: integration.revision,
          code: "WHATSAPP_UNKNOWN_REVIEWED",
        },
      });
      return { reviewed: true, resend: false, outcome: "UNKNOWN" };
    }
    if (body.action === "consent") {
      if (
        typeof body.phoneId !== "string" ||
        !recipient(body.recipient) ||
        !["GRANT", "SUPPRESS", "WITHDRAW"].includes(String(body.decision)) ||
        typeof body.source !== "string" ||
        !body.source.trim() ||
        body.source.length > 160
      )
        waError("WHATSAPP_CONSENT_BODY");
      const phone = await tx.whatsAppPhone.findFirst({
        where: { id: body.phoneId, workspaceId: actor.workspaceId },
      });
      if (!phone) waError("WHATSAPP_PHONE_NOT_FOUND", 404);
      const hash = contactHash(phone.id, body.recipient),
        now = new Date(),
        patch =
          body.decision === "GRANT"
            ? { consentAt: now, consentSource: body.source, optedOutAt: null }
            : body.decision === "SUPPRESS"
              ? { optedOutAt: now, consentAt: null, consentSource: body.source }
              : { consentAt: null, consentSource: body.source };
      await tx.whatsAppContact.upsert({
        where: {
          phoneId_recipientHash: { phoneId: phone.id, recipientHash: hash },
        },
        create: {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          phoneId: phone.id,
          recipientHash: hash,
          last4: body.recipient.slice(-4),
          ...patch,
        },
        update: patch,
      });
      await tx.integrationAuditEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          integrationId: (
            await tx.whatsAppConnection.findUniqueOrThrow({
              where: { id: phone.connectionId },
            })
          ).integrationId,
          providerId: "whatsapp-business",
          actorId: actor.userId,
          kind: "LABEL_UPDATED",
          status: "CONNECTED",
          revision: 1,
          code: `WHATSAPP_CONSENT_${body.decision}`,
        },
      });
      return { ok: true };
    }
    if (body.action === "subscribe") {
      if (
        typeof body.versionId !== "string" ||
        typeof body.connectionId !== "string" ||
        typeof body.phoneId !== "string"
      )
        waError("WHATSAPP_SUBSCRIPTION_BODY");
      const { connection } = await credentialForWhatsApp(
        tx,
        actor.workspaceId,
        body.connectionId,
      );
      const phone = connection.phones.find(
        (p) => p.id === body.phoneId && p.enabled,
      );
      if (!phone) waError("WHATSAPP_PHONE_NOT_FOUND", 404);
      const version = await tx.workflowVersion.findFirst({
        where: {
          id: body.versionId,
          workflow: {
            workspaceId: actor.workspaceId,
            internalKind: null,
            enabled: true,
            archivedAt: null,
          },
        },
      });
      if (!version) waError("WHATSAPP_VERSION_NOT_FOUND", 404);
      const trigger = validateDefinition(version.definition).nodes.find(
        (n) => n.type === "whatsapp_message_received",
      );
      if (
        !trigger ||
        trigger.config.connectionId !== connection.id ||
        trigger.config.phoneNumberId !== phone.providerPhoneId
      )
        waError("WHATSAPP_TRIGGER_MISMATCH");
      return tx.whatsAppSubscription.upsert({
        where: {
          phoneId_workflowId: {
            phoneId: phone.id,
            workflowId: version.workflowId,
          },
        },
        create: {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          connectionId: connection.id,
          phoneId: phone.id,
          workflowId: version.workflowId,
          versionId: version.id,
          createdBy: actor.userId,
        },
        update: {
          versionId: version.id,
          createdBy: actor.userId,
          enabled: true,
        },
      });
    }
    if (body.action === "unsubscribe") {
      await tx.whatsAppSubscription.updateMany({
        where: { id: String(body.id), workspaceId: actor.workspaceId },
        data: { enabled: false },
      });
      return { ok: true };
    }
    if (body.action === "revoke") {
      const c = await tx.whatsAppConnection.findFirst({
        where: {
          id: String(body.connectionId),
          workspaceId: actor.workspaceId,
        },
      });
      if (!c) waError("WHATSAPP_CONNECTION_NOT_FOUND", 404);
      const row = await lock(tx, actor, c.integrationId, Number(body.revision));
      await bindCredentialPersistence(tx, row).erase();
      await tx.whatsAppPhone.updateMany({
        where: { connectionId: c.id },
        data: { enabled: false },
      });
      await tx.whatsAppSubscription.updateMany({
        where: { connectionId: c.id },
        data: { enabled: false },
      });
      const updated = await tx.workspaceIntegration.update({
        where: { id: c.integrationId },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
          scopes: [],
          revision: { increment: 1 },
        },
      });
      await tx.integrationAuditEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          integrationId: c.integrationId,
          providerId: "whatsapp-business",
          actorId: actor.userId,
          kind: "REVOKED",
          status: "REVOKED",
          revision: updated.revision,
          code: "LOCAL_ACCESS_REMOVED",
        },
      });
      return {
        scope: "LOCAL_ACCESS_REMOVED",
        remoteRevocation: "NOT_ATTEMPTED",
      };
    }
    waError("WHATSAPP_UNKNOWN_ACTION");
  });
}
