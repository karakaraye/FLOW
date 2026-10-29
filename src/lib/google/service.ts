import { randomUUID, randomBytes } from "node:crypto";
import { Client } from "pg";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { EngineError } from "../engine/definition";
import {
  lock,
  readCredential,
  saveCredential,
  operate,
  getConnection,
  bindCredentialPersistence,
} from "../integrations/service";
import {
  createPkceState,
  stateHash,
  matchesState,
} from "../integrations/oauth-state";
import { encryptSecret, decryptSecret } from "../integrations/crypto";
import type {
  AuthenticationState,
  CredentialSet,
} from "../integrations/contracts";
import { isGoogleProvider, type GoogleProvider } from "./config";
import {
  authorizationUrl,
  exchangeGoogle,
  googleSettings,
  googleError,
  refreshGoogle,
  revokeGoogle,
  validateScopes,
} from "./provider";
type Actor = { userId: string; workspaceId: string };
const clear = {
  authAttemptId: null,
  authInitiatedBy: null,
  authStateHash: null,
  authStateCiphertext: null,
  authExpiresAt: null,
};
function pendingContext(row: {
  id: string;
  workspaceId: string;
  providerId: string;
  authAttemptId: string | null;
}) {
  return {
    workspaceId: row.workspaceId,
    integrationId: row.id,
    providerId: row.providerId,
    recordId: row.authAttemptId!,
    purpose: "authentication-state" as const,
  };
}
export async function beginGoogle(actor: Actor, id: string, revision: number) {
  return db.$transaction(async (tx) => {
    const row = await lock(tx, actor, id, revision);
    googleSettings();
    if (!isGoogleProvider(row.providerId) || row.provider.state === "DISABLED")
      throw new EngineError("NOT_FOUND", "Google provider not available.", 404);
    const state = createPkceState(googleSettings().redirect),
      nonce = randomBytes(32).toString("base64url"),
      attemptId = randomUUID(),
      expiresAt = new Date(Date.now() + 300000);
    const context = pendingContext({ ...row, authAttemptId: attemptId });
    const sealed = encryptSecret({ ...state, nonce }, context);
    await tx.googleOAuthAttempt.create({
      data: {
        id: attemptId,
        integrationId: id,
        stateHash: stateHash(state.state),
        expiresAt,
      },
    });
    await bindCredentialPersistence(tx, row).erase();
    await tx.workspaceIntegration.update({
      where: { id },
      data: {
        scopes: [],
        accountSubject: null,
        accountEmail: null,
        status: "PENDING",
        authAttemptId: attemptId,
        authInitiatedBy: actor.userId,
        authStateHash: stateHash(state.state),
        authStateCiphertext: sealed.ciphertext,
        authExpiresAt: expiresAt,
        revision: { increment: 1 },
        lastErrorCode: null,
      },
    });
    await tx.integrationAuditEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        integrationId: id,
        providerId: row.providerId,
        actorId: actor.userId,
        kind: "AUTHENTICATION_STARTED",
        status: "PENDING",
        revision: revision + 1,
      },
    });
    return { authorizationUrl: authorizationUrl(row.providerId, state, nonce) };
  });
}
export async function completeGoogle(
  userId: string,
  state: string,
  code: string,
  callbackUri: string,
  denied = false,
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    (!code && !denied) ||
    code.length > 4096 ||
    /[\r\n]/.test(code) ||
    callbackUri !== googleSettings().redirect
  )
    throw new EngineError(
      "GOOGLE_CALLBACK_INVALID",
      "Invalid Google callback.",
      400,
    );
  const attempt = await db.googleOAuthAttempt.findUnique({
    where: { stateHash: stateHash(state) },
    include: { integration: true },
  });
  if (!attempt)
    throw new EngineError(
      "GOOGLE_STATE_INVALID",
      "Authorization state is invalid.",
      400,
    );
  const actor = { userId, workspaceId: attempt.integration.workspaceId },
    id = attempt.integrationId;
  const captured = await db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN"]);
    await tx.$executeRaw`SELECT id FROM "WorkspaceIntegration" WHERE id=${id} FOR UPDATE`;
    const row = await tx.workspaceIntegration.findUniqueOrThrow({
      where: { id },
      include: { credential: true, provider: true },
    });
    const current = await tx.googleOAuthAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (
      current.consumedAt ||
      current.expiresAt <= new Date() ||
      row.authAttemptId !== attempt.id ||
      row.authInitiatedBy !== userId ||
      row.status !== "PENDING" ||
      !row.authStateHash ||
      !matchesState(state, row.authStateHash) ||
      !isGoogleProvider(row.providerId) ||
      row.provider.state === "DISABLED" ||
      row.deletedAt
    )
      throw new EngineError(
        "GOOGLE_STATE_INVALID",
        "Authorization is expired, consumed, or bound to another member.",
        400,
      );
    const pending = decryptSecret<AuthenticationState & { nonce: string }>(
      row.authStateCiphertext!,
      pendingContext(row),
    );
    if (
      !matchesState(pending.state, stateHash(state)) ||
      pending.callbackUri !== callbackUri
    )
      throw new EngineError(
        "GOOGLE_STATE_INVALID",
        "Authorization binding is invalid.",
      );
    await tx.googleOAuthAttempt.update({
      where: { id: attempt.id },
      data: { consumedAt: new Date() },
    });
    await tx.workspaceIntegration.update({
      where: { id },
      data: { ...clear, revision: { increment: 1 } },
    });
    return {
      pending,
      revision: row.revision + 1,
      provider: row.providerId as GoogleProvider,
    };
  });
  try {
    if (denied)
      throw new EngineError(
        "GOOGLE_REAUTHORIZE",
        "Google authorization was declined.",
      );
    const credentials = await exchangeGoogle(
      captured.provider,
      code,
      captured.pending,
      captured.pending.nonce,
    );
    await db.$transaction(async (tx) => {
      const row = await lock(tx, actor, id, captured.revision);
      if (
        row.status !== "PENDING" ||
        row.deletedAt ||
        row.provider.state === "DISABLED"
      )
        throw new EngineError(
          "GOOGLE_STATE_INVALID",
          "Connection changed during authorization.",
          409,
        );
      await saveCredential(tx, row, credentials);
      await tx.workspaceIntegration.update({
        where: { id },
        data: {
          status: "CONNECTED",
          scopes: credentials.scopes,
          accountSubject: credentials.account!.sub,
          accountEmail: credentials.account!.email,
          revokedAt: null,
          lastVerifiedAt: new Date(),
          lastErrorCode: null,
          revision: { increment: 1 },
        },
      });
      await tx.integrationAuditEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          integrationId: id,
          providerId: row.providerId,
          actorId: userId,
          kind: "AUTHENTICATION_SUCCEEDED",
          status: "CONNECTED",
          revision: row.revision + 1,
        },
      });
    });
    return id;
  } catch (error) {
    await db.$transaction(async (tx) => {
      const changed = await tx.workspaceIntegration.updateMany({
        where: {
          id,
          revision: captured.revision,
          status: "PENDING",
          deletedAt: null,
        },
        data: {
          ...clear,
          status: "ERROR",
          lastErrorCode: "AUTHENTICATION_FAILED",
          revision: { increment: 1 },
        },
      });
      if (changed.count)
        await tx.integrationAuditEvent.create({
          data: {
            workspaceId: actor.workspaceId,
            integrationId: id,
            providerId: captured.provider,
            actorId: userId,
            kind: "FAILED",
            status: "ERROR",
            revision: captured.revision + 1,
            code: "AUTHENTICATION_FAILED",
          },
        });
    });
    throw googleError(error);
  }
}
async function authorizedConnection(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  provider: GoogleProvider,
  manage = false,
) {
  await authorize(
    tx,
    actor,
    manage ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "EDITOR"],
  );
  const row = await tx.workspaceIntegration.findFirst({
    where: {
      id,
      workspaceId: actor.workspaceId,
      providerId: provider,
      deletedAt: null,
      revokedAt: null,
      status: { in: ["CONNECTED", "EXPIRED", "ERROR"] },
      provider: { state: { not: "DISABLED" } },
    },
    include: { credential: true, provider: true },
  });
  if (!row)
    throw new EngineError(
      "GOOGLE_REAUTHORIZE",
      "No authorized Google connection is available.",
      422,
    );
  const secret = readCredential(row);
  if (
    !secret.account ||
    secret.account.sub !== row.accountSubject ||
    secret.account.email !== row.accountEmail
  )
    throw new EngineError(
      "GOOGLE_REAUTHORIZE",
      "Google identity binding is invalid.",
      422,
    );
  validateScopes(provider, secret.scopes);
  return { row, secret };
}
export async function credentialForGoogle(
  actor: Actor,
  id: string,
  provider: GoogleProvider,
  options: { force?: boolean; manage?: boolean } = {},
) {
  googleSettings();
  const mutex = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  let lost = false;
  mutex.on("error", () => {
    lost = true;
  });
  await mutex.connect();
  try {
    await mutex.query("SELECT pg_advisory_lock(hashtextextended($1,527))", [
      id,
    ]);
    const { row, secret } = await db.$transaction((tx) =>
      authorizedConnection(tx, actor, id, provider, options.manage),
    );
    if (
      !options.force &&
      row.status === "CONNECTED" &&
      Date.parse(secret.expiresAt) > Date.now() + 60000
    )
      return secret;
    try {
      const refreshed = await refreshGoogle(provider, secret);
      if (lost)
        throw new EngineError(
          "GOOGLE_OPERATION_FAILED",
          "Refresh lock was lost.",
        );
      return await db.$transaction(async (tx) => {
        const current = await authorizedConnection(
          tx,
          actor,
          id,
          provider,
          options.manage,
        );
        await tx.$executeRaw`SELECT id FROM "WorkspaceIntegration" WHERE id=${id} FOR UPDATE`;
        const latest = await tx.workspaceIntegration.findUniqueOrThrow({
          where: { id },
          include: { credential: true, provider: true },
        });
        if (
          latest.revision !== row.revision ||
          latest.credential?.generation !== row.credential?.generation ||
          latest.revokedAt ||
          latest.deletedAt ||
          latest.status === "PENDING" ||
          latest.status === "REVOKED"
        )
          throw new EngineError(
            "REVISION_CONFLICT",
            "Connection changed during refresh.",
            409,
          );
        await saveCredential(tx, latest, refreshed, true);
        await tx.workspaceIntegration.update({
          where: { id },
          data: {
            status: "CONNECTED",
            lastVerifiedAt: new Date(),
            lastErrorCode: null,
            scopes: refreshed.scopes,
            revision: { increment: 1 },
          },
        });
        await tx.integrationAuditEvent.create({
          data: {
            workspaceId: actor.workspaceId,
            integrationId: id,
            providerId: provider,
            actorId: actor.userId,
            kind: "REFRESHED",
            status: "CONNECTED",
            revision: row.revision + 1,
          },
        });
        void current;
        return refreshed;
      });
    } catch (error) {
      const failure = googleError(error);
      await db.$transaction(async (tx) => {
        const status =
          failure.code === "GOOGLE_REAUTHORIZE" ? "EXPIRED" : "ERROR";
        const code =
          status === "EXPIRED" ? "TOKEN_EXPIRED" : "PROVIDER_OPERATION_FAILED";
        const changed = await tx.workspaceIntegration.updateMany({
          where: {
            id,
            revision: row.revision,
            status: { notIn: ["REVOKED", "PENDING"] },
            deletedAt: null,
          },
          data: { status, lastErrorCode: code, revision: { increment: 1 } },
        });
        if (changed.count)
          await tx.integrationAuditEvent.create({
            data: {
              workspaceId: actor.workspaceId,
              integrationId: id,
              providerId: provider,
              actorId: actor.userId,
              kind: status === "EXPIRED" ? "EXPIRED" : "FAILED",
              status,
              revision: row.revision + 1,
              code,
            },
          });
      });
      throw failure;
    }
  } finally {
    await mutex.end().catch(() => {});
  }
}
export async function googleManagement(
  actor: Actor,
  id: string,
  revision: number,
  action: string,
) {
  const row = await db.$transaction(async (tx) => {
    const r = await lock(tx, actor, id, revision);
    if (!isGoogleProvider(r.providerId))
      throw new EngineError("NOT_FOUND", "Google connection not found.", 404);
    return r;
  });
  if (action === "refresh") {
    await credentialForGoogle(actor, id, row.providerId as GoogleProvider, {
      force: true,
      manage: true,
    });
    return getConnection(actor, id);
  }
  if (action !== "disconnect")
    throw new EngineError("INVALID_BODY", "Choose refresh or disconnect.");
  let token: string | undefined;
  try {
    token = readCredential(row).refreshToken;
  } catch {
    /* Local erasure must remain available without vault keys. */
  }
  await operate(actor, id, revision, "revoke");
  let remoteRevoked = false;
  if (token)
    try {
      await revokeGoogle(token);
      remoteRevoked = true;
    } catch {
      /* Local revocation remains committed even when Google is unavailable. */
    }
  return {
    ...(await getConnection(actor, id)),
    remoteRevocation: remoteRevoked ? "CONFIRMED" : "UNVERIFIED",
  };
}

