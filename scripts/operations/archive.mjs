import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
function key(value) {
  const k = Buffer.from(value ?? "", "base64");
  if (k.length !== 32 || k.toString("base64") !== value)
    throw Error("BACKUP_KEY_INVALID");
  return k;
}
function aad(id) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw Error("BACKUP_KEY_ID_INVALID");
  return Buffer.from(JSON.stringify({ v: 1, keyId: id, format: "pg-custom" }));
}
export async function encryptArchive(input, path, secret, keyId) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(aad(keyId));
  const hash = createHash("sha256"),
    meter = new Transform({
      transform(chunk, encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
  await pipeline(
    input,
    cipher,
    meter,
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  const manifest = {
    v: 1,
    format: "pg-custom",
    keyId,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    sha256: hash.digest("hex"),
    createdAt: new Date().toISOString(),
  };
  await writeFile(path + ".json", JSON.stringify(manifest) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}
export async function decryptArchive(path, output, secret, keyId) {
  const m = JSON.parse(await readFile(path + ".json", "utf8"));
  if (
    m.v !== 1 ||
    m.format !== "pg-custom" ||
    m.keyId !== keyId ||
    !/^[a-f0-9]{64}$/.test(m.sha256)
  )
    throw Error("BACKUP_MANIFEST_INVALID");
  const hash = createHash("sha256"),
    iv = Buffer.from(m.iv, "base64"),
    tag = Buffer.from(m.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16)
    throw Error("BACKUP_MANIFEST_INVALID");
  const cipher = createDecipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(aad(keyId));
  cipher.setAuthTag(tag);
  const meter = new Transform({
    transform(chunk, enc, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(
    createReadStream(path),
    meter,
    cipher,
    createWriteStream(output, { flags: "wx", mode: 0o600 }),
  );
  if (hash.digest("hex") !== m.sha256) throw Error("BACKUP_CHECKSUM_INVALID");
  await chmod(output, 0o600);
  return m;
}
