import { resourceLimit, consumeQuota } from "../billing/quotas";
import { validateEditor } from "../builder/metadata";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, WorkspaceRole } from "@prisma/client";
import { db } from "../db";
import {
  assertJson,
  audit,
  canonical,
  EngineError,
  isObject,
  Json,
  LIMITS,
  validateDefinition,
} from "./definition";
import { seal } from "./payload";
type Actor = { userId: string; workspaceId: string };
const EDIT: WorkspaceRole[] = ["OWNER", "ADMIN", "EDITOR"];
const PUBLISH: WorkspaceRole[] = ["OWNER", "ADMIN"];
export const runSelect = {
  id: true,
  workflowId: true,
  versionId: true,
  status: true,
  input: true,
  output: true,
  error: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  workflow: { select: { name: true } },
  version: { select: { number: true } },
} satisfies Prisma.WorkflowRunSelect;
export async function authorize(
  tx: Prisma.TransactionClient,
  actor: Actor,
  roles?: WorkspaceRole[],
) {
  const rows = await tx.$queryRaw<
    { role: WorkspaceRole }[]
  >`SELECT role FROM "WorkspaceMember" WHERE "workspaceId"=${actor.workspaceId} AND "userId"=${actor.userId} FOR SHARE`;
  if (!rows[0]) throw new EngineError("NOT_FOUND", "Workspace not found.", 404);
  if (roles && !roles.includes(rows[0].role))
    throw new EngineError(
      "FORBIDDEN",
      "Your workspace role cannot perform this action.",
      403,
    );
}
function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new EngineError(
      "INVALID_NAME",
      "Use a workflow name of 1–100 characters.",
    );
  return value.trim();
}
function json(value: Json) {
  return value as Prisma.InputJsonValue;
}
async function lockedWorkflow(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  internal = false,
) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Workflow" WHERE id=${id} AND "workspaceId"=${actor.workspaceId} FOR UPDATE`;
  if (!rows.length)
    throw new EngineError("NOT_FOUND", "Workflow not found.", 404);
  const workflow = await tx.workflow.findUniqueOrThrow({ where: { id } });
  if (workflow.internalKind && !internal)
    throw new EngineError("NOT_FOUND", "Workflow not found.", 404);
  return workflow;
}
export async function listWorkflows(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    return tx.workflow.findMany({
      where: { workspaceId: actor.workspaceId, internalKind: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
  });
}
export async function getWorkflow(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const workflow = await tx.workflow.findFirst({
      where: { id, workspaceId: actor.workspaceId, internalKind: null },
      include: {
        versions: { orderBy: { number: "desc" }, take: 25 },
        installation: {
          select: {
            createdAt: true,
            version: {
              select: {
                number: true,
                content: true,
                template: { select: { slug: true, status: true } },
              },
            },
          },
        },
      },
    });
    if (!workflow)
      throw new EngineError("NOT_FOUND", "Workflow not found.", 404);
    return workflow;
  });
}
export async function createWorkflow(actor: Actor, body: unknown) {
  if (!isObject(body))
    throw new EngineError("INVALID_BODY", "Expected a JSON object.");
  const definition = validateDefinition(body.definition);
  const title = name(body.name);
  const editor =
    body.editor === undefined
      ? undefined
      : validateEditor(body.editor, definition);
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, EDIT);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`;
    if (
      (await tx.workflow.count({
        where: { workspaceId: actor.workspaceId },
      })) >= 2000
    )
      throw new EngineError(
        "WORKFLOW_LIMIT",
        "Workspace workflow limit reached.",
        429,
      );
    await resourceLimit(tx, actor.workspaceId, "activeWorkflows");
    return tx.workflow.create({
      data: {
        workspaceId: actor.workspaceId,
        name: title,
        draft: json(definition as unknown as Json),
        ...(editor ? { editor: json(editor as unknown as Json) } : {}),
      },
    });
  });
}
export async function editWorkflow(actor: Actor, id: string, body: unknown) {
  if (!isObject(body) || !Number.isSafeInteger(body.revision))
    throw new EngineError(
      "INVALID_BODY",
      "Expected a revision, name, and definition.",
    );
  const definition = validateDefinition(body.definition);
  const title = name(body.name);
  const editor =
    body.editor === undefined
      ? undefined
      : validateEditor(body.editor, definition);
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, EDIT);
    const workflow = await lockedWorkflow(tx, actor, id);
    if (workflow.revision !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The draft changed. Reload before editing.",
        409,
      );
    return tx.workflow.update({
      where: { id },
      data: {
        name: title,
        draft: json(definition as unknown as Json),
        editor: json(
          (editor ??
            validateEditor(
              {
                schemaVersion: 1,
                nodes: Object.fromEntries(
                  Object.entries(
                    validateEditor(
                      workflow.editor,
                      validateDefinition(workflow.draft),
                    ).nodes,
                  ).filter(([id]) => definition.nodes.some((n) => n.id === id)),
                ),
              },
              definition,
            )) as unknown as Json,
        ),
        revision: { increment: 1 },
      },
    });
  });
}
export async function publishWorkflow(
  actor: Actor,
  id: string,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision))
    throw new EngineError("INVALID_BODY", "A draft revision is required.");
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, PUBLISH);
    const workflow = await lockedWorkflow(tx, actor, id);
    if (workflow.revision !== revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The draft changed. Reload before publishing.",
        409,
      );
    validateDefinition(workflow.draft);
    return tx.workflowVersion.upsert({
      where: {
        workflowId_number: { workflowId: id, number: workflow.revision },
      },
      create: {
        workflowId: id,
        number: workflow.revision,
        definition: workflow.draft as Prisma.InputJsonValue,
        editor: workflow.editor as Prisma.InputJsonValue,
      },
      update: {},
    });
  });
}
export async function enqueue(
  actor: Actor,
  id: string,
  body: unknown,
  idempotencyKey: string | null,
  options: { tx?: Prisma.TransactionClient; internal?: boolean } = {},
) {
  if (!idempotencyKey || !/^[a-zA-Z0-9_-]{8,100}$/.test(idempotencyKey))
    throw new EngineError(
      "INVALID_KEY",
      "Supply an Idempotency-Key of 8–100 safe characters.",
    );
  if (
    !isObject(body) ||
    typeof body.versionId !== "string" ||
    !Object.hasOwn(body, "input")
  )
    throw new EngineError("INVALID_BODY", "versionId and input are required.");
  assertJson(body.input, LIMITS.inputBytes);
  const input = body.input;
  const hash = createHash("sha256")
    .update(canonical({ versionId: body.versionId, input }))
    .digest("hex");
  const admit = async (tx: Prisma.TransactionClient) => {
    await authorize(tx, actor, EDIT);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`;
    const workflow = await lockedWorkflow(tx, actor, id, options.internal);
    if (!workflow.enabled || workflow.archivedAt)
      throw new EngineError(
        "WORKFLOW_DISABLED",
        "Workflow is disabled or archived.",
        409,
      );
    const existing = await tx.workflowRun.findUnique({
      where: { workflowId_idempotencyKey: { workflowId: id, idempotencyKey } },
    });
    if (existing) {
      if (existing.requestHash !== hash)
        throw new EngineError(
          "IDEMPOTENCY_CONFLICT",
          "This key already identifies a different request.",
          409,
        );
      return { id: existing.id, replayed: true };
    }
    const version = await tx.workflowVersion.findFirst({
      where: { id: body.versionId as string, workflowId: id },
    });
    if (!version)
      throw new EngineError("NOT_FOUND", "Published version not found.", 404);
    if (
      validateDefinition(version.definition).nodes.some((n) =>
        ["webhook_trigger", "whatsapp_message_received"].includes(n.type),
      )
    )
      throw new EngineError(
        "WEBHOOK_ONLY",
        "Use a signed webhook delivery for this version.",
        409,
      );
    if (
      (await tx.workflowRun.count({
        where: {
          workflow: { workspaceId: actor.workspaceId },
          status: { in: ["QUEUED", "RUNNING"] },
        },
      })) >= LIMITS.pendingPerWorkspace
    )
      throw new EngineError(
        "QUEUE_LIMIT",
        "Workspace pending-run limit reached.",
        429,
      );
    await resourceLimit(tx, actor.workspaceId, "activeWorkflows", 0);
    const runId = randomUUID();
    await consumeQuota(tx, actor.workspaceId, "executions", runId);
    await tx.workflowRun.create({
      data: {
        id: runId,
        workflowId: id,
        versionId: version.id,
        requestedBy: actor.userId,
        idempotencyKey,
        requestHash: hash,
        payload: seal(input, runId),
        input: json(audit(input)),
      },
    });
    return { id: runId, replayed: false };
  };
  return options.tx ? admit(options.tx) : db.$transaction(admit);
}
export async function listRuns(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    return tx.workflowRun.findMany({
      where: { workflow: { workspaceId: actor.workspaceId } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      select: runSelect,
    });
  });
}
export async function getRun(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const run = await tx.workflowRun.findFirst({
      where: { id, workflow: { workspaceId: actor.workspaceId } },
      select: {
        ...runSelect,
        whatsappMessages: {
          select: {
            id: true,
            nodeId: true,
            state: true,
            kind: true,
            providerMessageId: true,
            recipientLast4: true,
            error: true,
            reviewedAt: true,
            attempts: {
              select: {
                number: true,
                state: true,
                statusCode: true,
                error: true,
              },
            },
            statuses: {
              orderBy: { providerAt: "asc" },
              select: { state: true, providerAt: true },
            },
          },
        },
        attempts: { orderBy: [{ nodeId: "asc" }, { number: "asc" }] },
        nodes: { orderBy: { position: "asc" } },
      },
    });
    if (!run) throw new EngineError("NOT_FOUND", "Run not found.", 404);
    return run;
  });
}

export async function getVersion(
  actor: Actor,
  workflowId: string,
  versionId: string,
) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const version = await tx.workflowVersion.findFirst({
      where: {
        id: versionId,
        workflowId,
        workflow: { workspaceId: actor.workspaceId },
      },
    });
    if (!version)
      throw new EngineError("NOT_FOUND", "Published version not found.", 404);
    return version;
  });
}

export async function cancelRun(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, EDIT);
    const run = await tx.workflowRun.findFirst({
      where: { id, workflow: { workspaceId: actor.workspaceId } },
    });
    if (!run) throw new EngineError("NOT_FOUND", "Run not found.", 404);
    await tx.workflowRun.updateMany({
      where: { id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "FAILED",
        error: "RUN_CANCELLED",
        payload: "",
        finishedAt: new Date(),
        output: audit(null),
      },
    });
    return { id };
  });
}
