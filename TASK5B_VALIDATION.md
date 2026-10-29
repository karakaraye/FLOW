# Task 5B — webhook triggers and secure HTTP actions

Verdict: **PASS** for the scoped local implementation, verified 28 October 2026 (Africa/Lagos). No production deployment or Task 5C work occurred. The previous authentication, workspace isolation, templates, immutable versions, and integration vault remain in use.

## Architecture and added nodes

`webhook_trigger` and `http_request` extend the existing schema-version-1 definition validator, node registry, deterministic graph traversal, React Flow builder, published snapshots, and run history. Historical definitions are unchanged. There is still one PostgreSQL run queue and one graph traversal implementation: synchronous pure runs and asynchronous HTTP runs drive the same generator in `src/lib/engine/executor.ts`.

Pure runs retain the original bounded transaction and rollback/recovery behavior. Graphs containing HTTP actions use the same worker entry point with a PostgreSQL session advisory lock per run. Claiming RUNNING and each HTTP attempt intent commit before network I/O; no database transaction is held across an HTTP request. A second worker cannot acquire the run lock. The unique `(runId, nodeId, number)` constraint also prevents duplicate attempt admission. No in-memory queue is an authoritative record.

A QUEUED job remains recoverable after a worker restart. A lost worker's committed RUNNING external run is conservatively failed as `WORKER_LOST_OUTCOME_UNKNOWN`; outstanding attempts become AMBIGUOUS. Recovery never silently reissues that run's calls, even when the worker might have died before sending. Uncommitted node results remain absent, explicitly unrecorded in the existing run canvas; recovery does not invent node successes or failures. Durable attempt metadata identifies any known outbound intent. This favors avoiding duplicate side effects over automatically resuming uncertain external runs.

Run IDs, graph-local node IDs, and deterministic SHA-256 attempt IDs are stable and recorded. The worker rechecks current workspace membership, workflow availability, and cancellation before external actions and retries. An external run has a 60-second graph budget; pure runs keep their previous one-second budget. Cancelling marks a queued/running run FAILED with `RUN_CANCELLED` and prevents further admission/actions. A request already sent can still finish remotely; cancellation cannot undo it.

## Webhook signature protocol

Management creates a random UUID endpoint `/api/hooks/:webhookId` and a cryptographically random 32-byte base64url signing secret. Use the displayed secret **as UTF-8 text**, not base64-decoded bytes, as the HMAC key.

Send POST with `Content-Type: application/json` and these headers:

| Header                    | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| `X-FlowPilot-Timestamp`   | Unix seconds, exactly ten decimal digits                     |
| `X-FlowPilot-Delivery-Id` | Unique 8–100 characters: letters, digits, underscore, hyphen |
| `X-FlowPilot-Signature`   | `v1=` plus lowercase hex HMAC-SHA256                         |

Signed bytes are the UTF-8 prefix `v1.TIMESTAMP.DELIVERY_ID.` immediately followed by the **exact raw request-body bytes**. Do not parse/reserialize the body before signing. Example sender code:

```js
import { createHmac, randomUUID } from "node:crypto";
const raw = JSON.stringify({ customer: { score: 12 } });
const timestamp = String(Math.floor(Date.now() / 1000));
const deliveryId = randomUUID();
const digest = createHmac("sha256", process.env.FLOWPILOT_WEBHOOK_SECRET)
  .update(`v1.${timestamp}.${deliveryId}.`)
  .update(Buffer.from(raw))
  .digest("hex");
const response = await fetch(process.env.FLOWPILOT_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-FlowPilot-Timestamp": timestamp,
    "X-FlowPilot-Delivery-Id": deliveryId,
    "X-FlowPilot-Signature": `v1=${digest}`,
  },
  body: raw,
});
```

Signatures use constant-time comparison after strict format/length checks. Timestamps must be within ±300 seconds. Raw bodies are capped at 16 KiB with a five-second read deadline; JSON complexity/prototype-key validation is reused. A durable atomic counter permits 60 requests/minute/endpoint, including invalid signed requests. Unknown endpoint IDs return 404. There is no IP-forwarding-header trust.