// A delayed 401 from an old token must not expire a newly refreshed connection.
export async function expireGoogleToken(
  actor: Actor,
  id: string,
  token: string,
) {
  await db.$transaction(async (tx) => {
    await authorize(tx, actor, ["OWNER", "ADMIN", "EDITOR"]);
    await tx.$executeRaw`SELECT id FROM "WorkspaceIntegration" WHERE id=${id} AND "workspaceId"=${actor.workspaceId} FOR UPDATE`;
    const row = await tx.workspaceIntegration.findFirst({
      where: {
        id,
        workspaceId: actor.workspaceId,
        status: "CONNECTED",
        deletedAt: null,
      },
      include: { credential: true, provider: true },
    });
    if (!row) return;
    let current: CredentialSet;
    try {
      current = readCredential(row);
    } catch {
      return;
    }
    if (current.accessToken !== token) return;
    await tx.workspaceIntegration.update({
      where: { id },
      data: {
        status: "EXPIRED",
        lastErrorCode: "TOKEN_EXPIRED",
        revision: { increment: 1 },
      },
    });
    await tx.integrationAuditEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        integrationId: id,
        providerId: row.providerId,
        actorId: actor.userId,
        kind: "EXPIRED",
        status: "EXPIRED",
        revision: row.revision + 1,
        code: "TOKEN_EXPIRED",
      },
    });
  });
}
