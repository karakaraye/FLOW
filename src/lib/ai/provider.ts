import OpenAI from "openai";
import {
  EngineError,
  isObject,
  type Json,
  type Data,
} from "../engine/definition";
import { requestJson } from "../http-actions/network";
import { allowedOrigin } from "../http-actions/credentials";
import type { AIModel } from "./models";
export type TokenUsage = {
  input: number;
  output: number;
  total: number;
  cachedInput: number;
};
export type ProviderRequest = {
  model: AIModel;
  input: { role: "developer" | "user"; content: string }[];
  schema: Data;
  kind: string;
  maxOutputTokens: number;
  correlationId: string;
  attemptId: string;
  timeoutMs: number;
};
export type ProviderResult = {
  state: "SUCCEEDED" | "REFUSED" | "FAILED";
  output?: Json;
  usage?: TokenUsage;
  requestId?: string;
  responseId?: string;
  code?: string;
};
export class AIProviderError extends Error {
  constructor(
    public code: string,
    public definitive = false,
    public retryable = false,
  ) {
    super("AI provider request failed.");
  }
}
export interface AIProvider {
  readonly id: string;
  readonly mode: "LIVE" | "MOCK";
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
export function reportedUsage(v: unknown): TokenUsage | undefined {
  if (!isObject(v)) return;
  const input = v.input_tokens,
    output = v.output_tokens,
    total = v.total_tokens;
  if (
    ![input, output, total].every(
      (x) => Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= 10000000,
    ) ||
    Number(input) + Number(output) !== total
  )
    return;
  const cached = isObject(v.input_tokens_details)
    ? v.input_tokens_details.cached_tokens
    : 0;
  if (
    cached !== undefined &&
    (!Number.isSafeInteger(cached) ||
      Number(cached) < 0 ||
      Number(cached) > Number(input))
  )
    return;
  return {
    input: Number(input),
    output: Number(output),
    total: Number(total),
    cachedInput: Number(cached ?? 0),
  };
}
const identifier = (v: unknown, prefix: string) =>
  typeof v === "string" && new RegExp(`^${prefix}[A-Za-z0-9_-]{1,120}$`).test(v)
    ? v
    : undefined;
export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  constructor(
    readonly mode: "LIVE" | "MOCK",
    private key: string,
  ) {}
  async generate(r: ProviderRequest): Promise<ProviderResult> {
    const client = new OpenAI({
      apiKey: this.key,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      timeout: r.timeoutMs,
      fetch: async (input, init) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        if (
          url.href !== "https://api.openai.com/v1/responses" ||
          req.method !== "POST"
        )
          throw new EngineError("AI_ENDPOINT_DENIED", "Untrusted AI endpoint.");
        allowedOrigin(url);
        let body;
        try {
          body = JSON.parse(await req.text());
        } catch {
          throw new EngineError("AI_INVALID_REQUEST", "Invalid AI request.");
        }
        const result = await requestJson(url, {
          method: "POST",
          headers: Object.fromEntries(req.headers.entries()),
          body,
          timeoutMs: r.timeoutMs,
          signal: req.signal,
        });
        return new Response(JSON.stringify(result.data), {
          status: result.status,
          headers: {
            "Content-Type": "application/json",
            ...(result.requestId ? { "x-request-id": result.requestId } : {}),
          },
        });
      },
    });
    try {
      const response = await client.responses.create(
        {
          model: r.model.model,
          input: r.input,
          max_output_tokens: r.maxOutputTokens,
          store: false,
          tools: [],
          tool_choice: "none",
          text: {
            format: {
              type: "json_schema",
              name: `flowpilot_${r.kind}`,
              strict: true,
              schema: r.schema,
            },
          },
        },
        {
          headers: {
            "X-Client-Request-Id": r.attemptId,
            "Idempotency-Key": r.correlationId,
          },
          timeout: r.timeoutMs,
          maxRetries: 0,
        },
      );
      const usage = reportedUsage(response.usage),
        meta = {
          usage,
          requestId: identifier(response._request_id, "req_"),
          responseId: identifier(response.id, "resp_"),
        };
      if (response.status === "incomplete")
        return {
          state: "FAILED",
          code:
            response.incomplete_details?.reason === "max_output_tokens"
              ? "AI_TOKEN_LIMIT"
              : "AI_CONTENT_FILTER",
          ...meta,
        };
      if (response.status !== "completed" || !Array.isArray(response.output))
        return { state: "FAILED", code: "AI_INVALID_RESPONSE", ...meta };
      let text = "";
      for (const item of response.output) {
        if (item.type === "reasoning") continue;
        if (item.type !== "message" || !Array.isArray(item.content))
          return { state: "FAILED", code: "AI_INVALID_RESPONSE", ...meta };
        for (const part of item.content) {
          if (part.type === "refusal")
            return { state: "REFUSED", code: "AI_REFUSED", ...meta };
          if (part.type !== "output_text" || typeof part.text !== "string")
            return { state: "FAILED", code: "AI_INVALID_RESPONSE", ...meta };
          text += part.text;
        }
      }
      try {
        const output: unknown = JSON.parse(text);
        return { state: "SUCCEEDED", output: output as Json, ...meta };
      } catch {
        return { state: "FAILED", code: "AI_INVALID_RESPONSE", ...meta };
      }
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        const status = error.status;
        const code = typeof error.code === "string" ? error.code : "";
        if (status === 401 || status === 403)
          throw new AIProviderError("AI_AUTH_FAILED", true);
        if (status === 429)
          throw new AIProviderError("AI_RATE_LIMIT", true, true);
        if (status === 400 || status === 404 || status === 422)
          throw new AIProviderError(
            code === "context_length_exceeded"
              ? "AI_CONTEXT_LIMIT"
              : "AI_REQUEST_REJECTED",
            true,
          );
      }
      throw new AIProviderError("AI_USAGE_UNKNOWN");
    }
  }
}
