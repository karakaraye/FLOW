import {
  EngineError,
  isObject,
  type Data,
  type Json,
} from "../engine/definition";
export const googleTypes = [
  "google_sheets_read_rows",
  "google_sheets_append_row",
  "google_sheets_update_row",
  "gmail_send_email",
] as const;
export function isGoogleType(t: string) {
  return (googleTypes as readonly string[]).includes(t);
}
export const googleScopes = {
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
  "google-sheets": [
    "openid",
    "email",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
} as const;
export type GoogleProvider = keyof typeof googleScopes;
export function isGoogleProvider(p: string): p is GoogleProvider {
  return p === "gmail" || p === "google-sheets";
}
export function emailAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      value,
    )
  );
}
export function spreadsheetId(v: unknown) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{10,150}$/.test(v);
}
export function sheetRange(v: unknown) {
  return (
    typeof v === "string" &&
    v.length <= 150 &&
    /^(?:[A-Za-z0-9 _-]{1,80}|'(?:[^'\r\n!]|''){1,80}')![A-Z]{1,3}[1-9][0-9]{0,5}(?::[A-Z]{1,3}[1-9][0-9]{0,5})?$/.test(
      v,
    )
  );
}
function path(p: unknown) {
  return (
    typeof p === "string" &&
    p.length <= 128 &&
    p
      .split(".")
      .every(
        (k) =>
          /^[A-Za-z0-9_-]{1,48}$/.test(k) &&
          !["__proto__", "constructor", "prototype"].includes(k),
      )
  );
}
export function googleConfig(type: string, c: Data) {
  const bad = (m: string): never => {
    throw new EngineError("INVALID_GOOGLE_CONFIG", m);
  };
  if (
    typeof c.connectionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(c.connectionId)
  )
    bad("Select an authorized Google connection.");
  const fields =
    type === "gmail_send_email"
      ? ["connectionId", "to", "subject", "body", "mappings"]
      : [
          "connectionId",
          "spreadsheetId",
          "range",
          ...(type === "google_sheets_read_rows"
            ? []
            : ["values", "valuePaths"]),
        ];
  if (Object.keys(c).some((k) => !fields.includes(k)))
    bad("Unexpected Google node configuration.");
  if (type === "gmail_send_email") {
    if (
      !Array.isArray(c.to) ||
      c.to.length < 1 ||
      c.to.length > 10 ||
      !c.to.every(emailAddress) ||
      new Set(c.to.map((v) => String(v).toLowerCase())).size !== c.to.length
    )
      bad("Use 1–10 distinct plain recipient email addresses.");
    if (
      typeof c.subject !== "string" ||
      c.subject.length < 1 ||
      c.subject.length > 200 ||
      /[\r\n\x00-\x1f\x7f]/.test(c.subject)
    )
      bad("Use a subject of 1–200 characters without control characters.");
    if (
      typeof c.body !== "string" ||
      new TextEncoder().encode(c.body).length > 6000
    )
      bad("Plain-text body must not exceed 6 KiB.");
    if (
      c.mappings !== undefined &&
      (!isObject(c.mappings) ||
        Object.keys(c.mappings).some((k) => !["subject", "body"].includes(k)) ||
        !Object.values(c.mappings).every(path))
    )
      bad(
        "Map only subject/body to safe input field paths. Recipients stay explicit.",
      );
  } else {
    if (!spreadsheetId(c.spreadsheetId) || !sheetRange(c.range))
      bad(
        "Use a spreadsheet ID and bounded A1 range, for example Sheet1!A1:D100.",
      );
    const r = String(c.range).split("!").at(-1)!;
    const cells = r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/)!;
    const col = (s: string) =>
      [...s].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0);
    const width = col(cells[3] ?? cells[1]) - col(cells[1]) + 1,
      height = Number(cells[4] ?? cells[2]) - Number(cells[2]) + 1;
    if (width < 1 || width > 26 || height < 1 || height > 100)
      bad("Ranges may cover at most 26 columns and 100 rows in forward order.");
    if (type !== "google_sheets_read_rows") {
      if (height !== 1)
        bad(
          "Writes must target one row. Appends add one row after the selected table.",
        );
      if (
        !Array.isArray(c.values) ||
        c.values.length < 1 ||
        c.values.length > width ||
        !c.values.every(
          (v) =>
            v === null ||
            typeof v === "string" ||
            typeof v === "boolean" ||
            typeof v === "number",
        )
      )
        bad("Use up to 26 scalar column values matching the range width.");
      if (
        c.valuePaths !== undefined &&
        (!Array.isArray(c.valuePaths) ||
          c.valuePaths.length !== (c.values as Json[]).length ||
          !c.valuePaths.every((v) => v === null || path(v)))
      )
        bad("Each column mapping must be null or a safe input field path.");
    }
  }
}
export function mapped(input: Json, path: string): Json {
  let value = input;
  for (const k of path.split(".")) {
    if (!isObject(value) || !Object.hasOwn(value, k))
      throw new EngineError(
        "GOOGLE_MAPPING_MISSING",
        "A mapped input field is missing.",
      );
    value = value[k] as Json;
  }
  return value;
}
