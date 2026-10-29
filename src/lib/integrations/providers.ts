export const providerMetadata = [
  {
    id: "https-bearer",
    name: "HTTPS Bearer Connection",
    description:
      "A verified bearer credential restricted to one public HTTPS origin for HTTP action nodes.",
    authMethod: "BEARER",
    requiredScopes: [],
    capabilities: ["http.request"],
    state: "AVAILABLE",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    description:
      "Outbound email through your authorized Google account. Requires operator Google OAuth configuration; no inbox access.",
    authMethod: "OAUTH2_PKCE",
    requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
    capabilities: ["gmail.send"],
    state: "COMING_SOON",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description:
      "Read bounded ranges, append a row, or update one row using an authorized Google account. Requires operator Google OAuth configuration.",
    authMethod: "OAUTH2_PKCE",
    requiredScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    capabilities: ["sheets.read, sheets.append, sheets.update"],
    state: "COMING_SOON",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "whatsapp-business",
    name: "WhatsApp Business",
    description:
      "Controlled developer-owned Meta WhatsApp Cloud API connection. Customer Embedded Signup is not available.",
    authMethod: "CONTROLLED_META_TOKEN",
    requiredScopes: [
      "whatsapp_business_messaging",
      "whatsapp_business_management",
    ],
    capabilities: [
      "whatsapp.receive",
      "whatsapp.reply",
      "whatsapp.utility_template",
    ],
    state: "COMING_SOON",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "http-api",
    name: "Generic HTTP API",
    description:
      "Future restricted API connections. No arbitrary URL requests or unrestricted HTTP workflow actions are available.",
    authMethod: "API_KEY",
    requiredScopes: [],
    capabilities: ["http.request (planned, destination policy required)"],
    state: "COMING_SOON",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    description:
      "Future project-scoped API credentials. No model calls or AI workflow nodes are implemented.",
    authMethod: "API_KEY",
    requiredScopes: [],
    capabilities: ["ai.generate (planned)"],
    state: "COMING_SOON",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "local-test",
    name: "Local Test Provider",
    description:
      "Test environment only. Authenticates signed local test credentials; not OAuth and not a third-party connection.",
    authMethod: "LOCAL_TEST_CHALLENGE",
    requiredScopes: ["test:health"],
    capabilities: ["test.health"],
    state: "TEST_ONLY",
    configurationSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;
export function testAdapterEnabled() {
  try {
    return (
      process.env.INTEGRATION_TEST_ADAPTER_ENABLED === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.BETTER_AUTH_URL ?? "").hostname,
      )
    );
  } catch {
    return false;
  }
}
