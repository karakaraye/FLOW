import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Data } from "../src/lib/engine/definition";
import { aiTypes } from "../src/lib/ai/config";
export const mockModel = {
  id: "mock-model",
  provider: "openai",
  model: "mock-model",
  enabled: true,
  capabilities: [...aiTypes],
  maxInputBytes: 6000,
  maxOutputTokens: 1024,
  inputMicrosPerMillion: "1000000",
  outputMicrosPerMillion: "2000000",
  pricingUpdatedAt: "2026-10-29",
};
export function mockOutput(kind: string, schema: Data): unknown {
  if (kind === "ai_classify")
    return {
      category:
        ((schema.properties as Data).category as Data).enum instanceof Array
          ? (((schema.properties as Data).category as Data).enum as string[])[0]
          : "general",
      explanation: null,
    };
  if (kind === "ai_summarize")
    return { summary: "MOCK summary from controlled provider" };
  if (kind === "ai_sentiment")
    return { label: "NEUTRAL", explanation: "MOCK explanation" };
  if (kind === "ai_generate_text") return { text: "MOCK generated content" };
  return Object.fromEntries(
    Object.entries(schema.properties as Data).map(([k, v]) => [
      k,
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      (v.type === "string" ||
        (Array.isArray(v.type) && v.type.includes("string")))
        ? "MOCK extracted text"
        : null,
    ]),
  );
}
export async function aiFixture() {
  const dir = mkdtempSync(join(tmpdir(), "flow-ai-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "tls.key"),
      "-out",
      join(dir, "tls.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=api.openai.com",
      "-addext",
      "subjectAltName=DNS:api.openai.com",
    ],
    { stdio: "ignore" },
  );
  let mode = "success",
    calls = 0,
    rateFailures = 0,
    delay = 0;
  const requests: Record<string, unknown>[] = [];
  const server = https.createServer(
    {
      key: readFileSync(join(dir, "tls.key")),
      cert: readFileSync(join(dir, "tls.pem")),
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        calls++;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("x-request-id", `req_mock_${calls}`);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        if (
          req.url !== "/v1/responses" ||
          req.headers.authorization !== "Bearer fixture-ai-key"
        ) {
          res.writeHead(401);
          res.end(
            '{"error":{"message":"fixture-private-message","type":"invalid_api_key"}}',
          );
          return;
        }
        if (mode === "auth") {
          res.writeHead(401);
          res.end(
            '{"error":{"message":"fixture-private-secret","type":"invalid_api_key"}}',
          );
          return;
        }
        if (mode === "rate" || rateFailures > 0) {
          if (rateFailures > 0) rateFailures--;
          res.writeHead(429);
          res.end(
            '{"error":{"message":"fixture-private-rate","type":"rate_limit_exceeded"}}',
          );
          return;
        }
        if (mode === "outage") {
          res.writeHead(503);
          res.end('{"error":{"message":"fixture-private-outage"}}');
          return;
        }
        const format = body.text.format,
          kind = String(format.name).replace("flowpilot_", "");
        const text =
          mode === "malformed"
            ? "{broken"
            : mode === "category"
              ? '{"category":"not-allowed","explanation":null}'
              : JSON.stringify(mockOutput(kind, format.schema));
        const answer = {
          id: `resp_mock_${calls}`,
          object: "response",
          created_at: 1,
          model: "mock-model",
          status: mode === "limit" ? "incomplete" : "completed",
          ...(mode === "limit"
            ? { incomplete_details: { reason: "max_output_tokens" } }
            : {}),
          output: [
            {
              id: "msg_mock",
              type: "message",
              role: "assistant",
              status: "completed",
              content:
                mode === "refusal"
                  ? [{ type: "refusal", refusal: "fixture-private-refusal" }]
                  : [{ type: "output_text", text, annotations: [] }],
            },
          ],
          usage:
            mode === "unknownUsage"
              ? null
              : {
                  input_tokens: 40,
                  output_tokens: 20,
                  total_tokens: 60,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 0 },
                },
        };
        const send = () => res.end(JSON.stringify(answer));
        if (delay) setTimeout(send, delay);
        else send();
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("AI fixture unavailable");
  return {
    port: addr.port,
    ca: join(dir, "tls.pem"),
    env: {
      FLOWPILOT_OPENAI_API_KEY: "fixture-ai-key",
      FLOWPILOT_AI_MODELS_JSON: JSON.stringify([mockModel]),
      FLOWPILOT_AI_DEFAULT_MODEL: "mock-model",
      FLOWPILOT_AI_TEST_LABEL: "MOCK",
      HTTP_ACTION_ALLOWED_ORIGINS: '["https://api.openai.com"]',
      FLOW_AI_FIXTURE_PORT: String(addr.port),
      FLOW_AI_FIXTURE_CA: join(dir, "tls.pem"),
    },
    requests,
    get calls() {
      return calls;
    },
    set mode(v: string) {
      mode = v;
    },
    set rateFailures(v: number) {
      rateFailures = v;
    },
    set delayMs(v: number) {
      delay = v;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