The endpoint's creator must retain OWNER/ADMIN membership at admission. Disabled/revoked endpoints and disabled/archived workflows reject new jobs. Admission locks the workspace, workflow, endpoint, and current membership consistently, verifies the pinned immutable webhook version, then atomically inserts a WorkflowRun and unique WebhookDelivery. Signature failures never admit jobs. A 202 response means durably QUEUED, not synchronously executed. Reusing a delivery ID returns 409, including concurrent requests and after secret rotation. Dedup records do not expire automatically. A sender with an uncertain delivery response should check delivery history rather than inventing a new event ID automatically.

Secrets reuse Task 5A AES-256-GCM encryption, keyring, authenticated tenant/resource context, and fail-closed behavior. Webhook signing uses the dedicated webhook-signing provider/resource context under the existing credential purpose, not another cipher implementation. Only authorized creation/rotation POST responses disclose newly generated secrets. Read APIs never return stored plaintext or ciphertext. Rotation replaces the signing secret immediately; there is no overlap window. Storage-key rotation re-encrypts the existing secret without revealing it. Revocation clears current encrypted material and prevents reactivation; create a new endpoint afterward. Old backups/WAL and compromised senders need separate operational handling.

## Secure HTTP behavior and SSRF defenses

Supported methods: GET, POST, PATCH, PUT. Bodies are literal JSON or incoming node data, bounded to 16 KiB. Responses must be JSON, capped at 32 KiB, and are not automatically decompressed. Output is `{status, data}` with optional own-property dotted response selection. Values remain transient; audits contain only data shapes. A response's mapping/output-limit failure can occur after the remote action succeeded and must not be treated as proof the remote action failed.

Destinations require exact-origin administrator approval in server-only `HTTP_ACTION_ALLOWED_ORIGINS`, a JSON array such as `["https://api.your-service.com"]`. The default empty array denies all outbound actions and credential verification. No wildcard, credential entry, or arbitrary client-supplied header can override policy. URLs must be HTTPS on port 443, without userinfo, fragments, query strings, whitespace, or backslashes. Query strings are deliberately unsupported to reduce accidental secret storage. Static configuration validation runs in the builder and server; network authorization/DNS validation runs only server-side.

The transport uses Node's maintained native HTTPS/TLS client plus **ipaddr.js 2.5.0**, the only new direct dependency. All IP literals are denied, including URL-normalized hexadecimal, octal, decimal, shortened IPv4, IPv6, and mapped IPv6. Hostnames must resolve to public unicast addresses only; a mixed public/private DNS answer is rejected. IPv4 private, loopback, link-local, carrier-grade NAT, documentation, reserved, multicast, metadata, and special ranges are blocked. IPv6 is further restricted to global 2000::/3 with special, mapped, translation, tunnel, documentation, and reserved ranges rejected, including 3fff::/20.

DNS resolves once per attempt. **The validated address and family are supplied by a custom lookup callback to the native HTTPS connection**, retaining the original hostname for Host/SNI/certificate verification. Connection address selection therefore cannot perform another attacker-controlled lookup. `agent:false` avoids connection reuse across requests. TLS verification remains enabled. Automatic redirects are never followed, including same-origin redirects. No proxy fallback or unsafe remote URL fetch path bypasses the policy. DNS has a maximum three-second deadline capped by the configured total request budget; the remaining request time is bounded by the configured 100–10000 ms timeout.

Only Accept, Content-Type, X-Requested-With, and X-Client-Version are accepted as custom headers, with bounded values and no control characters. Host, Authorization, Cookie, proxy, forwarding, and arbitrary credential headers cannot be supplied in node JSON. Origin approval is independent of DNS checks: approval never permits a private destination.

## Credential connections and authorization

