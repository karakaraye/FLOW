import Ajv from "ajv";
import {
  EngineError,
  assertJson,
  type WorkflowNode,
  type Json,
  type Data,
} from "../engine/definition";
import { aiConfig, isAIType, sourceText, outputSchema } from "./config";
import { approvedModel, type AIModel } from "./models";
import { redactText, redactOutput, platformInstructions } from "./privacy";
import type { ProviderRequest } from "./provider";
const ajv = new Ajv({
  strict: true,
  allErrors: false,
  validateFormats: false,
  ownProperties: true,
  coerceTypes: false,
  useDefaults: false,
});
export function prepareAI(node: WorkflowNode, input: Json) {
  if (!isAIType(node.type))
    throw new EngineError("AI_INVALID_CONFIG", "Expected an AI node.");
  aiConfig(node.type, node.config);
  const model = approvedModel(String(node.config.modelId), node.type);
  if (Number(node.config.maxOutputTokens) > model.maxOutputTokens)
    throw new EngineError(
      "AI_MODEL_LIMIT",
      "Output tokens exceed the approved model limit.",
    );
  const raw = sourceText(input, String(node.config.textPath));
  if (Buffer.byteLength(raw) > model.maxInputBytes)
    throw new EngineError(
      "AI_INPUT_LIMIT",
      "The selected AI input exceeds the model limit.",
    );
  const known = [process.env.FLOWPILOT_OPENAI_API_KEY ?? ""];
  const c = { ...node.config };
  delete c.modelId;
  delete c.textPath;
  delete c.maxOutputTokens;
  delete c.schema;
  const schema = outputSchema(node.type, node.config);
  if (redactText(JSON.stringify(schema), known) !== JSON.stringify(schema))
    throw new EngineError(
      "AI_SCHEMA_PRIVACY",
      "Do not place secrets or personal data in the output schema.",
    );
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch {
    throw new EngineError(
      "AI_INVALID_SCHEMA",
      "The output schema is not supported.",
    );
  }
  const messages: ProviderRequest["input"] = [
    { role: "developer", content: platformInstructions },
    {
      role: "user",
      content: JSON.stringify({
        operation: node.type,
        workflow_author_configuration: redactOutput(c, known),
      }),
    },
    {
      role: "user",
      content: JSON.stringify({ untrusted_source: redactText(raw, known) }),
    },
  ];
  const bytes = Buffer.byteLength(JSON.stringify({ input: messages, schema }));
  if (bytes > 13000)
    throw new EngineError(
      "AI_INPUT_LIMIT",
      "The prepared AI request is too large.",
    );
  // Conservative byte-based upper bound plus envelope allowance, not a tokenizer estimate.
  const inputTokenBound = bytes + 1024;
  return {
    model,
    schema,
    messages,
    inputTokenBound,
    maxOutputTokens: Number(node.config.maxOutputTokens),
    validate(output: Json) {
      try {
        assertJson(output, 8192);
        if (!validate(output)) throw Error();
        const clean = redactOutput(output, known);
        if (!validate(clean)) throw Error();
        return clean;
      } catch {
        throw new EngineError(
          "AI_INVALID_RESPONSE",
          "The model output failed its local strict schema or privacy checks.",
        );
      }
    },
  };
}
export type PreparedAI = ReturnType<typeof prepareAI>;
export function pricingSnapshot(model: AIModel): Data {
  return {
    inputMicrosPerMillion: model.inputMicrosPerMillion,
    outputMicrosPerMillion: model.outputMicrosPerMillion,
    pricingUpdatedAt: model.pricingUpdatedAt,
  };
}
