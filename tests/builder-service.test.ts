import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { db } from "../src/lib/db";
import {
  createWorkflow,
  editWorkflow,
  getVersion,
  publishWorkflow,
} from "../src/lib/engine/service";
import { normalizeDocument } from "../src/lib/builder/document";
import { starterDefinition } from "../src/lib/engine/example";
test("canvas metadata persistence and security in real PostgreSQL", async (t) => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const outsiderId = randomUUID();
  await db.user.createMany({
    data: [
      {
        id: userId,
        name: "Builder test",
        email: `builder-${userId}@example.test`,
      },
      {
        id: outsiderId,
        name: "Outside",
        email: `outside-${outsiderId}@example.test`,
      },
    ],
  });
  await db.workspace.create({
    data: {
      id: workspaceId,
      name: "Builder test workspace",
      members: { create: { userId, role: "OWNER" } },
    },
  });
  const actor = { userId, workspaceId };
  let workflowId = "",
    versionId = "";
  const document = normalizeDocument("Builder", starterDefinition);
  try {
    await t.test(
      "saving and loading metadata preserves engine JSON and identifiers",
      async () => {
        const workflow = await createWorkflow(actor, {
          name: document.name,
          definition: document.definition,
          editor: document.editor,
        });
        workflowId = workflow.id;
        assert.deepEqual(workflow.editor, document.editor);
        assert.deepEqual(workflow.draft, starterDefinition);
      },
    );
    await t.test(
      "publishing snapshots metadata; subsequent edits cannot mutate it",
      async () => {
        const published = await publishWorkflow(actor, workflowId, 1);
        versionId = published.id;
        const edited = structuredClone(document.editor);
        edited.nodes.start = {
          x: 200,
          y: 300,
          label: "Moved after publishing",
        };
        await editWorkflow(actor, workflowId, {
          name: "Edited",
          revision: 1,
          definition: starterDefinition,
          editor: edited,
        });
        const snapshot = await getVersion(actor, workflowId, versionId);
        assert.deepEqual(snapshot.editor, document.editor);
        assert.deepEqual(snapshot.definition, starterDefinition);
        await assert.rejects(
          db.workflowVersion.update({
            where: { id: versionId },
            data: { editor: edited },
          }),
        );
      },
    );
    await t.test(
      "backend rejects foreign canvas nodes and viewer metadata changes",
      async () => {
        await assert.rejects(
          editWorkflow(actor, workflowId, {
            name: "Bad",
            revision: 2,
            definition: starterDefinition,
            editor: {
              schemaVersion: 1,
              nodes: { foreign: { x: 0, y: 0, label: "Foreign" } },
            },
          }),
        );
        await db.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: "VIEWER" },
        });
        await assert.rejects(
          editWorkflow(actor, workflowId, {
            name: "Forbidden",
            revision: 2,
            definition: starterDefinition,
            editor: document.editor,
          }),
          (error) =>
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 403,
        );
      },
    );
    await t.test(
      "published definition and layout cannot be read across tenant boundaries",
      async () => {
        await assert.rejects(
          getVersion(
            { userId: outsiderId, workspaceId },
            workflowId,
            versionId,
          ),
          (error) =>
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 404,
        );
      },
    );
    await t.test(
      "legacy JSON clients may edit graphs without orphaning saved layout",
      async () => {
        await db.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId } },
          data: { role: "OWNER" },
        });
        const minimal = {
          schemaVersion: 1,
          nodes: [starterDefinition.nodes[0]],
          edges: [],
        };
        const workflow = await editWorkflow(actor, workflowId, {
          name: "Legacy",
          revision: 2,
          definition: minimal,
        });
        assert.deepEqual(workflow.draft, minimal);
        assert.deepEqual(
          Object.keys((workflow.editor as { nodes: object }).nodes),
          ["start"],
        );
      },
    );
  } finally {
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } });
    await db.$disconnect();
  }
});