The new `https-bearer` provider represents HTTP-action bearer credentials. The five previous future providers remain Coming Soon, preserving their existing behavior. OWNER/ADMIN create a disconnected HTTPS Bearer Connection, enter a token once, choose an administrator-approved authenticated read-only verification URL, and supply expiry within 90 days. The server sends an actual pinned/TLS-verified GET and accepts only a successful bounded JSON response before encrypting the credential in the existing IntegrationCredential model. It repeats authorization and revision checks after verification before saving. The remote verification endpoint must enforce the token; a generic client cannot prove a remote endpoint actually requires authentication. This is not OAuth, account identity verification, refresh-token automation, or proof that every remote operation is authorized.

The token is restricted to an exact origin in both encrypted credential scopes and connection metadata. Every use rechecks membership, tenant ownership, provider availability, connection state/revocation/destruction/expiry, encrypted expiry, and the destination binding. Credentials cannot be reused across tenants or origins. Authorization is injected server-side only; normal metadata/read/run/audit APIs omit tokens and ciphertext. The original vault storage-key rotation, local revocation, removal, and sanitized audit history apply. Remote token revocation remains the customer's responsibility.

OWNER/ADMIN manage endpoints, workflow availability, and credentials; EDITOR can edit and run workflows, including immutable versions explicitly published by OWNER/ADMIN with approved credential references. VIEWER cannot mutate or run. Publishing remains OWNER/ADMIN-only. Existing session APIs keep exact-Origin CSRF protection; **only** the dedicated signed public `/api/hooks/:id` route uses machine authentication. No blanket API CSRF exemption or middleware weakening was introduced.

## Retry, idempotency, and ambiguous outcomes

Each attempt sends:

- `Idempotency-Key`: a stable hash of run and node, unchanged across retries.
- `X-FlowPilot-Execution-Id`: run ID.
- `X-FlowPilot-Node-Attempt-Id`: unique deterministic attempt ID.

Attempt count is 1–3 (default 1), with bounded 100/200 ms backoff. GET may retry eligible network uncertainties and HTTP 408/429/500/502/503/504. Other methods get exactly one attempt unless `retrySafe=true` **and** the origin is separately configured in server-only `HTTP_IDEMPOTENT_ORIGINS`. Operators must confirm the service's Idempotency-Key guarantee, key retention, and request semantics before approving it. A node setting alone cannot authorize write retries. Other failures do not retry. Redirects and SSRF denials never retry.

A timeout/disconnect after intent is conservatively AMBIGUOUS, with node error `HTTP_OUTCOME_UNKNOWN` if retries are unavailable/exhausted. Losing the worker produces `WORKER_LOST_OUTCOME_UNKNOWN`. **Neither PostgreSQL worker locks nor propagated keys guarantee exactly-once external effects.** A remote service may ignore keys or act before the client times out. Review that service before manually starting a replacement run; a new run intentionally gets a different key. No automatic compensation is claimed.

## Additive database changes and APIs

Three additive migrations are applied; twelve total migrations are present:

- `20261028165842_webhook_http_actions`: Workflow enabled/archive fields; provider AVAILABLE state; Webhook, WebhookDelivery, WebhookAudit, WebhookRate, and HttpAttempt tables and constraints.
- `20261028170622_webhook_version_binding`: composite version/workflow foreign key, preventing cross-workflow version binding.
- `20261028193000_webhook_http_constraints`: positive revisions, bounded rate/attempt fields, allowed attempt states, immutable delivery/dedup and sanitized audit triggers. Parent workspace/workflow teardown may cascade; direct update/delete is rejected.

No published version or historical run definition is rewritten. Existing template copies still use the same graph validator and publication/execution path; installed external definitions must bind to credentials in the destination workspace. Source tenant connection IDs cannot authorize execution in another workspace.

