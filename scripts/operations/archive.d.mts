import type { Readable } from "node:stream";
export function encryptArchive(
  input: Readable,
  path: string,
  secret: string,
  keyId: string,
): Promise<Record<string, unknown>>;
export function decryptArchive(
  path: string,
  output: string,
  secret: string,
  keyId: string,
): Promise<Record<string, unknown>>;
