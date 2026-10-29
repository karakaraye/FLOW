import { resourceLimit } from "../billing/quotas";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { authorize } from "../engine/service";
import { EngineError, isObject } from "../engine/definition";
import { encryptSecret, decryptSecret } from "../integrations/crypto";
import type { CredentialSet } from "../integrations/contracts";
import { requestJson } from "./network";
import { httpConfig } from "./config";
export function allowedOrigin(url: URL) {
  let list: unknown;
  try {
    list = JSON.parse(process.env.HTTP_ACTION_ALLOWED_ORIGINS ?? "[]");
  } catch {
    list = [];
  }
  if (!Array.isArray(list) || !list.includes(url.origin))
    throw new EngineError(
      "DESTINATION_NOT_APPROVED",
      "Ask your administrator to approve this HTTPS origin.",
      422,
    );
}
export function retryApproved(url: URL) {
  try {
    const values = JSON.parse(process.env.HTTP_IDEMPOTENT_ORIGINS ?? "[]");
    return Array.isArray(values) && values.includes(url.origin);
  } catch {
    return false;
  }
}
export async function storeHttpCredential(
  actor: { userId: string; workspaceId: string },
  id: string,
  body: unknown,
) {
  if (
    !isObject(body) ||
    Object.keys(body).some(
      (k) => !["revision", "token", "healthUrl", "expiresAt"].includes(k),
    ) ||
    !Number.isInteger(body.revision) ||
    typeof body.token !== "string" ||
    !/^[\x21-\x7e]{8,4096}$/.test(body.token) ||
    typeof body.healthUrl !== "string" ||
    typeof body.expiresAt !== "string"
  )
    throw new EngineError(
      "INVALID_BODY",
      "Supply a bearer token, verification URL, expiry, and current revision.",
    );
  const url = httpConfig({
    method: "GET",
    url: body.healthUrl,
    headers: {},
    timeoutMs: 5000,
  });
  allowedOrigin(url);
  const expires = new Date(body.expiresAt);
  if (
    !Number.isFinite(expires.getTime()) ||
    expires.getTime() <= Date.now() ||
    expires.getTime() > Date.now() + 90 * 86400000
  )
    throw new EngineError(
      "INVALID_BODY",
      "Expiry must be within the next 90 days.",
    );
  await db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN"]);
    const row = await tx.workspaceIntegration.findFirst({
      where: {
        id,
        workspaceId: actor.workspaceId,
        providerId: "https-bearer",
        deletedAt: null,
        provider: { state: "AVAILABLE" },
      },
    });
    if (!row)
      throw new EngineError("NOT_FOUND", "HTTPS connection not found.", 404);
    if (row.revision !== body.revision)
      throw new EngineError("REVISION_CONFLICT", "Reload the connection.", 409);
  });
  // No database lock is held while contacting the approved, pinned destination.
  const verified = await requestJson(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${body.token}` },
    timeoutMs: 5000,
  });
  if (verified.status < 200 || verified.status >= 300)
    throw new EngineError(
      "HTTP_VERIFICATION_FAILED",
      "The destination rejected credential verification.",
      422,
    );
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN"]);
    await tx.$executeRaw`SELECT id FROM "WorkspaceIntegration" WHERE id=${id} AND "workspaceId"=${actor.workspaceId} FOR UPDATE`;
    const row = await tx.workspaceIntegration.findFirst({
      where: {
        id,
        workspaceId: actor.workspaceId,
        providerId: "https-bearer",
        deletedAt: null,
        provider: { state: "AVAILABLE" },
      },
    });
    if (!row) throw new EngineError("NOT_FOUND", "Connection not found.", 404);
    if (row.revision !== body.revision)
      throw new EngineError(
        "REVISION_CONFLICT",
        "The connection changed during verification.",
        409,
      );
    await resourceLimit(tx, actor.workspaceId, "integrations", 0);
    const old = await tx.integrationCredential.findUnique({
        where: { integrationId: id },
      }),
      recordId = old?.id ?? randomUUID();
    const credential: CredentialSet = {
      accessToken: body.token as string,
      refreshToken: "",
      expiresAt: expires.toISOString(),
      scopes: [`origin:${url.origin}`],
    };
    const encrypted = encryptSecret(credential, {
      workspaceId: actor.workspaceId,
      integrationId: id,
      providerId: "https-bearer",
      recordId,
      purpose: "credential",
    });
    await tx.integrationCredential.upsert({
      where: { integrationId: id },
      create: {
        id: recordId,
        integrationId: id,
        workspaceId: actor.workspaceId,
        providerId: "https-bearer",
        ...encrypted,
        issuedAt: new Date(),
        expiresAt: expires,
      },
      update: {
        ...encrypted,
        issuedAt: new Date(),
        expiresAt: expires,
        destroyedAt: null,
        revokedAt: null,
        generation: { increment: 1 },
      },
    });
    const result = await tx.workspaceIntegration.update({
      where: { id },
      data: {
        status: "CONNECTED",
        scopes: credential.scopes,
        revokedAt: null,
        lastVerifiedAt: new Date(),
        lastErrorCode: null,
        revision: { increment: 1 },
      },
      select: { id: true, revision: true, status: true },
    });
    await tx.integrationAuditEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        integrationId: id,
        providerId: "https-bearer",
        actorId: actor.userId,
        kind: "AUTHENTICATION_SUCCEEDED",
        status: "CONNECTED",
        revision: result.revision,
      },
    });
    return result;
  });
}
export async function credentialForRun(
  runId: string,
  connectionId: string,
  url: URL,
) {
  return db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { workflow: true },
    });
    await authorize(
      tx,
      { workspaceId: run.workflow.workspaceId, userId: run.requestedBy },
      ["OWNER", "ADMIN", "EDITOR"],
    );
    if (!run.workflow.enabled || run.workflow.archivedAt)
      throw new EngineError("WORKFLOW_DISABLED", "Workflow is disabled.", 422);
    const row = await tx.workspaceIntegration.findFirst({
      where: {
        id: connectionId,
        workspaceId: run.workflow.workspaceId,
        providerId: "https-bearer",
        status: "CONNECTED",
        deletedAt: null,
        revokedAt: null,
        provider: { state: "AVAILABLE" },
      },
      include: { credential: true },
    });
    if (
      !row?.credential ||
      row.credential.destroyedAt ||
      row.credential.revokedAt ||
      row.credential.expiresAt.getTime() <= Date.now() ||
      !row.scopes.includes(`origin:${url.origin}`)
    )
      throw new EngineError(
        "HTTP_CREDENTIAL_UNAVAILABLE",
        "No usable credential is approved for this destination.",
        422,
      );
    const value = decryptSecret<CredentialSet>(
      row.credential.ciphertext,
      {
        workspaceId: row.workspaceId,
        integrationId: row.id,
        providerId: row.providerId,
        recordId: row.credential.id,
        purpose: "credential",
      },
      undefined,
      row.credential.keyId,
    );
    if (
      !value.scopes.includes(`origin:${url.origin}`) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= Date.now() ||
      !/^[\x21-\x7e]{8,4096}$/.test(value.accessToken)
    )
      throw new EngineError(
        "HTTP_CREDENTIAL_UNAVAILABLE",
        "Credential binding is invalid.",
        422,
      );
    return value.accessToken;
  });
}
