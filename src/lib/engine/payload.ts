import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Json } from "./definition";
function key() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "A strong authentication secret is required for queued input encryption.",
    );
  return createHash("sha256")
    .update(`flowpilot-workflow-input-v1:${secret}`)
    .digest();
}
export function seal(input: Json, runId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(runId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(input), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function unseal(payload: string, runId: string): Json {
  const [iv, tag, encrypted] = payload
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(runId));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8"),
  );
}
