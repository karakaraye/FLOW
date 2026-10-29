import { resourceLimit } from "../billing/quotas";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { EngineError, isObject } from "../engine/definition";
import {
  parseFilters,
  validateContent,
  validateSlug,
  type TemplateContent,
} from "./contracts";
type Actor = { userId: string; workspaceId: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
export async function requirePlatformAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<
    { userId: string }[]
  >`SELECT "userId" FROM "PlatformAdministrator" WHERE "userId"=${userId} FOR SHARE`;
  if (!rows.length)
    throw new EngineError(
      "FORBIDDEN",
      "Platform catalog administration is required.",
      403,
    );
}
export function cloneTemplate(content: TemplateContent) {
  // Node IDs are local semantic keys: fan-in data is keyed by parent ID.
  // Preserve them while deep-copying into a new workflow. NodeRun record IDs
  // and their run/workflow ownership remain independent for every execution.
  return {
    definition: structuredClone(content.definition),
    editor: structuredClone(content.editor),
    nodeMap: Object.fromEntries(
      content.definition.nodes.map((n) => [n.id, n.id]),
    ),
  };
}

function published(row: {
  id: string;
  slug: string;
  versions: {
    id: string;
    number: number;
    content: Prisma.JsonValue;
    publishedAt: Date;
  }[];
}) {
  const version = row.versions[0];
  if (!version) return null;
  return {
    id: row.id,
    slug: row.slug,
    versionId: version.id,
    version: version.number,
    publishedAt: version.publishedAt,
    content: validateContent(version.content),
  };
}
export async function listCatalog(
  query: string | null = null,
  category: string | null = null,
) {
  const filters = parseFilters(query, category);
  // Global catalog creation is capped transactionally at 200. Filter only the
  // latest published snapshots, never editable draft metadata or old versions.
  const rows = await db.automationTemplate.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { slug: "asc" },
    take: 200,
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  return rows
    .map(published)
    .filter(
      (row) =>
        row !== null &&
        (!filters.category || row.content.category === filters.category) &&
        (!filters.query ||
          `${row.content.name} ${row.content.description}`
            .toLowerCase()
            .includes(filters.query)),
    )
    .map((row) => ({
      id: row!.id,
      slug: row!.slug,
      versionId: row!.versionId,
      version: row!.version,
      name: row!.content.name,
      description: row!.content.description,
      category: row!.content.category,
      tags: row!.content.tags,
      nodeCount: row!.content.definition.nodes.length,
    }));
}
export async function catalogDetail(slug: string) {
  validateSlug(slug);
  const row = await db.automationTemplate.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  const result = row ? published(row) : null;
  if (!result) throw new EngineError("NOT_FOUND", "Template not found.", 404);
  return result;
}
export async function createTemplate(userId: string, body: unknown) {
  if (!isObject(body))
    throw new EngineError("INVALID_BODY", "Expected slug and content.");
  const slug = validateSlug(body.slug),
    content = validateContent(body.content);
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flowpilot-template-catalog'))`;
    if ((await tx.automationTemplate.count()) >= 200)
      throw new EngineError("CATALOG_LIMIT", "Catalog capacity reached.", 429);
    if (await tx.automationTemplate.findUnique({ where: { slug } }))
      throw new EngineError("SLUG_CONFLICT", "That slug already exists.", 409);
    return tx.automationTemplate.create({
      data: { slug, draft: json(content) },
    });
  });
}
export async function listManaged(userId: string) {
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    return tx.automationTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
  });
}
export async function managedDetail(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    const template = await tx.automationTemplate.findUnique({
      where: { id },
      include: { versions: { orderBy: { number: "desc" }, take: 25 } },
    });
    if (!template)
      throw new EngineError("NOT_FOUND", "Template not found.", 404);
    return template;
  });
}
async function lockTemplate(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "AutomationTemplate" WHERE id=${id} FOR UPDATE`;
  if (!rows.length)
    throw new EngineError("NOT_FOUND", "Template not found.", 404);
  return tx.automationTemplate.findUniqueOrThrow({ where: { id } });
}
export async function editTemplate(userId: string, id: string, body: unknown) {
  if (!isObject(body) || !Number.isSafeInteger(body.revision))
    throw new EngineError("INVALID_BODY", "Supply revision and content.");
  const content = validateContent(body.content);
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    const template = await lockTemplate(tx, id);
    if (template.revision !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The template changed. Reload before editing.",
        409,
      );
    return tx.automationTemplate.update({
      where: { id },
      data: { draft: json(content), revision: { increment: 1 } },
    });
  });
}
export async function validateTemplate(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    const template = await tx.automationTemplate.findUnique({ where: { id } });
    if (!template)
      throw new EngineError("NOT_FOUND", "Template not found.", 404);
    validateContent(template.draft);
    return { valid: true, revision: template.revision };
  });
}
export async function publishTemplate(
  userId: string,
  id: string,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision))
    throw new EngineError("INVALID_BODY", "Supply the current revision.");
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    const template = await lockTemplate(tx, id);
    if (template.revision !== revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The template changed. Reload before publishing.",
        409,
      );
    const content = validateContent(template.draft);
    const version = await tx.automationTemplateVersion.upsert({
      where: {
        templateId_number: { templateId: id, number: template.revision },
      },
      create: {
        templateId: id,
        number: template.revision,
        content: json(content),
      },
      update: {},
    });
    await tx.automationTemplate.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });
    return version;
  });
}
export async function archiveTemplate(
  userId: string,
  id: string,
  revision: unknown,
) {
  if (!Number.isSafeInteger(revision))
    throw new EngineError("INVALID_BODY", "Supply the current revision.");
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    const template = await lockTemplate(tx, id);
    if (template.revision !== revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The template changed. Reload before archiving.",
        409,
      );
    return tx.automationTemplate.update({
      where: { id },
      data: { status: "ARCHIVED", revision: { increment: 1 } },
    });
  });
}
export async function installTemplate(
  actor: Actor,
  body: unknown,
  key: string | null,
) {
  if (
    !isObject(body) ||
    typeof body.versionId !== "string" ||
    body.versionId.length > 100 ||
    Object.keys(body).some((k) => k !== "versionId")
  )
    throw new EngineError("INVALID_BODY", "Supply a published versionId.");
  if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new EngineError(
      "INVALID_KEY",
      "Supply an Idempotency-Key of 8–100 safe characters.",
    );
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN", "EDITOR"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`;
    const existing = await tx.templateInstallation.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: actor.workspaceId,
          idempotencyKey: key,
        },
      },
    });
    if (existing) {
      if (existing.templateVersionId !== body.versionId)
        throw new EngineError(
          "IDEMPOTENCY_CONFLICT",
          "This key identifies another installation.",
          409,
        );
      return {
        id: existing.id,
        workflowId: existing.workflowId,
        replayed: true,
      };
    }
    const version = await tx.automationTemplateVersion.findUnique({
      where: { id: body.versionId as string },
    });
    if (!version)
      throw new EngineError(
        "NOT_FOUND",
        "Published template version not found.",
        404,
      );
    const templates = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id,status FROM "AutomationTemplate" WHERE id=${version.templateId} FOR SHARE`;
    if (templates[0]?.status !== "PUBLISHED")
      throw new EngineError(
        "NOT_FOUND",
        "Template is not available for installation.",
        404,
      );
    const content = validateContent(version.content);
    const copy = cloneTemplate(content);
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
    const workflow = await tx.workflow.create({
      data: {
        workspaceId: actor.workspaceId,
        name: content.name,
        draft: json(copy.definition),
        editor: json(copy.editor),
      },
    });
    const installation = await tx.templateInstallation.create({
      data: {
        workspaceId: actor.workspaceId,
        workflowId: workflow.id,
        templateVersionId: version.id,
        templateId: version.templateId,
        requestedBy: actor.userId,
        idempotencyKey: key,
        nodeMap: json(copy.nodeMap),
      },
    });
    return { id: installation.id, workflowId: workflow.id, replayed: false };
  });
}
export async function listInstallations(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    return tx.templateInstallation.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        workflowId: true,
        createdAt: true,
        version: {
          select: {
            id: true,
            number: true,
            content: true,
            template: { select: { slug: true, status: true } },
          },
        },
      },
    });
  });
}
export async function managedInstallations(userId: string, templateId: string) {
  return db.$transaction(async (tx) => {
    await requirePlatformAdmin(tx, userId);
    return tx.templateInstallation.findMany({
      where: { templateId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        workspaceId: true,
        workflowId: true,
        templateVersionId: true,
        createdAt: true,
      },
    });
  });
}
