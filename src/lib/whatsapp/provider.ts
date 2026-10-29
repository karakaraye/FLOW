import { createHmac } from "node:crypto";
import { requestJson } from "../http-actions/network";
import { allowedOrigin } from "../http-actions/credentials";
import { isObject, type Data } from "../engine/definition";
import { asset, waError } from "./config";
export const GRAPH_VERSION = "v26.0"; // Verified official Graph changelog, 2026-10-29.
export type MetaSettings = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  version: string;
};
export function metaSettings(): MetaSettings {
  const appId = process.env.META_APP_ID,
    appSecret = process.env.META_APP_SECRET,
    verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN,
    version = process.env.META_GRAPH_API_VERSION;
  if (
    !asset(appId) ||
    !appSecret ||
    appSecret.length < 16 ||
    !verifyToken ||
    verifyToken.length < 24 ||
    version !== GRAPH_VERSION ||
    !process.env.META_RECIPIENT_HASH_KEY ||
    process.env.META_RECIPIENT_HASH_KEY.length < 32 ||
    process.env.META_WHATSAPP_DEVELOPER_ENABLED !== "true"
  )
    waError("WHATSAPP_NOT_CONFIGURED", 503);
  return { appId, appSecret, verifyToken, version };
}
export function metaConfigured() {
  try {
    metaSettings();
    return true;
  } catch {
    return false;
  }
}
export function provenance() {
  return process.env.META_TEST_LABEL === "MOCK" &&
    process.env.META_APP_ID === "100001" &&
    ["localhost", "127.0.0.1"].includes(
      new URL(process.env.BETTER_AUTH_URL!).hostname,
    )
    ? "MOCK"
    : "DEVELOPER_TEST";
}
export type Template = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body: string;
  parameters: number;
  supported: boolean;
};
export interface WhatsAppAdapter {
  verify(
    token: string,
    accountId: string,
    phoneId: string,
  ): Promise<{
    name: string;
    phone: string;
    phoneName: string;
    expiresAt: Date;
  }>;
  templates(token: string, accountId: string): Promise<Template[]>;
  send(
    token: string,
    phoneId: string,
    payload: Data,
    timeoutMs: number,
  ): Promise<{ id: string }>;
}
export class MetaFailure extends Error {
  constructor(
    public code: string,
    public ambiguous = false,
    public retryable = false,
    public status?: number,
  ) {
    super("Meta provider request could not be verified.");
  }
}
export async function graphRequest(
  token: string,
  path: string,
  options: {
    method?: string;
    body?: Data;
    timeoutMs?: number;
    query?: Record<string, string>;
  } = {},
) {
  const settings = metaSettings();
  if (
    !/^(?:debug_token|\d{5,32}(?:\/(?:phone_numbers|message_templates|messages))?)$/.test(
      path,
    )
  )
    waError("WHATSAPP_ENDPOINT_DENIED");
  const url = new URL(`https://graph.facebook.com/${settings.version}/${path}`);
  for (const [k, v] of Object.entries(options.query ?? {}))
    url.searchParams.set(k, v);
  if (path !== "debug_token")
    url.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", settings.appSecret).update(token).digest("hex"),
    );
  allowedOrigin(url);
  let r;
  try {
    r = await requestJson(url, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${token}` },
      ...(options.body ? { body: options.body } : {}),
      timeoutMs: options.timeoutMs ?? 8000,
    });
  } catch {
    throw new MetaFailure(
      "WHATSAPP_OUTCOME_UNKNOWN",
      options.method === "POST",
    );
  }
  const d = r.data;
  if (r.status < 200 || r.status >= 300 || (isObject(d) && d.error)) {
    const code = isObject(d) && isObject(d.error) ? d.error.code : undefined;
    const rate =
      r.status === 429 ||
      [4, 17, 32, 613, 80007, 130429, 131056].includes(Number(code));
    const definitive = r.status >= 400 && r.status < 500;
    throw new MetaFailure(
      rate
        ? "WHATSAPP_RATE_LIMIT"
        : r.status === 401 || code === 190
          ? "WHATSAPP_REAUTHORIZE"
          : "WHATSAPP_PROVIDER_REJECTED",
      !definitive && options.method === "POST",
      rate && definitive,
      r.status,
    );
  }
  if (!isObject(d))
    throw new MetaFailure(
      "WHATSAPP_RESPONSE_INVALID",
      options.method === "POST",
    );
  return d;
}
export function parseTemplate(d: unknown): Template | null {
  if (
    !isObject(d) ||
    !asset(d.id) ||
    typeof d.name !== "string" ||
    !/^\w{1,512}$/.test(d.name) ||
    typeof d.language !== "string" ||
    typeof d.status !== "string" ||
    typeof d.category !== "string" ||
    !Array.isArray(d.components)
  )
    return null;
  const body = d.components.find((c) => isObject(c) && c.type === "BODY");
  const text = isObject(body) && typeof body.text === "string" ? body.text : "";
  const slots = [...text.matchAll(/\{\{(.*?)\}\}/g)].map((x) => x[1]);
  const nums = [...new Set(slots)].sort((a, b) => Number(a) - Number(b));
  const supported =
    d.category === "UTILITY" &&
    (d.parameter_format === undefined || d.parameter_format === "POSITIONAL") &&
    text.length > 0 &&
    text.length <= 4096 &&
    nums.length <= 10 &&
    nums.every((x, i) => x === String(i + 1)) &&
    d.components.every(
      (c) =>
        isObject(c) &&
        ["BODY", "FOOTER", "HEADER"].includes(String(c.type)) &&
        (c.type !== "HEADER" || c.format === "TEXT") &&
        (c.type === "BODY" ||
          (typeof c.text === "string" && !c.text.includes("{{"))),
    );
  return {
    id: d.id,
    name: d.name,
    language: d.language,
    status: d.status,
    category: d.category,
    body: text,
    parameters: nums.length,
    supported,
  };
}
export const metaAdapter: WhatsAppAdapter = {
  async verify(token, accountId, phoneId) {
    const s = metaSettings();
    const debug = await graphRequest(
      `${s.appId}|${s.appSecret}`,
      "debug_token",
      { query: { input_token: token } },
    );
    const d = debug.data;
    if (
      !isObject(d) ||
      d.is_valid !== true ||
      d.app_id !== s.appId ||
      !Array.isArray(d.scopes) ||
      !["whatsapp_business_messaging", "whatsapp_business_management"].every(
        (x) => (d.scopes as unknown[]).includes(x),
      )
    )
      throw new MetaFailure("WHATSAPP_TOKEN_INVALID");
    if (
      !Number.isSafeInteger(d.expires_at) ||
      Number(d.expires_at) < 0 ||
      (d.data_access_expires_at !== undefined &&
        (!Number.isSafeInteger(d.data_access_expires_at) ||
          Number(d.data_access_expires_at) < 0))
    )
      throw new MetaFailure("WHATSAPP_TOKEN_INVALID");
    if (d.granular_scopes !== undefined) {
      if (!Array.isArray(d.granular_scopes))
        throw new MetaFailure("WHATSAPP_TOKEN_INVALID");
      for (const scope of [
        "whatsapp_business_messaging",
        "whatsapp_business_management",
      ]) {
        const grant = d.granular_scopes.find(
          (x) => isObject(x) && x.scope === scope,
        );
        if (
          isObject(grant) &&
          grant.target_ids !== undefined &&
          (!Array.isArray(grant.target_ids) ||
            !grant.target_ids.includes(accountId))
        )
          throw new MetaFailure("WHATSAPP_ASSET_DENIED");
      }
    }
    const expires = Number(d.expires_at),
      dataExpires = Number(d.data_access_expires_at);
    const expiry = Math.min(
      expires > 0 ? expires * 1000 : Date.now() + 86400000,
      dataExpires > 0 ? dataExpires * 1000 : Infinity,
      Date.now() + 86400000,
    );
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      throw new MetaFailure("WHATSAPP_TOKEN_EXPIRED");
    const a = await graphRequest(token, accountId, {
      query: { fields: "id,name" },
    });
    const p = await graphRequest(token, `${accountId}/phone_numbers`, {
      query: { fields: "id,display_phone_number,verified_name", limit: "100" },
    });
    const phone = Array.isArray(p.data)
      ? p.data.find((x) => isObject(x) && x.id === phoneId)
      : undefined;
    if (
      a.id !== accountId ||
      typeof a.name !== "string" ||
      !isObject(phone) ||
      typeof phone.display_phone_number !== "string" ||
      typeof phone.verified_name !== "string"
    )
      throw new MetaFailure("WHATSAPP_ASSET_DENIED");
    return {
      name: a.name.slice(0, 120),
      phone: phone.display_phone_number.replace(/\D/g, ""),
      phoneName: phone.verified_name.slice(0, 120),
      expiresAt: new Date(expiry),
    };
  },
  async templates(token, accountId) {
    const d = await graphRequest(token, `${accountId}/message_templates`, {
      query: {
        fields: "id,name,language,status,category,components,parameter_format",
        limit: "100",
      },
    });
    if (!Array.isArray(d.data))
      throw new MetaFailure("WHATSAPP_RESPONSE_INVALID");
    return d.data.map(parseTemplate).filter((x): x is Template => x !== null);
  },
  async send(token, phoneId, payload, timeoutMs) {
    const d = await graphRequest(token, `${phoneId}/messages`, {
      method: "POST",
      body: payload,
      timeoutMs,
    });
    const m = Array.isArray(d.messages) ? d.messages[0] : undefined;
    if (
      !isObject(m) ||
      typeof m.id !== "string" ||
      !/^wamid\.[A-Za-z0-9_+/=.-]{1,250}$/.test(m.id)
    )
      throw new MetaFailure("WHATSAPP_OUTCOME_UNKNOWN", true);
    return { id: m.id };
  },
};
