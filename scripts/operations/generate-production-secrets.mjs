import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";

// Production secret generator
const domain = process.argv[2] || process.env.PUBLIC_DOMAIN || "https://your-domain.com";
const normalizedDomain = domain.startsWith("http") ? domain : `https://${domain}`;

const authSecret = randomBytes(32).toString("hex");
const opsToken = randomBytes(32).toString("hex");
const vaultKeyId = `prod-vault-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const vaultKey = randomBytes(32).toString("base64");
const vaultKeyRing = JSON.stringify({ [vaultKeyId]: vaultKey });
const metaHashKey = randomBytes(32).toString("hex");
const backupKeyId = `prod-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const backupKey = randomBytes(32).toString("base64");

const template = `# ==============================================================================
# FlowPilot AI - Production Environment Configuration
# Generated: ${new Date().toISOString()}
# Target Origin: ${normalizedDomain}
# ==============================================================================

# Core Runtime
NODE_ENV=production
FLOWPILOT_ENV=production
FLOWPILOT_PROCESS_ROLE=web

# Canonical Public Origin (Strict HTTPS, no trailing slash)
BETTER_AUTH_URL=${normalizedDomain}
BETTER_AUTH_SECRET=${authSecret}

# Database Connection (Requires sslmode=verify-full in production)
# Set your managed PostgreSQL 17 connection string (e.g. Neon, AWS RDS, Supabase):
DATABASE_URL=postgresql://user:password@db-host:5432/flowpilot?sslmode=verify-full
# Optional separate direct session connection for DDL migrations:
# DIRECT_DATABASE_URL=postgresql://user:password@db-host:5432/flowpilot?sslmode=verify-full
DB_POOL_MAX=10

# Operational Monitoring & Health Token (32+ chars)
OPERATIONS_TOKEN=${opsToken}

# Public Registration & Email Verification
AUTH_REGISTRATION_ENABLED=true

# Universal Email Delivery (Option A: Resend or Option B: SMTP)
# Option A: Resend (Recommended)
RESEND_API_KEY=
# Option B: SMTP / SES / SendGrid
# SMTP_URL=smtp://user:pass@smtp.mailgun.org:587
# SMTP_HOST=smtp.mailgun.org
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_SECURE=false
EMAIL_FROM=FlowPilot AI <no-reply@${new URL(normalizedDomain).hostname}>

# AES-256-GCM Integration Encryption Keyring (Server-Side Vault)
INTEGRATION_ACTIVE_KEY_ID=${vaultKeyId}
INTEGRATION_ENCRYPTION_KEYS='${vaultKeyRing}'
INTEGRATION_TEST_ADAPTER_ENABLED=false

# Outbound HTTP Origin Allowlist (SSRF Protection)
# Approve the external endpoints your workflows communicate with:
HTTP_ACTION_ALLOWED_ORIGINS='["https://api.openai.com","https://oauth2.googleapis.com","https://www.googleapis.com","https://sheets.googleapis.com","https://gmail.googleapis.com","https://graph.facebook.com","https://api.paystack.co"]'
HTTP_IDEMPOTENT_ORIGINS='["https://api.openai.com","https://api.paystack.co"]'

# Set to true when live external credentials below have been verified:
FLOWPILOT_PROVIDERS_VERIFIED=true

# Provider 1: OpenAI
FLOWPILOT_OPENAI_API_KEY=
FLOWPILOT_AI_DEFAULT_MODEL=gpt-4o-mini
FLOWPILOT_AI_MODELS_JSON='[{"id":"gpt-4o-mini","name":"GPT-4o Mini","capabilities":["text","structured"],"pricing":{"inputPerMillion":150000,"outputPerMillion":600000}}]'
FLOWPILOT_AI_MAX_DAILY_MICROS=10000000
FLOWPILOT_AI_MAX_MONTHLY_MICROS=50000000

# Provider 2: Google Sheets & Gmail OAuth
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=${normalizedDomain}/api/integrations/google/callback
GOOGLE_GMAIL_SEND_ENABLED=false
GOOGLE_GMAIL_ALLOWED_RECIPIENTS=[]

# Provider 3: Meta WhatsApp Business Cloud API v26.0
META_WHATSAPP_DEVELOPER_ENABLED=false
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_RECIPIENT_HASH_KEY=${metaHashKey}
META_GRAPH_API_VERSION=v26.0
META_WHATSAPP_TEST_ASSETS=[]
META_WHATSAPP_TEST_RECIPIENTS=[]

# Provider 4: Paystack Billing (NGN)
PAYSTACK_TEST_ENABLED=false
PAYSTACK_SECRET_KEY=
PAYSTACK_TEST_PLAN_CODES_JSON={}

# Encrypted Database Disaster Recovery
BACKUP_KEY_ID=${backupKeyId}
BACKUP_ENCRYPTION_KEY=${backupKey}
# BACKUP_DATABASE_URL=
# BACKUP_OUTPUT=/protected/backups/flowpilot-latest.backup.enc
`;

const outputPath = new URL("../../.env.production.example", import.meta.url);
writeFileSync(outputPath, template, { mode: 0o600 });

console.log("==================================================================");
console.log("✅ Production secrets and environment template generated!");
console.log(`📁 File written to: .env.production.example`);
console.log(`🌐 Public Domain: ${normalizedDomain}`);
console.log("==================================================================");
console.log("\nKey Generated Values:");
console.log(`- BETTER_AUTH_SECRET: ${authSecret.slice(0, 10)}... (64 chars)`);
console.log(`- OPERATIONS_TOKEN:   ${opsToken.slice(0, 10)}... (64 chars)`);
console.log(`- Active Vault Key:   ${vaultKeyId}`);
console.log(`- Backup Key ID:      ${backupKeyId}`);
console.log("==================================================================");

