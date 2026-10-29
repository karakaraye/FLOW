import { EngineError, isObject } from "../engine/definition";
import { aiTypes, type AIType } from "./config";
export type AIModel = {
  id: string;
  provider: "openai";
  model: string;
  enabled: boolean;
  capabilities: AIType[];
  maxInputBytes: number;
  maxOutputTokens: number;
  inputMicrosPerMillion: string;
  outputMicrosPerMillion: string;
  pricingUpdatedAt: string;
};
export function models(): AIModel[] {
  try {
    const rows: unknown = JSON.parse(
      process.env.FLOWPILOT_AI_MODELS_JSON ?? "[]",
    );
    if (!Array.isArray(rows) || rows.length > 20) throw Error();
    const ids = new Set();
    for (const r of rows) {
      if (
        !isObject(r) ||
        Object.keys(r).some(
          (k) =>
            ![
              "id",
              "provider",
              "model",
              "enabled",
              "capabilities",
              "maxInputBytes",
              "maxOutputTokens",
              "inputMicrosPerMillion",
              "outputMicrosPerMillion",
              "pricingUpdatedAt",
            ].includes(k),
        ) ||
        typeof r.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) ||
        r.id === "default" ||
        ids.has(r.id) ||
        r.provider !== "openai" ||
        typeof r.model !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(r.model) ||
        typeof r.enabled !== "boolean" ||
        !Array.isArray(r.capabilities) ||
        !r.capabilities.length ||
        r.capabilities.some(
          (t) => !(aiTypes as readonly unknown[]).includes(t),
        ) ||
        !Number.isInteger(r.maxInputBytes) ||
        Number(r.maxInputBytes) < 100 ||
        Number(r.maxInputBytes) > 6000 ||
        !Number.isInteger(r.maxOutputTokens) ||
        Number(r.maxOutputTokens) < 16 ||
        Number(r.maxOutputTokens) > 2048
      )
        throw Error();
      ids.add(r.id);
      if (
        r.enabled &&
        (!/^[0-9]{1,13}$/.test(String(r.inputMicrosPerMillion)) ||
          !/^[0-9]{1,13}$/.test(String(r.outputMicrosPerMillion)) ||
          BigInt(String(r.inputMicrosPerMillion)) <= 0n ||
          BigInt(String(r.outputMicrosPerMillion)) <= 0n ||
          typeof r.pricingUpdatedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.pricingUpdatedAt) ||
          !Number.isFinite(Date.parse(r.pricingUpdatedAt)))
      )
        throw Error();
    }
    return rows as AIModel[];
  } catch {
    throw new EngineError(
      "AI_MODELS_UNCONFIGURED",
      "The operator model/pricing configuration is unavailable.",
      503,
    );
  }
}
export function approvedModel(id: string, type: AIType) {
  const key = id === "default" ? process.env.FLOWPILOT_AI_DEFAULT_MODEL : id;
  const m = models().find(
    (m) => m.id === key && m.enabled && m.capabilities.includes(type),
  );
  if (!m)
    throw new EngineError(
      "AI_MODEL_DENIED",
      "This model is not enabled for the requested AI operation.",
      422,
    );
  return m;
}
export function costMicros(
  input: number,
  output: number,
  model: Pick<AIModel, "inputMicrosPerMillion" | "outputMicrosPerMillion">,
) {
  return (
    (BigInt(input) * BigInt(model.inputMicrosPerMillion) +
      BigInt(output) * BigInt(model.outputMicrosPerMillion) +
      999999n) /
    1000000n
  );
}
export function provenance() {
  try {
    return process.env.FLOWPILOT_AI_TEST_LABEL === "MOCK" &&
      process.env.FLOWPILOT_OPENAI_API_KEY === "fixture-ai-key" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.BETTER_AUTH_URL ?? "").hostname,
      )
      ? "MOCK"
      : "LIVE";
  } catch {
    return "LIVE";
  }
}
export function providerStatus() {
  let list: AIModel[] = [];
  let code: string | undefined;
  try {
    list = models().filter((m) => m.enabled);
  } catch {
    code = "AI_MODELS_UNCONFIGURED";
  }
  const key = Boolean(process.env.FLOWPILOT_OPENAI_API_KEY);
  return {
    provider: "openai",
    configured: key && list.length > 0,
    credentialConfigured: key,
    modelCount: list.length,
    mode: provenance(),
    code:
      code ??
      (!key
        ? "AI_PROVIDER_UNCONFIGURED"
        : list.length
          ? null
          : "AI_MODELS_UNCONFIGURED"),
  };
}
