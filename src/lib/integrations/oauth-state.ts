import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { IntegrationFailure } from "./contracts";
export function createPkceState(callbackUri: string) {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    callbackUri,
  };
}
export function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
export function matchesState(state: string, digest: string) {
  const actual = Buffer.from(stateHash(state), "hex"),
    expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validateCallbackUri(actual: string, expected: string) {
  try {
    const a = new URL(actual),
      e = new URL(expected);
    if (
      a.href !== e.href ||
      a.username ||
      a.password ||
      a.hash ||
      a.search ||
      !(
        a.protocol === "https:" ||
        (a.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(a.hostname))
      )
    )
      throw new Error();
  } catch {
    throw new IntegrationFailure("AUTH_BINDING_INVALID");
  }
}
