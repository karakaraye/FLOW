import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { IntegrationFailure, type Binding } from "./contracts";
export type Context = Binding & {
  recordId: string;
  purpose: "credential" | "authentication-state";
};
export type KeyRing = { active: string; keys: Map<string, Buffer> };
function unavailable(): never {
  throw new IntegrationFailure("CREDENTIAL_CONFIGURATION_UNAVAILABLE");
}
export function loadKeys(): KeyRing {
  if (typeof window !== "undefined") return unavailable();
  try {
    const parsed: unknown = JSON.parse(
      process.env.INTEGRATION_ENCRYPTION_KEYS ?? "",
    );
    const active = process.env.INTEGRATION_ACTIVE_KEY_ID;
    if (
      !active ||
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    )
      return unavailable();
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.length > 5) return unavailable();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of entries) {
      if (
        !/^[a-zA-Z0-9_-]{1,32}$/.test(id) ||
        typeof value !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/.test(value)
      )
        return unavailable();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value)
        return unavailable();
      keys.set(id, key);
    }
    if (!keys.has(active)) return unavailable();
    return { active, keys };
  } catch {
    return unavailable();
  }
}
function aad(context: Context, keyId: string) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      purpose: context.purpose,
      workspaceId: context.workspaceId,
      integrationId: context.integrationId,
      providerId: context.providerId,
      recordId: context.recordId,
      keyId,
    }),
  );
}
export function encryptSecret(
  value: unknown,
  context: Context,
  ring = loadKeys(),
): { ciphertext: string; keyId: string } {
  try {
    const plaintext = JSON.stringify(value);
    if (Buffer.byteLength(plaintext) > 16384) throw new Error();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      ring.keys.get(ring.active)!,
      iv,
    );
    cipher.setAAD(aad(context, ring.active));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      keyId: ring.active,
      ciphertext: JSON.stringify({
        v: 1,
        keyId: ring.active,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        data: ciphertext.toString("base64url"),
      }),
    };
  } catch {
    throw new IntegrationFailure("CREDENTIAL_UNAVAILABLE");
  }
}
export function decryptSecret<T>(
  ciphertext: string,
  context: Context,
  ring = loadKeys(),
  expectedKeyId?: string,
): T {
  try {
    if (ciphertext.length > 24000) throw new Error();
    const envelope = JSON.parse(ciphertext);
    if (
      envelope.v !== 1 ||
      typeof envelope.keyId !== "string" ||
      !ring.keys.has(envelope.keyId) ||
      (expectedKeyId !== undefined && envelope.keyId !== expectedKeyId) ||
      Object.keys(envelope).some(
        (k) => !["v", "keyId", "iv", "tag", "data"].includes(k),
      )
    )
      throw new Error();
    const iv = Buffer.from(envelope.iv, "base64url"),
      tag = Buffer.from(envelope.tag, "base64url"),
      data = Buffer.from(envelope.data, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      ring.keys.get(envelope.keyId)!,
      iv,
    );
    cipher.setAAD(aad(context, envelope.keyId));
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"),
    ) as T;
  } catch {
    throw new IntegrationFailure("CREDENTIAL_UNAVAILABLE");
  }
}
