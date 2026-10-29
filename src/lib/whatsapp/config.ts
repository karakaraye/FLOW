import {
  EngineError,
  isObject,
  type Data,
  type Json,
} from "../engine/definition";
export const whatsappTypes = [
  "whatsapp_message_received",
  "whatsapp_send_message",
  "whatsapp_send_template",
] as const;
export function isWhatsAppType(type: string) {
  return (whatsappTypes as readonly string[]).includes(type);
}
export function waError(code: string, status = 422): never {
  throw new EngineError(
    code,
    "WhatsApp operation could not be authorized or verified. Review the connection, messaging policy and audit status.",
    status,
  );
}
export function asset(value: unknown): value is string {
  return typeof value === "string" && /^\d{5,32}$/.test(value);
}
export function recipient(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{7,14}$/.test(value);
}
export function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    value
      .split(".")
      .every(
        (x) =>
          /^[a-zA-Z0-9_-]+$/.test(x) &&
          !["__proto__", "constructor", "prototype"].includes(x),
      )
  );
}
export function mapped(input: Json, p: string): Json | undefined {
  let v: Json | undefined = input;
  for (const k of p.split(".")) {
    if (!isObject(v) || !Object.hasOwn(v, k)) return;
    v = v[k] as Json;
  }
  return v;
}
export function whatsappConfig(type: string, c: Data) {
  const trigger = type === "whatsapp_message_received",
    template = type === "whatsapp_send_template";
  const allowed = trigger
    ? ["connectionId", "phoneNumberId", "contains"]
    : template
      ? [
          "connectionId",
          "to",
          "toPath",
          "templateId",
          "language",
          "parameters",
          "parameterPaths",
        ]
      : ["connectionId", "to", "toPath", "body", "bodyPath"];
  if (
    Object.keys(c).some((k) => !allowed.includes(k)) ||
    typeof c.connectionId !== "string" ||
    !c.connectionId ||
    c.connectionId.length > 100
  )
    waError("WHATSAPP_CONFIG");
  if (trigger) {
    if (
      !asset(c.phoneNumberId) ||
      (c.contains !== undefined &&
        (typeof c.contains !== "string" || c.contains.length > 80))
    )
      waError("WHATSAPP_CONFIG");
    return;
  }
  if (c.toPath !== undefined ? !path(c.toPath) : !recipient(c.to))
    waError("WHATSAPP_RECIPIENT");
  if (c.toPath !== undefined && c.to !== undefined) waError("WHATSAPP_CONFIG");
  if (template) {
    if (
      typeof c.templateId !== "string" ||
      !asset(c.templateId) ||
      typeof c.language !== "string" ||
      !/^\w{2,12}$/.test(c.language) ||
      !Array.isArray(c.parameters) ||
      c.parameters.length > 10 ||
      c.parameters.some((x) => typeof x !== "string" || x.length > 512) ||
      (c.parameterPaths !== undefined &&
        (!Array.isArray(c.parameterPaths) ||
          c.parameterPaths.length !== c.parameters.length ||
          c.parameterPaths.some((x) => x !== "" && !path(x))))
    )
      waError("WHATSAPP_TEMPLATE_CONFIG");
  } else if (
    c.bodyPath !== undefined
      ? !path(c.bodyPath)
      : typeof c.body !== "string" || !c.body.trim() || c.body.length > 4096
  )
    waError("WHATSAPP_BODY");
  if (!template && c.bodyPath !== undefined && c.body !== undefined)
    waError("WHATSAPP_CONFIG");
}
