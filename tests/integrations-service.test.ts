import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { auth } from "../src/lib/auth";
import { ensurePersonalWorkspace } from "../src/lib/workspaces";
import {
  createConnection,
  getConnection,
  listConnections,
  listEvents,
  listProviders,
  operate,
  updateLabel,
} from "../src/lib/integrations/service";
import { decryptSecret } from "../src/lib/integrations/crypto";
import { localTestAdapter } from "../src/lib/integrations/test-adapter";
import { EngineError } from "../src/lib/engine/definition";
import type { CredentialSet } from "../src/lib/integrations/contracts";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const hasStatus = (status: number) => (error: unknown) =>
  error instanceof EngineError && error.status === status;
function noSecrets(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(
    text,
    /"(?:accessToken|refreshToken|ciphertext|keyId|authStateCiphertext|authStateHash|verifier|proof|authAttemptId|authInitiatedBy)"/,
  );
  assert.ok(!text.includes("unit-provider-sensitive-error"));
}
test(
  "secure workspace integration lifecycle and metadata-only APIs",
  { timeout: 60000 },
  async (t) => {
    const users: string[] = [],
      spaces: string[] = [];
    let cookie = "";
    const originalKeys = process.env.INTEGRATION_ENCRYPTION_KEYS,
      originalActive = process.env.INTEGRATION_ACTIVE_KEY_ID;
    try {
      for (const name of ["Integration Owner", "Outside Owner"]) {
        const email = `integration-${randomUUID()}@example.test`,
          password = `Strong-${randomUUID()}!`;
        const result = await auth.api.signUpEmail({
          body: { name, email, password },
        });
        users.push(result.user.id);
        spaces.push(
          (await ensurePersonalWorkspace(result.user.id, name)).workspaceId,
        );
        if (users.length === 1) {
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
      const actor = { userId: users[0], workspaceId: spaces[0] },
        outside = { userId: users[1], workspaceId: spaces[1] };
      let id = "",
        gmailId = "",
        tokenToCheck = "";
      async function api(
        path: string,
        method = "GET",
        body?: unknown,
        withCookie = true,
      ) {
        return fetch(
          new URL(`/api/workspaces/${actor.workspaceId}${path}`, base),
          {
            method,
            headers: {
              Origin: base,
              "Content-Type": "application/json",
              ...(withCookie ? { Cookie: cookie } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
        );
      }
      await t.test(
        "future provider records remain disconnected and cannot authenticate",
        async () => {
          const providers = await listProviders(actor);
          assert.equal(
            providers.filter((p) => p.state === "COMING_SOON").length,
            5,
          );
          assert.ok(
            providers.some((p) => p.id === "local-test" && p.available),
          );
          const gmail = await createConnection(actor, {
            providerId: "gmail",
            label: "Planned mail record",
          });
          gmailId = gmail.id;
          assert.equal(gmail.status, "DISCONNECTED");
          await assert.rejects(
            operate(actor, gmailId, gmail.revision, "begin-test"),
            hasStatus(409),
          );
          assert.equal(
            (await getConnection(actor, gmailId)).status,
            "DISCONNECTED",
          );
          assert.equal(
            await db.integrationCredential.count({
              where: { integrationId: gmailId },
            }),
            0,
          );
        },
      );
      await t.test(
        "concurrent creation enforces one live identity per provider and workspace",
        async () => {
          const results = await Promise.allSettled([
            createConnection(actor, {
              providerId: "local-test",
              label: "Local test",
            }),
            createConnection(actor, {
              providerId: "local-test",
              label: "Duplicate",
            }),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          const success = results.find((r) => r.status === "fulfilled");
          assert.ok(success?.status === "fulfilled");
          id = success.value.id;
          assert.equal(success.value.status, "DISCONNECTED");
          assert.equal(
            await db.workspaceIntegration.count({
              where: {
                workspaceId: actor.workspaceId,
                providerId: "local-test",
                deletedAt: null,
              },
            }),
            1,
          );
        },
      );
      await t.test(
        "pending state is encrypted and CONNECTED follows actual signed callback and health verification",
        async () => {
          const initial = await getConnection(actor, id);
          const pending = await operate(
            actor,
            id,
            initial.revision,
            "begin-test",
          );
          assert.equal(pending.status, "PENDING");
          noSecrets(pending);
          const raw = await db.workspaceIntegration.findUniqueOrThrow({
            where: { id },
          });
          assert.ok(
            raw.authStateCiphertext && raw.authStateHash && raw.authAttemptId,
          );
          assert.ok(!raw.authStateCiphertext.includes('"verifier"'));
          const connected = await operate(
            actor,
            id,
            pending.revision,
            "complete-test",
          );
          assert.equal(connected.status, "CONNECTED");
          assert.ok(connected.lastVerifiedAt && connected.hasCredential);
          const stored = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: id },
          });
          const secret = decryptSecret<CredentialSet>(stored.ciphertext, {
            workspaceId: actor.workspaceId,
            integrationId: id,
            providerId: "local-test",
            recordId: stored.id,
            purpose: "credential",
          });
          await localTestAdapter.health(
            {
              workspaceId: actor.workspaceId,
              integrationId: id,
              providerId: "local-test",
            },
            secret,
          );
          tokenToCheck = secret.accessToken;
          assert.ok(!stored.ciphertext.includes(secret.accessToken));
          assert.ok(!stored.ciphertext.includes(secret.refreshToken));
          assert.equal(
            (await db.workspaceIntegration.findUniqueOrThrow({ where: { id } }))
              .authStateCiphertext,
            null,
          );
          await assert.rejects(
            operate(actor, id, connected.revision, "complete-test"),
            hasStatus(409),
          );
        },
      );
      await t.test(
        "APIs expose metadata/audit only and reject unauthenticated, cross-origin, and credential-input requests",
        async () => {
          for (const path of [
            "/integration-providers",
            "/integrations",
            `/integrations/${id}`,
            "/integration-events",
          ]) {
            const response = await api(path);
            assert.equal(response.status, 200);
            const value = await response.json();
            noSecrets(value);
            assert.ok(!JSON.stringify(value).includes(tokenToCheck));
            assert.equal(
              (await api(path, "GET", undefined, false)).status,
              401,
            );
          }
          assert.equal(
            (await api(`/integrations/${id}/credentials`)).status,
            404,
          );
          const current = await getConnection(actor, id);
          const denied = await fetch(
            new URL(
              `/api/workspaces/${actor.workspaceId}/integrations/${id}/revoke`,
              base,
            ),
            {
              method: "POST",
              headers: {
                Origin: "https://evil.example",
                Cookie: cookie,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ revision: current.revision }),
            },
          );
          assert.equal(denied.status, 403);
          assert.equal(
            (
              await api(`/integrations/${id}/test/complete`, "POST", {
                revision: current.revision,
                proof: "unit-client-fake-proof",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await api("/integrations", "POST", {
                providerId: "openai",
                label: "bad",
                accessToken: "unit-client-token",
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "concurrent label edits have one winner and preserve credential secrecy",
        async () => {
          const current = await getConnection(actor, id);
          const results = await Promise.allSettled([
            updateLabel(actor, id, {
              revision: current.revision,
              label: "Renamed local test",
            }),
            updateLabel(actor, id, {
              revision: current.revision,
              label: "Conflicting label",
            }),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          const failure = results.find((r) => r.status === "rejected");
          assert.ok(
            failure?.status === "rejected" && hasStatus(409)(failure.reason),
          );
        },
      );
      await t.test(
        "expiry is reported and refresh verifies a new token without returning it",
        async () => {
          await db.integrationCredential.update({
            where: { integrationId: id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          const expired = await getConnection(actor, id);
          assert.equal(expired.status, "EXPIRED");
          await assert.rejects(
            operate(actor, id, expired.revision, "health"),
            (error) =>
              error instanceof EngineError && error.code === "TOKEN_EXPIRED",
          );
          const current = await getConnection(actor, id);
          assert.equal(current.status, "EXPIRED");
          const refreshed = await operate(
            actor,
            id,
            current.revision,
            "refresh",
          );
          assert.equal(refreshed.status, "CONNECTED");
          noSecrets(refreshed);
          assert.ok(
            (
              await db.integrationCredential.findUniqueOrThrow({
                where: { integrationId: id },
              })
            ).refreshedAt,
          );
        },
      );
      await t.test(
        "all roles may read but only OWNER/ADMIN manage or decrypt through operations",
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
            const current = await getConnection(actor, id);
            noSecrets(current);
            assert.ok((await listEvents(actor, id)).length);
            if (role === "OWNER" || role === "ADMIN")
              await operate(actor, id, current.revision, "health");
            else {
              await assert.rejects(
                operate(actor, id, current.revision, "health"),
                hasStatus(403),
              );
              await assert.rejects(
                updateLabel(actor, id, {
                  revision: current.revision,
                  label: "Forbidden",
                }),
                hasStatus(403),
              );
              assert.equal(
                (
                  await api(`/integrations/${id}/refresh`, "POST", {
                    revision: current.revision,
                  })
                ).status,
                403,
              );
            }
          }
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
        "foreign workspaces cannot read credentials, metadata, events, or relink credential rows",
        async () => {
          await assert.rejects(getConnection(outside, id), hasStatus(404));
          await assert.rejects(listEvents(outside, id), hasStatus(404));
          await assert.rejects(
            getConnection({ ...outside, workspaceId: actor.workspaceId }, id),
            hasStatus(404),
          );
          assert.equal((await listConnections(outside)).length, 0);
          assert.equal((await listEvents(outside)).length, 0);
          await assert.rejects(
            db.integrationCredential.update({
              where: { integrationId: id },
              data: { workspaceId: outside.workspaceId },
            }),
          );
        },
      );
      await t.test(
        "pending attempts expire, reject tampered state, and bind completion to the initiating user",
        async () => {
          let current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "begin-test");
          await db.workspaceIntegration.update({
            where: { id },
            data: { authExpiresAt: new Date(Date.now() - 1) },
          });
          await assert.rejects(
            operate(actor, id, current.revision, "complete-test"),
            (error) =>
              error instanceof EngineError &&
              error.code === "AUTH_ATTEMPT_EXPIRED",
          );
          current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "begin-test");
          await db.workspaceIntegration.update({
            where: { id },
            data: { authStateHash: "bad" },
          });
          await assert.rejects(
            operate(actor, id, current.revision, "complete-test"),
            (error) =>
              error instanceof EngineError &&
              error.code === "AUTH_BINDING_INVALID",
          );
          current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "begin-test");
          await db.workspaceMember.create({
            data: {
              workspaceId: actor.workspaceId,
              userId: outside.userId,
              role: "ADMIN",
            },
          });
          try {
            await assert.rejects(
              operate(
                { ...outside, workspaceId: actor.workspaceId },
                id,
                current.revision,
                "complete-test",
              ),
              hasStatus(403),
            );
          } finally {
            await db.workspaceMember.delete({
              where: {
                workspaceId_userId: {
                  workspaceId: actor.workspaceId,
                  userId: outside.userId,
                },
              },
            });
          }
          current = await operate(actor, id, current.revision, "complete-test");
          assert.equal(current.status, "CONNECTED");
        },
      );
      await t.test(
        "pending authentication state survives key rotation without reusing a callback",
        async () => {
          const previousKeys = process.env.INTEGRATION_ENCRYPTION_KEYS!,
            previousActive = process.env.INTEGRATION_ACTIVE_KEY_ID!;
          try {
            let pending = await createConnection(outside, {
              providerId: "local-test",
              label: "Pending rotation test",
            });
            pending = await operate(
              outside,
              pending.id,
              pending.revision,
              "begin-test",
            );
            const retained = JSON.parse(previousKeys);
            const newer = randomBytes(32).toString("base64");
            process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
              ...retained,
              "pending-test": newer,
            });
            process.env.INTEGRATION_ACTIVE_KEY_ID = "pending-test";
            pending = await operate(
              outside,
              pending.id,
              pending.revision,
              "rotate-key",
            );
            process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
              "pending-test": newer,
            });
            const connected = await operate(
              outside,
              pending.id,
              pending.revision,
              "complete-test",
            );
            assert.equal(connected.status, "CONNECTED");
            await assert.rejects(
              operate(
                outside,
                connected.id,
                connected.revision,
                "complete-test",
              ),
              hasStatus(409),
            );
            await operate(outside, connected.id, connected.revision, "revoke");
          } finally {
            process.env.INTEGRATION_ENCRYPTION_KEYS = previousKeys;
            process.env.INTEGRATION_ACTIVE_KEY_ID = previousActive;
          }
        },
      );
      await t.test(
        "provider failures never leak secrets through errors or persisted audit codes",
        async () => {
          const health = localTestAdapter.health;
          localTestAdapter.health = async () => {
            throw new EngineError(
              "UNTRUSTED_PROVIDER_ERROR",
              "unit-provider-sensitive-error",
            );
          };
          try {
            const current = await getConnection(actor, id);
            await assert.rejects(
              operate(actor, id, current.revision, "health"),
              (error) =>
                error instanceof EngineError &&
                error.code === "PROVIDER_OPERATION_FAILED" &&
                !error.message.includes("unit-provider-sensitive-error"),
            );
          } finally {
            localTestAdapter.health = health;
          }
          let current = await getConnection(actor, id);
          assert.equal(current.status, "ERROR");
          noSecrets(await listEvents(actor, id));
          current = await operate(actor, id, current.revision, "health");
          assert.equal(current.status, "CONNECTED");
        },
      );
      await t.test(
        "key rotation reencrypts real credentials; missing keys fail closed; revocation still erases them",
        async () => {
          const ring = JSON.parse(originalKeys!);
          process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
            ...ring,
            "test-rotation": randomBytes(32).toString("base64"),
          });
          process.env.INTEGRATION_ACTIVE_KEY_ID = "test-rotation";
          let current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "rotate-key");
          const stored = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: id },
          });
          assert.equal(stored.keyId, "test-rotation");
          assert.ok(stored.rotatedAt);
          const active = JSON.parse(process.env.INTEGRATION_ENCRYPTION_KEYS)[
            "test-rotation"
          ];
          process.env.INTEGRATION_ENCRYPTION_KEYS = JSON.stringify({
            "test-rotation": active,
          });
          current = await operate(actor, id, current.revision, "health");
          process.env.INTEGRATION_ENCRYPTION_KEYS = "";
          await assert.rejects(
            operate(actor, id, current.revision, "health"),
            (error) =>
              error instanceof EngineError &&
              error.code === "CREDENTIAL_CONFIGURATION_UNAVAILABLE" &&
              error.status === 503,
          );
          current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "revoke");
          assert.equal(current.status, "REVOKED");
          assert.equal(current.hasCredential, false);
          const erased = await db.integrationCredential.findUniqueOrThrow({
            where: { integrationId: id },
          });
          assert.equal(erased.ciphertext, "");
          assert.ok(erased.destroyedAt && erased.revokedAt);
          process.env.INTEGRATION_ENCRYPTION_KEYS = originalKeys;
          process.env.INTEGRATION_ACTIVE_KEY_ID = originalActive;
          await assert.rejects(
            operate(actor, id, current.revision, "refresh"),
            hasStatus(409),
          );
          assert.equal((await getConnection(actor, id)).status, "REVOKED");
        },
      );
      await t.test(
        "connection deletion preserves immutable audit history and permits a new identity slot",
        async () => {
          const current = await getConnection(actor, gmailId);
          await operate(actor, gmailId, current.revision, "delete");
          await assert.rejects(getConnection(actor, gmailId), hasStatus(404));
          const events = await listEvents(actor, gmailId);
          assert.ok(events.some((e) => e.kind === "DELETED"));
          await assert.rejects(
            db.integrationAuditEvent.update({
              where: { id: events[0].id },
              data: { code: "tampered" },
            }),
          );
          await assert.rejects(
            db.integrationAuditEvent.delete({ where: { id: events[0].id } }),
          );
          const replacement = await createConnection(actor, {
            providerId: "gmail",
            label: "New disconnected record",
          });
          assert.notEqual(replacement.id, gmailId);
          assert.equal(replacement.status, "DISCONNECTED");
        },
      );
      await t.test(
        "concurrent refresh/revoke cannot resurrect a revoked credential",
        async () => {
          let current = await getConnection(actor, id);
          current = await operate(actor, id, current.revision, "begin-test");
          current = await operate(actor, id, current.revision, "complete-test");
          const changes = await Promise.allSettled([
            operate(actor, id, current.revision, "refresh"),
            operate(actor, id, current.revision, "revoke"),
          ]);
          assert.equal(
            changes.filter((r) => r.status === "fulfilled").length,
            1,
          );
          const failure = changes.find((r) => r.status === "rejected");
          assert.ok(
            failure?.status === "rejected" && hasStatus(409)(failure.reason),
          );
          current = await getConnection(actor, id);
          if (current.status !== "REVOKED")
            current = await operate(actor, id, current.revision, "revoke");
          assert.equal(current.status, "REVOKED");
          assert.equal(
            (
              await db.integrationCredential.findUniqueOrThrow({
                where: { integrationId: id },
              })
            ).ciphertext,
            "",
          );
          noSecrets(await listEvents(actor));
        },
      );
    } finally {
      if (originalKeys === undefined)
        delete process.env.INTEGRATION_ENCRYPTION_KEYS;
      else process.env.INTEGRATION_ENCRYPTION_KEYS = originalKeys;
      if (originalActive === undefined)
        delete process.env.INTEGRATION_ACTIVE_KEY_ID;
      else process.env.INTEGRATION_ACTIVE_KEY_ID = originalActive;
      await db.workspace.deleteMany({ where: { id: { in: spaces } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
