import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import {
  EngineError,
  validateDefinition,
  assertJson,
  audit,
  LIMITS,
  isObject,
} from "../engine/definition";
import { seal } from "../engine/payload";
import { encryptSecret, decryptSecret } from "../integrations/crypto";
type Actor = { userId: string; workspaceId: string };
const manage = ["OWNER", "ADMIN"] as const;
export function webhookContext(id: string, workspaceId: string) {
  return {
    workspaceId,
    integrationId: id,
    providerId: "webhook-signing",
    recordId: id,
    purpose: "credential" as const,
  };
}
export function signature(
  secret: string,
  timestamp: string,
  deliveryId: string,
  raw: Uint8Array,
) {
  return createHmac("sha256", secret)
    .update(`v1.${timestamp}.${deliveryId}.`)
    .update(raw)
    .digest("hex");
}
export function verifySignature(
  secret: string,
  timestamp: string | null,
  deliveryId: string | null,
  header: string | null,
  raw: Uint8Array,
  now = Date.now(),
) {
  if (
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !deliveryId ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(deliveryId) ||
    !header ||
    !/^v1=[a-f0-9]{64}$/.test(header)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(header.slice(3), "hex"),
    Buffer.from(signature(secret, timestamp, deliveryId, raw), "hex"),
  );
}
function metadata(w: {
  id: string;
  versionId: string;
  enabled: boolean;
  revision: number;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: w.id,
    versionId: w.versionId,
    enabled: w.enabled,
    revision: w.revision,
    revokedAt: w.revokedAt,
    createdAt: w.createdAt,
    endpoint: `${new URL(process.env.BETTER_AUTH_URL!).origin}/api/hooks/${w.id}`,
  };
}
async function owned(
  tx: Prisma.TransactionClient,
  actor: Actor,
  workflowId: string,
  write = false,
) {
  await authorize(tx, actor, write ? [...manage] : undefined);
  const w = await tx.workflow.findFirst({
    where: { id: workflowId, workspaceId: actor.workspaceId },
  });
  if (!w) throw new EngineError("NOT_FOUND", "Workflow not found.", 404);
  return w;
}
export async function listWebhooks(actor: Actor, workflowId: string) {
  return db.$transaction(async (tx) => {
    await owned(tx, actor, workflowId);
    const hooks = await tx.webhook.findMany({
      where: { workflowId },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    return Promise.all(
      hooks.map(async (w) => ({
        ...metadata(w),
        deliveries: await tx.webhookDelivery.findMany({
          where: { webhookId: w.id },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: {
            id: true,
            createdAt: true,
            run: { select: { id: true, status: true, error: true } },
          },
        }),
        audit: await tx.webhookAudit.findMany({
          where: { webhookId: w.id },
          orderBy: { createdAt: "desc" },
          take: 25,
          select: { code: true, createdAt: true },
        }),
      })),
    );
  });
}
export async function manageWebhook(
  actor: Actor,
  workflowId: string,
  body: unknown,
) {
  if (
    !isObject(body) ||
    !["create", "rotate", "revoke", "enable", "disable", "rotate-key"].includes(
      String(body.action),
    ) ||
    Object.keys(body).some(
      (k) => !["action", "id", "revision", "versionId"].includes(k),
    )
  )
    throw new EngineError("INVALID_BODY", "Choose a webhook operation.");
  return db.$transaction(async (tx) => {
    const workflow = await owned(tx, actor, workflowId, true);
    await tx.$executeRaw`SELECT id FROM "Workflow" WHERE id=${workflowId} FOR UPDATE`;
    if (
      !["disable", "revoke"].includes(String(body.action)) &&
      (await tx.webhookAudit.count({
        where: {
          webhook: { workflowId },
          code: { in: ["CREATED", "ROTATE", "ROTATE_KEY", "ENABLE"] },
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })) >= 120
    )
      throw new EngineError(
        "MANAGEMENT_RATE_LIMIT",
        "Webhook management rate limit reached.",
        429,
      );
    if (body.action === "create") {
      if (!workflow.enabled || workflow.archivedAt)
        throw new EngineError(
          "WORKFLOW_DISABLED",
          "Enable the workflow before adding a webhook.",
          409,
        );
      const version = await tx.workflowVersion.findFirst({
        where: { id: String(body.versionId), workflowId },
      });
      if (
        !version ||
        !validateDefinition(version.definition).nodes.some(
          (n) => n.type === "webhook_trigger",
        )
      )
        throw new EngineError(
          "INVALID_VERSION",
          "Publish a webhook-triggered workflow first.",
          409,
        );
      if ((await tx.webhook.count({ where: { workflowId } })) >= 25)
        throw new EngineError("WEBHOOK_LIMIT", "Webhook limit reached.", 429);
      const id = randomUUID(),
        secret = randomBytes(32).toString("base64url"),
        encrypted = encryptSecret(
          { secret },
          webhookContext(id, actor.workspaceId),
        );
      const hook = await tx.webhook.create({
        data: {
          id,
          workflowId,
          versionId: version.id,
          createdBy: actor.userId,
          ...encrypted,
        },
      });
      await tx.webhookAudit.create({
        data: { webhookId: id, code: "CREATED" },
      });
      return { ...metadata(hook), secret };
    }
    if (typeof body.id !== "string" || !Number.isInteger(body.revision))
      throw new EngineError(
        "INVALID_BODY",
        "Current webhook revision is required.",
      );
    await tx.$executeRaw`SELECT id FROM "Webhook" WHERE id=${body.id} AND "workflowId"=${workflowId} FOR UPDATE`;
    const hook = await tx.webhook.findFirst({
      where: { id: body.id, workflowId },
    });
    if (!hook) throw new EngineError("NOT_FOUND", "Webhook not found.", 404);
    if (hook.revision !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "Reload the webhook before changing it.",
        409,
      );
    if (hook.revokedAt)
      throw new EngineError(
        "WEBHOOK_REVOKED",
        "Create a new webhook after revocation.",
        409,
      );
    let secret: string | undefined;
    let data: Prisma.WebhookUpdateInput = { revision: { increment: 1 } };
    if (body.action === "rotate") {
      secret = randomBytes(32).toString("base64url");
      data = {
        ...data,
        ...encryptSecret(
          { secret },
          webhookContext(hook.id, actor.workspaceId),
        ),
      };
    }
    if (body.action === "rotate-key") {
      const value = decryptSecret(
        hook.ciphertext,
        webhookContext(hook.id, actor.workspaceId),
        undefined,
        hook.keyId,
      );
      data = {
        ...data,
        ...encryptSecret(value, webhookContext(hook.id, actor.workspaceId)),
      };
    }
    if (body.action === "revoke")
      data = {
        ...data,
        enabled: false,
        revokedAt: new Date(),
        ciphertext: "",
        keyId: "",
      };
    if (body.action === "enable" || body.action === "disable")
      data.enabled = body.action === "enable";
    const result = await tx.webhook.update({ where: { id: hook.id }, data });
    await tx.webhookAudit.create({
      data: {
        webhookId: hook.id,
        code: String(body.action).toUpperCase().replace("-", "_"),
      },
    });
    return { ...metadata(result), ...(secret ? { secret } : {}) };
  });
}
export async function workflowState(actor: Actor, id: string, body: unknown) {
  if (
    !isObject(body) ||
    typeof body.enabled !== "boolean" ||
    typeof body.archived !== "boolean" ||
    Object.keys(body).some((k) => !["enabled", "archived"].includes(k))
  )
    throw new EngineError("INVALID_BODY", "Supply enabled and archived flags.");
  return db.$transaction(async (tx) => {
    await owned(tx, actor, id, true);
    await tx.$executeRaw`SELECT id FROM "Workflow" WHERE id=${id} FOR UPDATE`;
    return tx.workflow.update({
      where: { id },
      data: {
        enabled: body.enabled as boolean,
        archivedAt: body.archived ? new Date() : null,
      },
      select: { id: true, enabled: true, archivedAt: true },
    });
  });
}
export async function receiveWebhook(id: string, request: Request) {
  // Fixed-size endpoint lookup and durable per-minute rate counter before reading any body.
  const found = await db.webhook.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!found) throw new EngineError("NOT_FOUND", "Webhook not found.", 404);
  const bucket = BigInt(Math.floor(Date.now() / 60000));
  const rates = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "WebhookRate" ("webhookId",bucket,count) VALUES (${id},${bucket},1) ON CONFLICT ("webhookId") DO UPDATE SET bucket=EXCLUDED.bucket,count=CASE WHEN "WebhookRate".bucket=EXCLUDED.bucket THEN LEAST("WebhookRate".count+1,61) ELSE 1 END RETURNING count`;
  if (rates[0].count > 60)
    throw new EngineError("RATE_LIMIT", "Webhook rate limit exceeded.", 429);
  const reject = async (code: string, status: number) => {
    await db.webhookAudit.create({ data: { webhookId: id, code } });
    throw new EngineError(code, "Delivery rejected.", status);
  };
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reject("INVALID_CONTENT_TYPE", 415);
  const reader = request.body?.getReader();
  if (!reader) return reject("INVALID_PAYLOAD", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.inputBytes) {
        await reader.cancel();
        return await reject("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(deadline);
  }
  if (timedOut) return reject("BODY_TIMEOUT", 408);
  const raw = Buffer.concat(chunks);
  return db.$transaction(async (tx) => {
    // Lock order matches management; rotation and admission cannot cross.
    const initial = await tx.webhook.findUniqueOrThrow({
      where: { id },
      include: { workflow: true },
    });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.workflow.workspaceId}))`;
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Workflow" WHERE id=${initial.workflowId} FOR UPDATE`;
    if (!rows.length)
      throw new EngineError("NOT_FOUND", "Webhook not found.", 404);
    await tx.$executeRaw`SELECT id FROM "Webhook" WHERE id=${id} FOR UPDATE`;
    const hook = await tx.webhook.findUniqueOrThrow({
      where: { id },
      include: { workflow: true },
    });
    const fail = async (code: string, status: number) => {
      await tx.webhookAudit.create({ data: { webhookId: id, code } });
      return { error: code, status };
    };
    if (
      !hook.enabled ||
      hook.revokedAt ||
      !hook.workflow.enabled ||
      hook.workflow.archivedAt
    )
      return fail("WEBHOOK_DISABLED", 410);
    try {
      await authorize(
        tx,
        { userId: hook.createdBy, workspaceId: hook.workflow.workspaceId },
        [...manage],
      );
    } catch {
      return fail("WEBHOOK_UNAUTHORIZED", 403);
    }
    let secret: string;
    try {
      secret = decryptSecret<{ secret: string }>(
        hook.ciphertext,
        webhookContext(id, hook.workflow.workspaceId),
        undefined,
        hook.keyId,
      ).secret;
    } catch {
      return fail("WEBHOOK_KEY_UNAVAILABLE", 503);
    }
    const deliveryId = request.headers.get("x-flowpilot-delivery-id");
    if (
      !verifySignature(
        secret,
        request.headers.get("x-flowpilot-timestamp"),
        deliveryId,
        request.headers.get("x-flowpilot-signature"),
        raw,
      )
    )
      return fail("INVALID_SIGNATURE", 401);
    if (
      await tx.webhookDelivery.findUnique({
        where: {
          webhookId_deliveryId: { webhookId: id, deliveryId: deliveryId! },
        },
      })
    )
      return fail("REPLAYED_DELIVERY", 409);
    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
      assertJson(payload, LIMITS.inputBytes);
    } catch {
      return fail("INVALID_PAYLOAD", 400);
    }
    // Same workspace queue advisory lock used by manual admission.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hook.workflow.workspaceId}))`;
    if (
      (await tx.workflowRun.count({
        where: {
          workflow: { workspaceId: hook.workflow.workspaceId },
          status: { in: ["QUEUED", "RUNNING"] },
        },
      })) >= LIMITS.pendingPerWorkspace
    )
      return fail("QUEUE_LIMIT", 429);
    const version = await tx.workflowVersion.findFirst({
      where: { id: hook.versionId, workflowId: hook.workflowId },
    });
    if (
      !version ||
      !validateDefinition(version.definition).nodes.some(
        (n) => n.type === "webhook_trigger",
      )
    )
      return fail("INVALID_VERSION", 409);
    const runId = randomUUID();
    await tx.workflowRun.create({
      data: {
        id: runId,
        workflowId: hook.workflowId,
        versionId: hook.versionId,
        requestedBy: hook.createdBy,
        idempotencyKey: `webhook_${id}_${createHash("sha256").update(deliveryId!).digest("hex")}`,
        requestHash: createHash("sha256").update(raw).digest("hex"),
        payload: seal(payload, runId),
        input: audit(payload),
      },
    });
    await tx.webhookDelivery.create({
      data: { webhookId: id, deliveryId: deliveryId!, runId },
    });
    await tx.webhookAudit.create({ data: { webhookId: id, code: "ACCEPTED" } });
    return { runId, status: 202 };
  });
}
