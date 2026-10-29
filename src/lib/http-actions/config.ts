import { EngineError, isObject, type Data } from "../engine/definition";
export function httpConfig(c: Data) {
  const bad = () => {
    throw new EngineError(
      "INVALID_HTTP_CONFIG",
      "Use a public HTTPS URL, approved headers, JSON body and a timeout of 100–10000 ms.",
    );
  };
  if (
    Object.keys(c).some(
      (k) =>
        ![
          "method",
          "url",
          "headers",
          "body",
          "bodyFromInput",
          "timeoutMs",
          "connectionId",
          "responsePath",
          "retrySafe",
          "maxAttempts",
        ].includes(k),
    )
  )
    bad();
  if (
    !["GET", "POST", "PATCH", "PUT"].includes(String(c.method)) ||
    typeof c.url !== "string" ||
    c.url.length > 2048
  )
    bad();
  let u: URL;
  try {
    u = new URL(c.url as string);
  } catch {
    return bad();
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== "443") ||
    /[\s\\\x00-\x1f\x7f]/.test(c.url as string)
  )
    bad();
  if (
    !Number.isInteger(c.timeoutMs) ||
    Number(c.timeoutMs) < 100 ||
    Number(c.timeoutMs) > 10000
  )
    bad();
  if (!isObject(c.headers) || Object.keys(c.headers).length > 10) bad();
  for (const [k, v] of Object.entries(c.headers as object))
    if (
      !/^(accept|content-type|x-requested-with|x-client-version)$/i.test(k) ||
      typeof v !== "string" ||
      v.length > 256 ||
      /[\r\n\x00-\x1f\x7f]/.test(v)
    )
      bad();
  if (c.bodyFromInput !== undefined && typeof c.bodyFromInput !== "boolean")
    bad();
  if (c.method === "GET" && (c.body !== undefined || c.bodyFromInput)) bad();
  if (
    c.connectionId !== undefined &&
    (typeof c.connectionId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(c.connectionId))
  )
    bad();
  if (c.retrySafe !== undefined && typeof c.retrySafe !== "boolean") bad();
  if (
    c.maxAttempts !== undefined &&
    (!Number.isInteger(c.maxAttempts) ||
      Number(c.maxAttempts) < 1 ||
      Number(c.maxAttempts) > 3)
  )
    bad();
  if (
    c.responsePath !== undefined &&
    (typeof c.responsePath !== "string" ||
      !c.responsePath
        .split(".")
        .every(
          (k) =>
            /^[a-zA-Z0-9_-]{1,48}$/.test(k) &&
            !["constructor", "prototype", "__proto__"].includes(k),
        ))
  )
    bad();
  // Secrets belong in a destination-bound connection; query strings can contain tokens.
  if (u.search) bad();
  return u;
}