| Method | Path                                                                       | Access                                                                                               |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST   | `/api/hooks/:webhookId`                                                    | Signed delivery only                                                                                 |
| GET    | `/api/workspaces/:workspaceId/workflows/:workflowId/webhooks`              | All workspace members, metadata/history only                                                         |
| POST   | Same management path                                                       | OWNER/ADMIN; create, rotate, rotate-key, disable, enable, revoke; current revision for existing hook |
| PATCH  | `/api/workspaces/:workspaceId/workflows/:workflowId/state`                 | OWNER/ADMIN; enabled and archived flags                                                              |
| POST   | `/api/workspaces/:workspaceId/integrations/:integrationId/http-credential` | OWNER/ADMIN; token, healthUrl, expiresAt, revision                                                   |
| POST   | `/api/workspaces/:workspaceId/runs/:runId/cancel`                          | OWNER/ADMIN/EDITOR                                                                                   |
| GET    | Existing `/api/workspaces/:workspaceId/runs/:runId`                        | Existing member access; sanitized attempt metadata added                                             |

Management lists show latest 25 hooks, accepted deliveries, and audit entries. At most 25 endpoints per workflow are allowed. Management also has a bounded recent-event guard. Dedup/audit records are retained until parent teardown, not silently truncated when UI lists truncate.

## Visual builder and dashboard

Palette nodes, root validation, graph handles, configuration validation, immutable publication, branches, history snapshots, and canvas metadata all support the new types. Choosing Webhook Trigger replaces an existing manual trigger without changing its node ID/edges; the graph still requires exactly one trigger. Webhook setup uses published-version selection, endpoint/copy control, signature instructions, deliberately one-time secret display, rotation/storage-key rotation, disable/revoke controls, recent deliveries with real run links/status, and sanitized audit. Routine reload does not redisclose secrets.

HTTP configuration exposes method, URL, approved-header JSON, literal/input body, timeout, attempt count, optional verified connection, response mapping, and retry-guarantee explanation. Invalid JSON/header configuration cannot silently overwrite a valid draft. Integrations adds the password-type, one-time credential verification form for HTTPS Bearer Connections, restricted by role. Execution history shows actual attempt IDs/status/codes and the ambiguity explanation; authorized users can cancel pending runs. Scheduling and unimplemented provider integrations remain clearly Coming Soon.

## Exact verification results

Tests use real PostgreSQL, Better Auth sessions, production-mode Next.js, separate worker processes, and isolated local TLS services. Test certificates/keys are generated in temporary directories and removed. No arbitrary public website is required. The explicit test preload reroutes a validated public fixture IP to loopback **only inside test processes** and preserves certificate/SNI verification. It asserts the production transport's pinned lookup receives the validated IP. There is no application environment flag enabling private HTTP destinations. Rebinding tests prove a subsequent private DNS answer cannot reach the socket path. This establishes connection-time pinning in the tested native TLS path; it does not claim public Internet egress was exercised in this managed environment.

| Exact command                              | Result                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `npm install --save-exact ipaddr.js@2.5.0` | Installed successfully                                                     |
| `npm test`                                 | **144 passed, 0 failed, 0 skipped**; all prior 123 preserved               |
| `npm run test:e2e`                         | **14 passed, 0 failed, 0 skipped, 0 flaky**; all prior 12 preserved        |
| `npm run typecheck`                        | Passed                                                                     |
| `npm run lint`                             | Passed                                                                     |
| `npm run format:check`                     | Passed                                                                     |
| `npm run db:validate`                      | Passed                                                                     |
| `npm run db:migrate`                       | Passed, additive migrations applied; final rerun has no pending migrations |
| `npx prisma migrate status`                | Twelve migrations; schema up to date                                       |
| `npm run build`                            | Passed production compilation, TypeScript and route generation             |

Additional coverage includes HMAC rejection/freshness/raw-body limits, concurrent replay, rotation/revocation/disable/archive/creator role loss, workspace/CSRF/anonymous rejection, foreign keys and immutable audit/dedup records, durable webhook-to-real-worker success, real worker GET/POST, credential injection/redaction and tenant rejection, status failures, bounded retries, stable keys, approved PUT retries, timeout ambiguity, concurrent workers, SIGKILL recovery without resending, cancellation, IPv4/IPv6/alternate representations, mixed DNS, rebinding, redirects, response limits, TLS verification, and immutable workflow versions. Existing engine tests still kill and restart the pure worker and execute all seven installed templates.

