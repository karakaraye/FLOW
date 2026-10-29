import { requestJson } from "../http-actions/network";
import { allowedOrigin } from "../http-actions/credentials";
import { isObject, type Data } from "../engine/definition";
import { billingError } from "./config";
export function paystackSettings() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (
    process.env.PAYSTACK_TEST_ENABLED !== "true" ||
    typeof key !== "string" ||
    !/^sk_test_[A-Za-z0-9]{16,128}$/.test(key)
  )
    billingError("PAYSTACK_TEST_NOT_CONFIGURED", 503);
  return { key };
}
export function paystackConfigured() {
  try {
    paystackSettings();
    return true;
  } catch {
    return false;
  }
}
export function billingMode() {
  return paystackConfigured() &&
    process.env.PAYSTACK_TEST_LABEL === "MOCK" &&
    paystackSettings().key === "sk_test_fixture0000000000000000000000000000" &&
    ["localhost", "127.0.0.1"].includes(
      new URL(process.env.BETTER_AUTH_URL!).hostname,
    )
    ? "MOCK"
    : paystackConfigured()
      ? "PAYSTACK_TEST"
      : "UNCONFIGURED";
}
export async function paystackRequest(
  path: string,
  method = "GET",
  body?: Data,
  query?: Record<string, string>,
) {
  if (
    !/^\/(?:plan\/PLN_[A-Za-z0-9]+|transaction\/initialize|transaction\/verify\/[A-Za-z0-9][A-Za-z0-9_.=-]{0,149}|transaction\/\d+|subscription(?:\/SUB_[A-Za-z0-9]+|\/disable)?)$/.test(
      path,
    )
  )
    billingError("PAYSTACK_ENDPOINT_DENIED");
  const url = new URL("https://api.paystack.co" + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  allowedOrigin(url);
  let response;
  try {
    response = await requestJson(url, {
      method,
      headers: { Authorization: `Bearer ${paystackSettings().key}` },
      ...(body ? { body } : {}),
      timeoutMs: 8000,
    });
  } catch {
    billingError("PAYSTACK_OUTCOME_UNKNOWN", 503);
  }
  if (
    response.status !== 200 ||
    !isObject(response.data) ||
    response.data.status !== true
  )
    billingError("PAYSTACK_OPERATION_UNVERIFIED", 503);
  return response.data.data;
}
export interface PaystackAdapter {
  plan(code: string): Promise<Record<string, unknown>>;
  initialize(body: Data): Promise<{ url: string }>;
  verify(reference: string): Promise<Record<string, unknown>>;
  subscription(code: string): Promise<Record<string, unknown>>;
  transaction(id: number): Promise<Record<string, unknown>>;
  createSubscription(body: Data): Promise<Record<string, unknown>>;
  disable(code: string, token: string): Promise<void>;
}
function object(v: unknown) {
  if (!isObject(v)) billingError("PAYSTACK_RESPONSE_INVALID", 503);
  return v;
}
export const paystackAdapter: PaystackAdapter = {
  async plan(code) {
    return object(await paystackRequest("/plan/" + code));
  },
  async initialize(body) {
    const d = object(
      await paystackRequest("/transaction/initialize", "POST", body),
    );
    if (typeof d.authorization_url !== "string")
      billingError("PAYSTACK_RESPONSE_INVALID");
    const u = new URL(d.authorization_url);
    if (
      u.origin !== "https://checkout.paystack.com" ||
      u.username ||
      u.password ||
      !/^\/[a-zA-Z0-9_-]{3,150}$/.test(u.pathname) ||
      u.search ||
      u.hash
    )
      billingError("PAYSTACK_CHECKOUT_URL_INVALID");
    return { url: u.href };
  },
  async verify(reference) {
    return object(await paystackRequest("/transaction/verify/" + reference));
  },
  async subscription(code) {
    return object(await paystackRequest("/subscription/" + code));
  },
  async transaction(id) {
    if (!Number.isSafeInteger(id) || id < 1)
      billingError("PAYSTACK_TRANSACTION_INVALID");
    return object(await paystackRequest("/transaction/" + id));
  },
  async createSubscription(body) {
    return object(await paystackRequest("/subscription", "POST", body));
  },
  async disable(code, token) {
    await paystackRequest("/subscription/disable", "POST", { code, token });
  },
};
