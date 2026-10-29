import { resourceLimit } from "../billing/quotas";
import { metaConfigured } from "../whatsapp/provider";
import { googleConfigured } from "../google/provider";
import { isGoogleProvider } from "../google/config";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type IntegrationEventKind,
  type IntegrationStatus,
} from "@prisma/client";
import { db } from "../db";
import { authorize } from "../engine/service";
import { EngineError, isObject } from "../engine/definition";
import {
  IntegrationFailure,
  label,
  normalizeFailure,
  type AuthenticationState,
  type Binding,
  type CredentialSet,
  type CredentialPersistence,
} from "./contracts";
import { decryptSecret, encryptSecret, loadKeys } from "./crypto";
import { matchesState, stateHash } from "./oauth-state";
import { providerMetadata, testAdapterEnabled } from "./providers";
import { issueLocalTestProof, localTestAdapter } from "./test-adapter";
type Actor = { userId: string; workspaceId: string };
const MANAGE = ["OWNER", "ADMIN"] as const;
const metadataSelect = {
  id: true,
  workspaceId: true,
  providerId: true,
  label: true,
  status: true,
  revision: true,
  scopes: true,
  createdAt: true,
  updatedAt: true,
  lastVerifiedAt: true,
  revokedAt: true,
  lastErrorCode: true,
  authExpiresAt: true,
  accountSubject: true,
  accountEmail: true,
  provider: { select: { name: true, state: true, authMethod: true } },
  credential: { select: { expiresAt: true, destroyedAt: true } },
} satisfies Prisma.WorkspaceIntegrationSelect;
type Metadata = Prisma.WorkspaceIntegrationGetPayload<{
  select: typeof metadataSelect;
}>;
function dto(row: Metadata) {
  const { credential, ...metadata } = row;
  return {
    ...metadata,
    googleAvailable:
      isGoogleProvider(row.providerId) &&
      googleConfigured() &&
      row.provider.state !== "DISABLED",
    testOnly: row.providerId === "local-test",
    operationsAvailable:
      row.providerId === "local-test" &&
      row.provider.state === "TEST_ONLY" &&
      testAdapterEnabled(),
    hasCredential: Boolean(credential && !credential.destroyedAt),
    expiresAt: credential?.expiresAt ?? null,
    status:
      row.status === "CONNECTED" &&
      credential &&
      credential.expiresAt <= new Date()
        ? ("EXPIRED" as const)
        : row.status,
  };
}
function adapter(providerId: string) {
  if (providerId !== "local-test" || !testAdapterEnabled())
    throw new EngineError(
      "PROVIDER_UNAVAILABLE",
      "Provider authentication is not available. Real external providers are Coming Soon.",
      409,
    );
  return localTestAdapter;
}
function binding(row: {
  id: string;
  workspaceId: string;
  providerId: string;
}): Binding {
  return {
    integrationId: row.id,
    workspaceId: row.workspaceId,
    providerId: row.providerId,
  };
}
const clearedState = {
  authAttemptId: null,
  authInitiatedBy: null,
  authStateHash: null,
  authStateCiphertext: null,
  authExpiresAt: null,
};
async function event(
  tx: Prisma.TransactionClient,
  row: {
    id: string;
    workspaceId: string;
    providerId: string;
    revision: number;
    status: IntegrationStatus;
  },
  actorId: string,
  kind: IntegrationEventKind,
  code: string | null = null,
) {
  await tx.integrationAuditEvent.create({
    data: {
      workspaceId: row.workspaceId,
      integrationId: row.id,
      providerId: row.providerId,
      actorId,
      kind,
      status: row.status,
      revision: row.revision,
      code,
    },
  });
}
export async function listProviders(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const rows = await tx.integrationProvider.findMany({
      orderBy: { id: "asc" },
    });
    return rows
      .filter(
        (p) =>
          providerMetadata.some((meta) => meta.id === p.id) &&
          (p.id !== "local-test" || testAdapterEnabled()),
      )
      .map((p) => ({
        ...p,
        state:
          ((isGoogleProvider(p.id) && googleConfigured()) ||
            (p.id === "whatsapp-business" && metaConfigured())) &&
          p.state !== "DISABLED"
            ? "AVAILABLE"
            : p.state,
        available:
          (p.id === "whatsapp-business" &&
            metaConfigured() &&
            p.state !== "DISABLED") ||
          (isGoogleProvider(p.id) &&
            googleConfigured() &&
            p.state !== "DISABLED") ||
          (p.id === "https-bearer" && p.state === "AVAILABLE") ||
          (p.id === "local-test" &&
            p.state === "TEST_ONLY" &&
            testAdapterEnabled()),
        testOnly: p.id === "local-test",
      }));
  });
}
export async function listConnections(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    return (
      await tx.workspaceIntegration.findMany({
        where: { workspaceId: actor.workspaceId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: metadataSelect,
      })
    ).map(dto);
  });
}
export async function getConnection(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const row = await tx.workspaceIntegration.findFirst({
      where: { id, workspaceId: actor.workspaceId, deletedAt: null },
      select: metadataSelect,
    });
    if (!row) throw new EngineError("NOT_FOUND", "Connection not found.", 404);
    return dto(row);
  });
}
export async function listEvents(actor: Actor, id?: string) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    if (
      id &&
      !(await tx.workspaceIntegration.findFirst({
        where: { id, workspaceId: actor.workspaceId },
      }))
    )
      throw new EngineError("NOT_FOUND", "Connection not found.", 404);
    return tx.integrationAuditEvent.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...(id ? { integrationId: id } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        integrationId: true,
        providerId: true,
        actorId: true,
        kind: true,
        status: true,
        revision: true,
        code: true,
        createdAt: true,
      },
    });
  });
}
export async function createConnection(actor: Actor, body: unknown) {
  if (
    !isObject(body) ||
    typeof body.providerId !== "string" ||
    Object.keys(body).some((k) => !["providerId", "label"].includes(k))
  )
    throw new EngineError(
      "INVALID_BODY",
      "Supply providerId and a display label only.",
    );
  const title = label(body.label);
  const provider = providerMetadata.find((p) => p.id === body.providerId);
  if (!provider || (provider.id === "local-test" && !testAdapterEnabled()))
    throw new EngineError("NOT_FOUND", "Provider not found.", 404);
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, [...MANAGE]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))`;
    if (
      (await tx.workspaceIntegration.count({
        where: { workspaceId: actor.workspaceId },
      })) >= 100
    )
      throw new EngineError(
        "CONNECTION_LIMIT",
        "Workspace connection record limit reached.",
        429,
      );
    const stored = await tx.integrationProvider.findUnique({
      where: { id: provider.id },
    });
    if (!stored || stored.state === "DISABLED")
      throw new EngineError(
        "PROVIDER_UNAVAILABLE",
        "Provider is unavailable.",
        409,
      );
    if (
      await tx.workspaceIntegration.findFirst({
        where: {
          workspaceId: actor.workspaceId,
          providerId: provider.id,
          connectionKey: "primary",
        },
      })
    )
      throw new EngineError(
        "CONNECTION_EXISTS",
        "This workspace already has a connection record for this provider.",
        409,
      );
    await resourceLimit(tx, actor.workspaceId, "integrations");
    const row = await tx.workspaceIntegration.create({
      data: {
        workspaceId: actor.workspaceId,
        providerId: provider.id,
        label: title,
        scopes: [],
      },
    });
    await event(tx, row, actor.userId, "CREATED");
    return dto(
      await tx.workspaceIntegration.findUniqueOrThrow({
        where: { id: row.id },
        select: metadataSelect,
      }),
    );
  });
}
export async function lock(
  tx: Prisma.TransactionClient,
  actor: Actor,
  id: string,
  revision: number,
) {
  await authorize(tx, actor, [...MANAGE]);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "WorkspaceIntegration" WHERE id=${id} AND "workspaceId"=${actor.workspaceId} AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length)
    throw new EngineError("NOT_FOUND", "Connection not found.", 404);
  const row = await tx.workspaceIntegration.findUniqueOrThrow({
    where: { id },
    include: { credential: true, provider: true },
  });
  if (row.revision !== revision)
    throw new EngineError(
      "REVISION_CONFLICT",
      "Connection changed. Reload before trying again.",
      409,
    );
  if (
    (await tx.integrationAuditEvent.count({
      where: {
        workspaceId: actor.workspaceId,
        createdAt: { gt: new Date(Date.now() - 60000) },
      },
    })) >= 60
  )
    throw new EngineError(
      "RATE_LIMIT",
      "Too many integration changes. Try again in one minute.",
      429,
    );
  return row;
}
type Locked = Awaited<ReturnType<typeof lock>>;
async function adapterCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw new IntegrationFailure(normalizeFailure(cause).code);
  }
}
function credentialContext(row: Locked, id: string) {
  return { ...binding(row), recordId: id, purpose: "credential" as const };
}
function pendingContext(row: Locked) {
  if (!row.authAttemptId) throw new IntegrationFailure("AUTH_BINDING_INVALID");
  return {
    ...binding(row),
    recordId: row.authAttemptId,
    purpose: "authentication-state" as const,
  };
}
// Private, not an API: invoked only after fresh management authorization and a
// connection lock. No caller or callback can request a plaintext return value.
export function readCredential(row: Locked): CredentialSet {
  if (
    !row.credential ||
    row.credential.destroyedAt ||
    row.credential.revokedAt ||
    !["CONNECTED", "EXPIRED", "ERROR"].includes(row.status)
  )
    throw new IntegrationFailure("CREDENTIAL_UNAVAILABLE");
  return decryptSecret<CredentialSet>(
    row.credential.ciphertext,
    credentialContext(row, row.credential.id),
    undefined,
    row.credential.keyId,
  );
}
export async function saveCredential(
  tx: Prisma.TransactionClient,
  row: Locked,
  secret: CredentialSet,
  refresh = false,
) {
  await resourceLimit(tx, row.workspaceId, "integrations", 0);
  const expiresAt = new Date(secret.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    throw new IntegrationFailure("AUTHENTICATION_FAILED");
  const id = row.credential?.id ?? randomUUID();
  const sealed = encryptSecret(secret, credentialContext(row, id));
  await tx.integrationCredential.upsert({
    where: { integrationId: row.id },
    create: {
      id,
      integrationId: row.id,
      workspaceId: row.workspaceId,
      providerId: row.providerId,
      ...sealed,
      issuedAt: new Date(),
      expiresAt,
    },
    update: {
      ...sealed,
      generation: { increment: 1 },
      issuedAt: new Date(),
      expiresAt,
      revokedAt: null,
      destroyedAt: null,
      ...(refresh ? { refreshedAt: new Date() } : {}),
    },
  });
}
export function bindCredentialPersistence(
  tx: Prisma.TransactionClient,
  row: Locked,
): CredentialPersistence {
  return {
    persistVerified: (secret, refreshed = false) =>
      saveCredential(tx, row, secret, refreshed),
    async erase() {
      await tx.integrationCredential.updateMany({
        where: { integrationId: row.id },
        data: {
          ciphertext: "",
          revokedAt: new Date(),
          destroyedAt: new Date(),
          generation: { increment: 1 },
        },
      });
    },
    async rotateToActiveKey() {
      if (!row.credential || row.credential.destroyedAt) return;
      const sealed = encryptSecret(
        readCredential(row),
        credentialContext(row, row.credential.id),
      );
      await tx.integrationCredential.update({
        where: { id: row.credential.id },
        data: {
          ...sealed,
          generation: { increment: 1 },
          rotatedAt: new Date(),
        },
      });
    },
  };
}
export type Operation =
  | "begin-test"
  | "complete-test"
  | "health"
  | "refresh"
  | "revoke"
  | "delete"
  | "rotate-key";
export async function operate(
  actor: Actor,
  id: string,
  revision: number,
  operation: Operation,
) {
  const outcome = await db.$transaction(
    async (tx) => {
      const row = await lock(tx, actor, id, revision);
      const needsAdapter = [
        "begin-test",
        "complete-test",
        "health",
        "refresh",
      ].includes(operation);
      const provider = needsAdapter ? adapter(row.providerId) : undefined;
      if (needsAdapter && row.provider.state !== "TEST_ONLY")
        throw new EngineError(
          "PROVIDER_UNAVAILABLE",
          "Provider is unavailable.",
          409,
        );
      if (
        ["health", "refresh"].includes(operation) &&
        !["CONNECTED", "EXPIRED", "ERROR"].includes(row.status)
      )
        throw new EngineError(
          "INVALID_STATE",
          "A usable authenticated connection is required.",
          409,
        );
      const persistence = bindCredentialPersistence(tx, row);
      let data: Prisma.WorkspaceIntegrationUpdateInput = {
        revision: { increment: 1 },
        lastErrorCode: null,
      };
      let kind: IntegrationEventKind = "HEALTH_VERIFIED";
      let code: string | null = null;
      try {
        if (operation === "revoke" || operation === "delete") {
          // Local access revocation/crypto erasure never requires a decryption key.
          // Real provider-side revocation is not claimed or attempted in Task 5A.
          if (row.providerId === "local-test" && testAdapterEnabled())
            await adapterCall(() => localTestAdapter.revoke(binding(row)));
          await persistence.erase();
          data = {
            ...data,
            ...clearedState,
            status: "REVOKED",
            revokedAt: new Date(),
            scopes: [],
            accountSubject: null,
            accountEmail: null,
            ...(operation === "delete"
              ? { deletedAt: new Date(), connectionKey: null }
              : {}),
          };
          kind = operation === "delete" ? "DELETED" : "REVOKED";
          code = "LOCAL_ACCESS_REMOVED";
        } else if (operation === "begin-test") {
          if (row.status === "PENDING")
            throw new EngineError(
              "INVALID_STATE",
              "Complete or revoke the current pending attempt first.",
              409,
            );
          const state = await adapterCall(() =>
            provider!.initiate(
              binding(row),
              actor.userId,
              new URL(
                "/integrations/local-test/callback",
                process.env.BETTER_AUTH_URL!,
              ).href,
            ),
          );
          const attemptId = randomUUID();
          const sealed = encryptSecret(state, {
            ...binding(row),
            recordId: attemptId,
            purpose: "authentication-state",
          });
          await persistence.erase();
          data = {
            ...data,
            status: "PENDING",
            authAttemptId: attemptId,
            authInitiatedBy: actor.userId,
            authStateHash: stateHash(state.state),
            authStateCiphertext: sealed.ciphertext,
            authExpiresAt: new Date(Date.now() + 300000),
            scopes: [],
          };
          kind = "AUTHENTICATION_STARTED";
        } else if (operation === "complete-test") {
          if (
            row.status !== "PENDING" ||
            !row.authStateCiphertext ||
            !row.authStateHash
          )
            throw new EngineError(
              "INVALID_STATE",
              "Start a local test authentication first.",
              409,
            );
          if (row.authInitiatedBy !== actor.userId)
            throw new EngineError(
              "FORBIDDEN",
              "Only the member who started this attempt can complete it.",
              403,
            );
          if (!row.authExpiresAt || row.authExpiresAt <= new Date())
            throw new IntegrationFailure("AUTH_ATTEMPT_EXPIRED");
          const state = decryptSecret<AuthenticationState>(
            row.authStateCiphertext,
            pendingContext(row),
          );
          if (!matchesState(state.state, row.authStateHash))
            throw new IntegrationFailure("AUTH_BINDING_INVALID");
          const proof = await issueLocalTestProof(
            binding(row),
            actor.userId,
            state,
          );
          const secret = await adapterCall(() =>
            provider!.validateCallback(
              binding(row),
              actor.userId,
              state,
              proof,
            ),
          );
          await adapterCall(() => provider!.health(binding(row), secret));
          await persistence.persistVerified(secret);
          data = {
            ...data,
            ...clearedState,
            status: "CONNECTED",
            lastVerifiedAt: new Date(),
            revokedAt: null,
            scopes: secret.scopes,
          };
          kind = "AUTHENTICATION_SUCCEEDED";
        } else if (operation === "health") {
          const secret = readCredential(row);
          if (row.credential!.expiresAt <= new Date())
            throw new IntegrationFailure("TOKEN_EXPIRED");
          await adapterCall(() => provider!.health(binding(row), secret));
          data = { ...data, status: "CONNECTED", lastVerifiedAt: new Date() };
          kind = "HEALTH_VERIFIED";
        } else if (operation === "refresh") {
          const secret = await adapterCall(() =>
            provider!.refresh(binding(row), readCredential(row)),
          );
          await adapterCall(() => provider!.health(binding(row), secret));
          await persistence.persistVerified(secret, true);
          data = {
            ...data,
            status: "CONNECTED",
            lastVerifiedAt: new Date(),
            scopes: secret.scopes,
          };
          kind = "REFRESHED";
        } else if (operation === "rotate-key") {
          if (
            (!row.credential || row.credential.destroyedAt) &&
            !row.authStateCiphertext
          )
            throw new EngineError(
              "INVALID_STATE",
              "No encrypted material is available to rotate.",
              409,
            );
          const ring = loadKeys();
          await persistence.rotateToActiveKey();
          if (row.authStateCiphertext) {
            const context = pendingContext(row);
            const state = decryptSecret<AuthenticationState>(
              row.authStateCiphertext,
              context,
              ring,
            );
            data.authStateCiphertext = encryptSecret(
              state,
              context,
              ring,
            ).ciphertext;
          }
          kind = "KEY_ROTATED";
        } else
          throw new EngineError(
            "INVALID_OPERATION",
            "Unsupported integration operation.",
          );
        const updated = await tx.workspaceIntegration.update({
          where: { id },
          data,
        });
        await event(tx, updated, actor.userId, kind, code);
        return {
          ok: true as const,
          metadata: dto(
            await tx.workspaceIntegration.findUniqueOrThrow({
              where: { id },
              select: metadataSelect,
            }),
          ),
        };
      } catch (cause) {
        if (cause instanceof EngineError) throw cause;
        const error = normalizeFailure(cause);
        const updated = await tx.workspaceIntegration.update({
          where: { id },
          data: {
            ...clearedState,
            status: error.code === "TOKEN_EXPIRED" ? "EXPIRED" : "ERROR",
            revision: { increment: 1 },
            lastErrorCode: error.code,
          },
        });
        await event(
          tx,
          updated,
          actor.userId,
          error.code === "TOKEN_EXPIRED" ? "EXPIRED" : "FAILED",
          error.code,
        );
        return { ok: false as const, error };
      }
    },
    { timeout: 10000 },
  );
  if (!outcome.ok)
    throw new EngineError(
      outcome.error.code,
      outcome.error.message,
      outcome.error.httpStatus,
    );
  return outcome.metadata;
}
export async function updateLabel(actor: Actor, id: string, body: unknown) {
  if (
    !isObject(body) ||
    !Number.isSafeInteger(body.revision) ||
    Object.keys(body).some((k) => !["label", "revision"].includes(k))
  )
    throw new EngineError(
      "INVALID_BODY",
      "Supply label and current revision only.",
    );
  const title = label(body.label);
  return db.$transaction(async (tx) => {
    await lock(tx, actor, id, body.revision as number);
    const updated = await tx.workspaceIntegration.update({
      where: { id },
      data: { label: title, revision: { increment: 1 } },
    });
    await event(tx, updated, actor.userId, "LABEL_UPDATED");
    return dto(
      await tx.workspaceIntegration.findUniqueOrThrow({
        where: { id },
        select: metadataSelect,
      }),
    );
  });
}
