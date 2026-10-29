import { consumeQuota } from "../billing/quotas";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../db";
import { type WorkflowNode, type Json, type Data } from "../engine/definition";
import { whatsappConfig, mapped, recipient, waError } from "./config";
import {
  credentialForWhatsApp,
  approvedRecipient,
  contactHash,
} from "./service";
import { metaAdapter, MetaFailure, type WhatsAppAdapter } from "./provider";
export async function markWhatsAppUnknown(
  tx: Prisma.TransactionClient,
  runId: string,
  code = "WORKER_LOST_OUTCOME_UNKNOWN",
) {
  await tx.whatsAppMessage.updateMany({
    where: { runId, state: { in: ["RESERVED", "IN_FLIGHT"] } },
    data: { state: "UNKNOWN", error: code },
  });
  await tx.whatsAppAttempt.updateMany({
    where: { message: { runId }, state: "IN_FLIGHT" },
    data: {
      state: "UNKNOWN",
      error: code,
      finishedAt: new Date(),
    },
  });
}
export async function executeWhatsApp(
  runId: string,
  node: WorkflowNode,
  input: Json,
  deadline: number,
  adapter: WhatsAppAdapter = metaAdapter,
) {
  whatsappConfig(node.type, node.config);
  const c = node.config;
  const to = c.toPath ? mapped(input, String(c.toPath)) : c.to;
  const body = c.bodyPath ? mapped(input, String(c.bodyPath)) : c.body;
  if (!recipient(to)) waError("WHATSAPP_RECIPIENT");
  approvedRecipient(to);
  const template = node.type === "whatsapp_send_template";
  if (
    !template &&
    (typeof body !== "string" || !body.trim() || body.length > 4096)
  )
    waError("WHATSAPP_BODY");
  const parameters = template
    ? (c.parameters as string[]).map((v, i) => {
        const p = (c.parameterPaths as string[] | undefined)?.[i],
          value = p ? mapped(input, p) : v;
        if (typeof value !== "string" || !value.trim() || value.length > 512)
          waError("WHATSAPP_PARAMETERS");
        return value;
      })
    : [];
  const captured = await db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { workflow: true },
    });
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: run.workflow.workspaceId,
          userId: run.requestedBy,
        },
      },
    });
    if (
      run.status !== "RUNNING" ||
      !member ||
      member.role === "VIEWER" ||
      !run.workflow.enabled ||
      run.workflow.archivedAt
    )
      waError("WHATSAPP_RUN_UNAUTHORIZED", 403);
    return credentialForWhatsApp(
      tx,
      run.workflow.workspaceId,
      String(c.connectionId),
    );
  });
  const connection = captured.connection,
    phone = connection.phones.find((p) => p.enabled);
  if (!phone) waError("WHATSAPP_PHONE_UNAVAILABLE");
  let templatePayload: Data | undefined;
  if (template) {
    let templates;
    try {
      templates = await adapter.templates(
        captured.token,
        connection.messagingAccountId,
      );
    } catch {
      waError("WHATSAPP_TEMPLATES_UNAVAILABLE");
    }
    const t = templates.find(
      (t) =>
        t.id === c.templateId &&
        t.language === c.language &&
        t.status === "APPROVED" &&
        t.supported &&
        t.category === "UTILITY",
    );
    if (!t || t.parameters !== parameters.length)
      waError("WHATSAPP_TEMPLATE_NOT_APPROVED");
    templatePayload = {
      name: t.name,
      language: { code: t.language },
      components: parameters.length
        ? [
            {
              type: "body",
              parameters: parameters.map((text) => ({ type: "text", text })),
            },
          ]
        : [],
    };
  }
  const hash = contactHash(phone.id, to),
    messageId = createHash("sha256")
      .update(`wa:${runId}:${node.id}`)
      .digest("hex");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-send:${connection.workspaceId}`},614))`;
    if (
      await tx.whatsAppMessage.findUnique({
        where: { runId_nodeId: { runId, nodeId: node.id } },
      })
    )
      waError("WHATSAPP_DUPLICATE_SEND", 409);
    await credentialForWhatsApp(tx, connection.workspaceId, connection.id);
    if (
      await tx.whatsAppMessage.count({
        where: {
          phoneId: phone.id,
          recipientHash: hash,
          state: "UNKNOWN",
          reviewedAt: null,
        },
      })
    )
      waError("WHATSAPP_UNCERTAIN_RECIPIENT_REVIEW_REQUIRED");
    const contact = await tx.whatsAppContact.findUnique({
      where: {
        phoneId_recipientHash: { phoneId: phone.id, recipientHash: hash },
      },
    });
    if (contact?.optedOutAt) waError("WHATSAPP_SUPPRESSED");
    if (
      template
        ? !contact?.consentAt
        : !contact?.lastInboundAt ||
          contact.lastInboundAt.getTime() < Date.now() - 24 * 3600000 ||
          contact.lastInboundAt.getTime() > Date.now() + 300000
    )
      waError(
        template ? "WHATSAPP_CONSENT_REQUIRED" : "WHATSAPP_WINDOW_CLOSED",
      );
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    if (
      connection.dailyLimit === 0 ||
      (await tx.whatsAppMessage.count({
        where: { workspaceId: connection.workspaceId, createdAt: { gte: day } },
      })) >= connection.dailyLimit
    )
      waError("WHATSAPP_DAILY_LIMIT", 429);
    if (
      (await tx.whatsAppMessage.count({
        where: {
          workspaceId: connection.workspaceId,
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })) >= 5 ||
      (await tx.whatsAppMessage.count({
        where: {
          phoneId: phone.id,
          recipientHash: hash,
          createdAt: { gte: new Date(Date.now() - 6000) },
        },
      })) > 0
    )
      waError("WHATSAPP_RATE_LIMIT", 429);
    await consumeQuota(
      tx,
      connection.workspaceId,
      "messages",
      `${runId}:${node.id}`,
    );
    await tx.whatsAppMessage.create({
      data: {
        id: messageId,
        workspaceId: connection.workspaceId,
        phoneId: phone.id,
        runId,
        nodeId: node.id,
        recipientHash: hash,
        recipientLast4: to.slice(-4),
        kind: template ? "TEMPLATE" : "SERVICE_REPLY",
        templateId: template ? String(c.templateId) : null,
      },
    });
  });
  const payload: Data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    messaging_account_id: connection.messagingAccountId,
    biz_opaque_callback_data: messageId,
    type: template ? "template" : "text",
    ...(template
      ? { template: templatePayload! }
      : { text: { preview_url: false, body: String(body) } }),
  };
  for (let number = 1; number <= 3; number++) {
    const remaining = deadline - Date.now();
    if (remaining < 200) {
      await db.whatsAppMessage.updateMany({
        where: { id: messageId, state: { in: ["RESERVED", "IN_FLIGHT"] } },
        data: { state: "FAILED", error: "WHATSAPP_EXECUTION_TIMEOUT" },
      });
      waError("WHATSAPP_EXECUTION_TIMEOUT");
    }
    // Check current membership, connection, suppression and window again for every possible send.
    await db.$transaction(async (tx) => {
      await credentialForWhatsApp(tx, connection.workspaceId, connection.id);
      const run = await tx.workflowRun.findUniqueOrThrow({
          where: { id: runId },
          include: { workflow: true },
        }),
        member = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: connection.workspaceId,
              userId: run.requestedBy,
            },
          },
        });
      const contact = await tx.whatsAppContact.findUnique({
        where: {
          phoneId_recipientHash: { phoneId: phone.id, recipientHash: hash },
        },
      });
      if (
        run.status !== "RUNNING" ||
        !member ||
        member.role === "VIEWER" ||
        !run.workflow.enabled ||
        run.workflow.archivedAt ||
        contact?.optedOutAt ||
        (template && !contact?.consentAt) ||
        (!template &&
          (!contact?.lastInboundAt ||
            contact.lastInboundAt.getTime() < Date.now() - 86400000))
      )
        waError("WHATSAPP_SEND_PERMISSION_CHANGED");
      await tx.whatsAppAttempt.create({
        data: {
          id: randomUUID(),
          workspaceId: connection.workspaceId,
          messageId,
          number,
          state: "IN_FLIGHT",
        },
      });
      await tx.whatsAppMessage.updateMany({
        where: { id: messageId, state: { in: ["RESERVED", "IN_FLIGHT"] } },
        data: { state: "IN_FLIGHT" },
      });
    });
    try {
      const response = await adapter.send(
        captured.token,
        phone.providerPhoneId,
        payload,
        Math.min(8000, remaining),
      );
      await db.$transaction(async (tx) => {
        await tx.whatsAppAttempt.updateMany({
          where: { messageId, number, state: "IN_FLIGHT" },
          data: { state: "ACCEPTED", statusCode: 200, finishedAt: new Date() },
        });
        await tx.whatsAppMessage.updateMany({
          where: {
            id: messageId,
            state: { in: ["RESERVED", "IN_FLIGHT", "UNKNOWN"] },
          },
          data: {
            providerMessageId: response.id,
            state: "ACCEPTED",
            acceptedAt: new Date(),
          },
        });
      });
      return {
        output: {
          messageId,
          providerMessageId: response.id,
          status: "ACCEPTED",
          delivery: "UNCONFIRMED",
        } as Json,
      };
    } catch (error) {
      const e =
        error instanceof MetaFailure
          ? error
          : new MetaFailure("WHATSAPP_OUTCOME_UNKNOWN", true);
      const retry =
        e.retryable &&
        !e.ambiguous &&
        number < 3 &&
        deadline - Date.now() > 500;
      await db.$transaction(async (tx) => {
        await tx.whatsAppAttempt.updateMany({
          where: { messageId, number, state: "IN_FLIGHT" },
          data: {
            state: e.ambiguous ? "UNKNOWN" : "REJECTED",
            error: e.code,
            statusCode: e.status,
            finishedAt: new Date(),
          },
        });
        if (!retry)
          await tx.whatsAppMessage.updateMany({
            where: { id: messageId, state: { in: ["RESERVED", "IN_FLIGHT"] } },
            data: { state: e.ambiguous ? "UNKNOWN" : "FAILED", error: e.code },
          });
      });
      if (!retry) waError(e.code);
      await sleep(number * 100);
    }
  }
  waError("WHATSAPP_OPERATION_FAILED");
}
