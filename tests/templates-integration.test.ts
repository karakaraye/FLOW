import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import { seedCatalog } from "../src/lib/templates/catalog";
import {
  archiveTemplate,
  catalogDetail,
  createTemplate,
  editTemplate,
  installTemplate,
  listCatalog,
  listInstallations,
  listManaged,
  managedInstallations,
  publishTemplate,
  validateTemplate,
} from "../src/lib/templates/service";
import {
  editWorkflow,
  enqueue,
  publishWorkflow,
} from "../src/lib/engine/service";
import type { TemplateContent } from "../src/lib/templates/contracts";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
async function processRun(id: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker.ts", "--once", "--run-id", id],
    { stdio: "ignore" },
  );
  assert.equal(
    await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }),
    0,
  );
}
function isStatus(status: number) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status;
}
test(
  "template publication, installation, isolation and real seeded worker executions",
  { timeout: 120000 },
  async (t) => {
    const users: string[] = [];
    const spaces: string[] = [];
    const templates: string[] = [];
    const prefix = `test-${randomUUID()}`;
    let cookie = "";
    try {
      for (const name of [
        "Catalog operator",
        "Template owner",
        "Outside owner",
      ]) {
        const email = `template-${randomUUID()}@example.test`;
        const password = `Strong-${randomUUID()}!`;
        const result = await auth.api.signUpEmail({
          body: { email, password, name },
        });
        users.push(result.user.id);
        if (name === "Template owner") {
          const response = await auth.api.signInEmail({
            body: { email, password },
            asResponse: true,
          });
          cookie = response.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; ");
        }
      }
      const admin = users[0];
      await db.platformAdministrator.create({ data: { userId: admin } });
      for (const index of [1, 2])
        spaces.push(
          (await ensurePersonalWorkspace(users[index], "Template workspace"))
            .workspaceId,
        );
      const actor = { userId: users[1], workspaceId: spaces[0] },
        outside = { userId: users[2], workspaceId: spaces[1] };
      let id = "",
        versionId = "",
        installationId = "",
        workflowId = "";
      const key = randomUUID();
      const content = {
        ...structuredClone(seedCatalog[1].content),
        name: `Published ${prefix}`,
        description: `Catalog description ${prefix}`,
      };
      await t.test(
        "workspace OWNER/ADMIN do not gain global catalog permission",
        async () => {
          await assert.rejects(
            createTemplate(actor.userId, { slug: prefix, content }),
            isStatus(403),
          );
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: actor.workspaceId,
                userId: actor.userId,
              },
            },
            data: { role: "ADMIN" },
          });
          await assert.rejects(listManaged(actor.userId), isStatus(403));
          const response = await fetch(
            new URL("/api/platform/templates", base),
            { headers: { Cookie: cookie } },
          );
          assert.equal(response.status, 403);
        },
      );
      await t.test(
        "drafts stay private; validation and publication create an immutable version",
        async () => {
          const draft = await createTemplate(admin, { slug: prefix, content });
          id = draft.id;
          templates.push(id);
          assert.equal(
            (await fetch(new URL(`/api/templates/${prefix}`, base))).status,
            404,
          );
          assert.equal((await listCatalog(prefix)).length, 0);
          assert.equal((await validateTemplate(admin, id)).valid, true);
          const version = await publishTemplate(admin, id, 1);
          versionId = version.id;
          assert.equal((await publishTemplate(admin, id, 1)).id, versionId);
          await assert.rejects(
            db.automationTemplateVersion.update({
              where: { id: versionId },
              data: { content: {} },
            }),
          );
          await assert.rejects(
            db.automationTemplateVersion.delete({ where: { id: versionId } }),
          );
          assert.equal((await catalogDetail(prefix)).versionId, versionId);
        },
      );
      await t.test(
        "search matches published names/descriptions and category filtering is exact",
        async () => {
          assert.ok(
            (await listCatalog(prefix, "Business Operations")).some(
              (t) => t.id === id,
            ),
          );
          assert.equal(
            (await listCatalog(prefix, "Finance Operations")).length,
            0,
          );
          const response = await fetch(
            new URL(
              `/api/templates?q=${encodeURIComponent(prefix)}&category=Business%20Operations`,
              base,
            ),
          );
          assert.equal(response.status, 200);
          assert.equal((await response.json()).length, 1);
          assert.equal(
            (await fetch(new URL("/api/templates?category=Gmail", base)))
              .status,
            400,
          );
        },
      );
      await t.test(
        "invalid definitions cannot be created or published",
        async () => {
          await assert.rejects(
            createTemplate(admin, {
              slug: `bad-${prefix}`,
              content: { ...content, definition: {} },
            }),
          );
          const invalid = await createTemplate(admin, {
            slug: `invalid-${prefix}`,
            content,
          });
          templates.push(invalid.id);
          await db.automationTemplate.update({
            where: { id: invalid.id },
            data: { draft: { ...content, definition: {} } },
          });
          await assert.rejects(publishTemplate(admin, invalid.id, 1));
          assert.equal(
            await db.automationTemplateVersion.count({
              where: { templateId: invalid.id },
            }),
            0,
          );
          assert.equal(
            (await fetch(new URL(`/api/templates/invalid-${prefix}`, base)))
              .status,
            404,
          );
        },
      );
      await t.test(
        "concurrent duplicate install requests create one independent draft transactionally",
        async () => {
          const results = await Promise.all(
            Array.from({ length: 6 }, () =>
              installTemplate(actor, { versionId }, key),
            ),
          );
          assert.equal(new Set(results.map((r) => r.workflowId)).size, 1);
          assert.equal(results.filter((r) => !r.replayed).length, 1);
          workflowId = results[0].workflowId;
          installationId = results[0].id;
          const workflow = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          assert.equal(workflow.workspaceId, actor.workspaceId);
          assert.equal(
            await db.workflowVersion.count({ where: { workflowId } }),
            0,
          );
          const copy = workflow.draft as { nodes: { id: string }[] };
          assert.deepEqual(copy, content.definition);
          const installation = await db.templateInstallation.findUniqueOrThrow({
            where: { id: installationId },
          });
          assert.equal(installation.templateVersionId, versionId);
          assert.equal(installation.templateId, id);
        },
      );
      await t.test(
        "workspace roles, cross-tenant installation lists, and cross-workspace foreign keys are enforced",
        async () => {
          for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
            await db.workspaceMember.update({
              where: {
                workspaceId_userId: {
                  workspaceId: actor.workspaceId,
                  userId: actor.userId,
                },
              },
              data: { role },
            });
            if (role === "VIEWER")
              await assert.rejects(
                installTemplate(actor, { versionId }, randomUUID()),
                isStatus(403),
              );
            else await installTemplate(actor, { versionId }, randomUUID());
          }
          await assert.rejects(
            listInstallations({ ...outside, workspaceId: actor.workspaceId }),
            isStatus(404),
          );
          assert.equal((await listInstallations(outside)).length, 0);
          await assert.rejects(
            db.templateInstallation.update({
              where: { id: installationId },
              data: { workspaceId: outside.workspaceId },
            }),
          );
          await db.workspaceMember.update({
            where: {
              workspaceId_userId: {
                workspaceId: actor.workspaceId,
                userId: actor.userId,
              },
            },
            data: { role: "OWNER" },
          });
        },
      );
      await t.test(
        "installed copies remain unchanged after shared draft edits and new publications",
        async () => {
          const before = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          const changed = {
            ...structuredClone(content),
            name: `Changed ${prefix}`,
          };
          changed.definition.nodes.find(
            (n) => n.type === "condition",
          )!.config.value = 999;
          await editTemplate(admin, id, { revision: 1, content: changed });
          assert.equal((await listCatalog(`Changed ${prefix}`)).length, 0);
          assert.equal(
            (await catalogDetail(prefix)).content.name,
            content.name,
          );
          const next = await publishTemplate(admin, id, 2);
          assert.notEqual(next.id, versionId);
          assert.equal(
            (await catalogDetail(prefix)).content.name,
            changed.name,
          );
          const after = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          assert.deepEqual(after.draft, before.draft);
          assert.deepEqual(after.editor, before.editor);
          await assert.rejects(
            installTemplate(actor, { versionId: next.id }, key),
            isStatus(409),
          );
          const independent = await installTemplate(
            outside,
            { versionId },
            randomUUID(),
          );
          assert.notEqual(independent.workflowId, workflowId);
          const own = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          await editWorkflow(actor, workflowId, {
            revision: own.revision,
            name: "Independent edit",
            definition: own.draft,
            editor: own.editor,
          });
          assert.equal(
            (
              await db.workflow.findUniqueOrThrow({
                where: { id: independent.workflowId },
              })
            ).name,
            content.name,
          );
        },
      );
      await t.test(
        "archiving hides reads, blocks new installs, retains provenance and idempotent retries",
        async () => {
          await archiveTemplate(admin, id, 2);
          await assert.rejects(catalogDetail(prefix), isStatus(404));
          assert.equal((await listCatalog(prefix)).length, 0);
          await assert.rejects(
            installTemplate(actor, { versionId }, randomUUID()),
            isStatus(404),
          );
          assert.equal(
            (await installTemplate(actor, { versionId }, key)).workflowId,
            workflowId,
          );
          assert.ok(
            (await listInstallations(actor)).some(
              (i) => i.workflowId === workflowId,
            ),
          );
          assert.ok((await managedInstallations(admin, id)).length >= 1);
          const own = await db.workflow.findUniqueOrThrow({
            where: { id: workflowId },
          });
          const version = await publishWorkflow(
            actor,
            workflowId,
            own.revision,
          );
          const run = await enqueue(
            actor,
            workflowId,
            { versionId: version.id, input: content.exampleInput },
            randomUUID(),
          );
          await processRun(run.id);
          assert.equal(
            (await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } }))
              .status,
            "SUCCEEDED",
          );
        },
      );
      await t.test(
        "every real seeded template installs, publishes and executes through a separate worker",
        async () => {
          for (const seed of seedCatalog) {
            const shared = await catalogDetail(seed.slug);
            const source = shared.content as TemplateContent;
            const installed = await installTemplate(
              actor,
              { versionId: shared.versionId },
              randomUUID(),
            );
            const version = await publishWorkflow(
              actor,
              installed.workflowId,
              1,
            );
            const run = await enqueue(
              actor,
              installed.workflowId,
              { versionId: version.id, input: source.exampleInput },
              randomUUID(),
            );
            await processRun(run.id);
            const persisted = await db.workflowRun.findUniqueOrThrow({
              where: { id: run.id },
              include: { nodes: true },
            });
            assert.equal(persisted.status, "SUCCEEDED", seed.slug);
            assert.equal(
              persisted.nodes.length,
              source.definition.nodes.length,
              seed.slug,
            );
            assert.equal(
              persisted.nodes.filter((n) => n.status === "FAILED").length,
              0,
            );
          }
        },
      );
      await t.test(
        "platform permission revocation immediately blocks management",
        async () => {
          await db.platformAdministrator.delete({ where: { userId: admin } });
          await assert.rejects(listManaged(admin), isStatus(403));
        },
      );
    } finally {
      await db.workspace.deleteMany({ where: { id: { in: spaces } } });
      await db.automationTemplate.deleteMany({
        where: { id: { in: templates } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