Browser evidence in ignored `test-results/`:

- `webhook-http-create-a-webh-67591-ge-one-time-signing-secrets-chromium/signed-webhook-setup.png`
- `webhook-http-configure-and-773be-ction-in-the-visual-builder-chromium/http-action-configuration.png`

Screenshots were inspected. Signing secrets are dismissed before screenshot capture. The complete 14-scenario browser JSON report is preserved as `.cache/task5b-all-e2e-results.json` and output as `.cache/task5b-browser.log`; automated output is `.cache/task5b-tests.log`. After a checkbox sizing adjustment, both new scenarios were also rerun successfully in the default-off profile (`npm run test:e2e -- e2e/webhook-http.spec.ts`); the most recent targeted report is `.cache/e2e-results.json` / `playwright-report/`. Counts include Node's parent test records, consistent with previous validation reports.

## Run locally and reproduce

```sh
npm run setup:env
npm ci
npm run integrations:setup:local
# Start the existing local PostgreSQL service if needed:
docker compose up -d --wait db
npm run db:validate
npm run db:migrate
npm run db:seed:templates
npm run db:seed:providers
npm run build
npm start
# Another terminal:
npm run worker
```

Set allowed HTTPS origins only when you have a destination to authorize; empty defaults are intentional. The server and worker need the same origin policy, database, vault keyring, and authentication secret. Restart both after server-only policy/key changes. Retain old vault keys during storage-key rotation, including webhook keys. For full regression tests, stop an ambient worker, explicitly enable the existing loopback local-test adapter with `npm run integrations:setup:local -- --enable-test-adapter`, restart the production server, then run the commands above. Install Chromium with `npm run test:e2e:install` if necessary. Test worker fixtures supply their own isolated origin policy. Restore `--disable-test-adapter` and restart after tests. Do not point these suites at production data.

Final default-off HTTP smoke verification (`npx tsx .cache/integration-default-smoke.ts`) passed after restarting the server: local-test was absent from authenticated provider metadata and local-test connection creation returned 404. A private-value scan of 28 generated client JavaScript artifacts found no vault/issuer key values or test-preload code. No secret values were printed.

Cloud installation/start instructions were saved as a configuration draft. Saving did not apply or publish it; review and save the draft in environment settings, then publish the environment to activate it. This is separate from production application deployment.

## Remaining limitations and operational boundaries

No real Gmail/Sheets OAuth, WhatsApp, OpenAI nodes, Paystack, or public deployment exists. Webhook senders must implement this documented HMAC protocol; provider-specific signature formats are not adapters in this release. Production inbound endpoints require HTTPS, a trusted configured public origin, clock synchronization, ingress request/time/rate controls, and operational retention/monitoring. The current loopback URL is for local development. The per-endpoint rate limit is durable; it is not a global DDoS mitigation layer.

Outbound requests require direct TLS egress to administrator-approved services. This cloud environment has managed egress controls; the native pinned transport does not tunnel through an HTTP proxy that could choose a different destination. Operators must arrange compatible restricted egress before relying on external public destinations. No blocked destination was bypassed, and no arbitrary Internet service was used for verification. An approved public service can itself proxy requests elsewhere; this application's SSRF policy controls its own connection, not the remote service's behavior.

In-flight revocation/cancellation cannot recall an already dispatched request. Worker recovery deliberately stops uncertain external runs rather than providing resumable transactional external effects. An advisory-lock connection is required for each active external run and is incompatible with transaction-only PgBouncer pooling. Use direct/session-mode PostgreSQL connections. Audit lists are bounded, but production retention, archival, pagination, fleet supervision, egress observability, and KMS deployment remain operational follow-up work. Database superusers and application-process compromises remain outside the vault's protection. Tokens/secret values must never be placed in workflow names, labels, literal definitions, or operator logs.
