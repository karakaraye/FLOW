# Task 5D — controlled AI automation

Verdict: **PASS for implementation and mocked-provider verification. Live OpenAI connectivity: UNVERIFIED / NOT TESTED.** Verified 29 October 2026 (Africa/Lagos). No dedicated OpenAI key was configured and no live AI testing was authorized. The previous Google live-verification status remains UNVERIFIED. No production deployment, autonomous agents, tool execution, WhatsApp, subscriptions, or subsequent milestone work occurred.

## Architecture

AI code is modular under `src/lib/ai/`: bounded node/schema contracts, operator model registry, prompt preparation/privacy controls, a provider interface/OpenAI adapter, budget/accounting, execution, and authorized application services. It extends the existing schema-version-1 workflow validator, executor registry, shared deterministic generator, PostgreSQL run queue and external worker. There is no second workflow engine or credential store.

The playground submits an isolated AI-only test job through the **same** enqueue function and worker. One hidden `AI_PLAYGROUND` workflow per workspace holds immutable two-node snapshots (manual input plus the selected AI node). It cannot invoke customer workflow actions. Normal workflow list/edit/publish APIs exclude these internal workflows; clients cannot set the server-only admission option. Requests use existing encrypted transient input and idempotency hashes, and appear in actual execution/AI history with a PLAYGROUND source. Repeated identical keys reuse the existing run/version instead of charging another test. A changed request under the same key returns 409.

Two additive migrations are applied; fifteen total migrations are up to date:

- `20261029010000_ai_execution_accounting`: AIWorkspaceBudget, AIUsage, AIBudgetEvent, AI request-status enum, Workflow.internalKind and internal-workflow uniqueness, and run/workspace relationships.
- `20261029011000_ai_accounting_constraints`: nonnegative budget/accounting checks, bounded token fields, allowed provenance/accounting sources, tenant/run binding and immutable request/pricing protection, plus immutable budget/reconciliation audit events. Parent workspace deletion may cascade as in existing audit tables.

The first migration was generated with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` and applied with `npm run db:migrate`. Interactive migrate-dev declined the additive nullable unique-index warning in this noninteractive environment; no reset, destructive workaround, or unrelated data removal was used.

## Provider abstraction and official SDK

`AIProvider.generate(ProviderRequest)` is independent of graph execution and returns structured outcome, actual token usage where available, and bounded correlation metadata. The initial production adapter uses official **openai 7.45.1**, Responses API, non-streaming requests, native strict JSON Schema Structured Outputs, `store:false`, no tools and `tool_choice:none`. **Ajv 8.20.0** performs independent local validation without coercion, defaults, external references or arbitrary extensions.

The SDK has automatic retries disabled. Its fetch implementation permits only POST `https://api.openai.com/v1/responses`, routes through the existing HTTPS/public-DNS/connection-time pinning transport, and still requires administrator origin approval. Redirects, arbitrary API bases, private addresses, dynamic model URLs and credential header overrides remain unavailable. The transport's bounded JSON responses and request timeout/abort apply. SDK error bodies/messages are never forwarded to users or logs.

Authentication uses only the dedicated server-side `FLOWPILOT_OPENAI_API_KEY`; it does not silently use an ambient platform/session `OPENAI_API_KEY`. There is no hardcoded production key or browser key entry. Platform-managed credentials are the initial supported mode. Workspace-managed keys are deferred; a future credential resolver must use the existing workspace-authorized IntegrationCredential vault and may not add another plaintext/key store. Existing vault encryption is reused now for short-lived AI result envelopes, with the distinct `ai-result` purpose/resource context.

Stable run/node/request IDs and deterministic attempt IDs correlate usage with the existing HttpAttempt records. Requests send X-Client-Request-Id per attempt and a stable Idempotency-Key per admitted AI operation; no exactly-once provider billing guarantee is assumed. Safe provider request/response IDs are retained when supplied. A run/node has exactly one AIUsage record even when known rate rejection permits additional HTTP attempts.

## Approved models and pricing

No live model or price is shipped enabled. Operators configure `FLOWPILOT_AI_MODELS_JSON` and `FLOWPILOT_AI_DEFAULT_MODEL` on both server and workers. The registry includes:

- Logical model ID, fixed provider `openai`, actual model identifier.
- Enabled flag and allowed AI-node capabilities.
- Maximum source bytes (100–6000) and output tokens (16–2048).
- Input/output **micro-USD per million tokens**, as integer strings, plus pricing review date.

Only enabled entries supporting the requested operation can dispatch. Users choose approved logical IDs or the administrator default; arbitrary model IDs and URLs cannot bypass runtime checks. The default alias is resolved at execution against current policy; immutable workflow JSON is not rewritten. The actual resolved model and frozen pricing are saved in each usage record.

`config/ai-models.example.json` is a disabled placeholder, not a claim that a model is supported live or a statement of current OpenAI prices. Consult the provider's current Responses/Structured Outputs model documentation and pricing at configuration time. Fill in verified identifiers/capabilities and current rates, set the review date, then enable the entry. Update this operator configuration and restart processes when prices/policy change. Historical records keep their original pricing snapshot. Cached-token discounts are not subtracted; estimates conservatively use the configured full input rate. Model-specific capabilities, minimum token requirements, retention and pricing must be verified by the operator before live use.

## AI node contracts

All nodes require an approved model reference, explicit own-property source text path, maximum output tokens, and optional bounded author instructions. Inputs must be nonempty strings; objects, unsupported paths, excessive bytes, reserved keys and unsafe parameters are rejected before dispatch. Only the selected field is sent. Output is validated JSON for downstream data processing, not engine instructions.

| Node               | Configuration                                                         | Validated output                                                                                        |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ai_classify`      | 2–12 unique allowed categories; optional instructions                 | category in the exact enum, explanation string/null; no confidence field                                |
| `ai_summarize`     | short/medium/long length, optional style/instructions                 | bounded summary string                                                                                  |
| `ai_extract`       | user-defined required strict object schema with field descriptions    | exact validated fields; nullable fields represent missing values                                        |
| `ai_sentiment`     | optional business context/instructions                                | POSITIVE, NEGATIVE, NEUTRAL or MIXED, plus a brief explanation; no confidence probability               |
| `ai_generate_text` | author instructions, source context, tone and length; optional schema | generated text, optionally additional schema-defined content; custom schemas must include required text |

Schemas are bounded to 4 KiB, 40 schema nodes, depth four, 1–12 object properties, all properties required, and additionalProperties:false. Strings require explicit bounds up to 4000 characters; arrays require maxItems up to 20. Nullable scalar/array/object types are supported. Remote references, patterns, custom formats, unsupported keywords and executable expressions are rejected. Output JSON is independently checked for shape, category membership, complexity, reserved keys and an 8 KiB total limit before downstream execution. Invalid/incomplete output is not silently truncated or substituted. No invented calibrated certainty or probability is displayed.

## Prompt injection and privacy boundaries

Requests separate fixed platform instructions in a developer message, explicitly identified workflow-author configuration/operation in a user message, and selected external source text in a separate `untrusted_source` message. Author configuration cannot change the provider endpoint, tools, graph or permission policy. The fixed instruction policy tells the model not to follow embedded external directives, reveal credentials, authorize tools or invent unsupported extracted facts.

This is a behavioral aid, not a proof that prompt injection or hallucination is prevented. Permission checks, static graph definitions, tool absence, allowlisted endpoints, native/local output schemas and credential boundaries hold **independently of model obedience**. Generated content cannot modify workflow definitions, publish versions, fetch credentials or authorize actions. Any downstream HTTP/Gmail/Sheets action still requires an explicitly authored/published graph and the original server-side policies.

Basic minimization/redaction covers the explicitly selected source field, known platform key, common key/token/password/authorization patterns, bearer strings, OpenAI-style keys, common Google access-token prefixes, email addresses and international phone-like numbers. Output strings are also redacted and revalidated. Sensitive text in schema configuration is rejected. This is not a complete DLP/PII or secret-detection system: arbitrary secrets, domestic phone numbers and personal information can evade heuristics. Do not supply credentials, OAuth tokens, private documents without permission, or unnecessary personal data. The AI layer never reads integration credentials for use in prompts.

Routine execution and usage audits exclude prompts and raw generated content. Selected source input uses the existing encrypted queued payload and is cleared on terminal completion. Author instructions and schema configuration remain in workspace-owned immutable definitions, just like other literal workflow configuration; users must not place secrets in them. `store:false` requests reduced provider-side storage but is not a contractual no-retention guarantee; provider settings/agreements and applicable data rules still require review.

Successful raw results are encrypted with the existing vault for **ten minutes** to support actual playground/history inspection. Only the requesting member retaining OWNER/ADMIN/EDITOR access can retrieve them; viewers and other workspace members receive sanitized metadata. Read-time expiry is enforced even if cleanup is delayed. Workers purge expired ciphertext periodically. Clearing a row is not erasure of backups/WAL; managed key/backup retention remains an operational requirement. React renders result JSON as escaped text, never HTML or executable code.

## Usage and cost accounting

AIUsage records bind workspace, workflow run, node, requester, WORKFLOW/PLAYGROUND source, provider, LIVE/MOCK provenance, logical/actual model, request status, input/output/total tokens, cached input count, pricing, reserved/accounted/estimated cost, correlation IDs, errors and timestamps. Request binding/pricing are immutable. Token fields remain null when the provider did not report valid usage; they are not invented zeros.

Cost calculations use integer micro-USD and round up at the request level:

`ceil((inputTokens × inputRateMicroUSDPerMillion + outputTokens × outputRateMicroUSDPerMillion) / 1,000,000)`

Reported token counts are actual provider-response metadata, not model-generated JSON fields. The monetary amount is still an **estimate based on configured rates**, not the provider invoice or an actual USD amount reported by OpenAI. Provider charges and customer subscription charges are separate; no customer billing/subscription deduction was implemented.

Before dispatch, the system reserves a conservative byte-based input-token upper bound (prepared input/schema bytes plus a 1024-token envelope allowance) and the requested maximum output. This is deliberately not a precise tokenizer estimate. Valid reported usage settles the reservation to its estimated cost, including refusals, malformed model JSON and output-limit exhaustion. Definitive authentication/request/rate rejection without usage releases the reservation with a NO_USAGE label; monetary invoice verification remains separate.

Timeouts, disconnects, missing/malformed usage, SDK outages or worker loss retain the full reservation as UNKNOWN. They are not automatically refunded or resent. If a request's reported token cost exceeds the conservative reservation, the recorded actual-token estimate can exceed that reservation and future admissions are blocked by the resulting accounted spend. Conservative bounds and administrator pricing reduce risk but are not a contractual cap on the provider's final invoice. Production also needs provider account/project spend controls, alerts and pricing review.

## Budget and rate enforcement

Workspace daily/monthly budgets default to **zero**. OWNER/ADMIN may set them within operator ceilings. Default platform ceilings are $1/day and $5/month per workspace; configure `FLOWPILOT_AI_MAX_DAILY_MICROS` / `FLOWPILOT_AI_MAX_MONTHLY_MICROS` to change them. These are budget policy defaults, not hardcoded model prices. Amounts use exact integer micro-USD strings.

A transaction and per-workspace PostgreSQL advisory lock serialize reservations, read current accounted/reserved totals, enforce both limits and create the unique run/node usage record before any model request. Concurrent jobs cannot reserve the same remaining allowance independently. Daily/monthly windows are UTC and attached at admission. Accounted totals include completed estimated spend, active reservations and unresolved unknown requests. Lowering a limit blocks further admissions; it does not undo an in-flight provider request. The system also admits at most 20 AI operations per minute per workspace, persisted in usage records. Playground requests share all limits.

Known 429 rejections permit at most three attempts with bounded 100/200 ms exponential backoff. SDK hidden retries are disabled. Authentication, context/request errors, refusals and malformed results do not loop. Network/5xx/timeout outcomes are uncertain and never automatically retried. External worker exclusion and unique run/node accounting prevent duplicate admission; they do not guarantee exactly-once provider charges.

On worker restart, the existing RUNNING-external-run recovery marks pending AI usage UNKNOWN while preserving held amounts and never repeats the provider call. OWNER/ADMIN can reconcile an UNKNOWN record after reviewing the provider dashboard. The API supports an acknowledged no-charge result or bounded reviewed token counts. A reconciliation is labeled MANUAL, keeps original provider token fields unchanged, and creates an immutable audit event. The UI offers the explicit confirmed no-charge path; reviewed-token reconciliation is available through the authenticated API. This is an accounting correction, not a refund or a claim that customer-entered counts were provider-reported.

## APIs and permissions

All paths below begin `/api/workspaces/:workspaceId/ai`; existing Better Auth sessions and exact-Origin CSRF checks apply to mutations.

| Method | Path                                                   | Access                                                                                          |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET    | `/overview`, `/status`, `/models`, `/budget`, `/usage` | All current workspace members; sanitized metadata only                                          |
| POST   | `/validate`                                            | OWNER/ADMIN/EDITOR; bounded node/input validation and maximum estimate                          |
| POST   | `/playground`                                          | OWNER/ADMIN/EDITOR; required Idempotency-Key, one AI-only queued job                            |
| GET    | `/requests/:runId`                                     | Current workspace members; raw retained results only for the requesting member with edit access |
| PATCH  | `/budget`                                              | OWNER/ADMIN; expected revision and daily/monthly micro-USD strings                              |
| POST   | `/usage/:usageId/reconcile`                            | OWNER/ADMIN; current revision, reviewed resolution and explicit dashboard acknowledgement       |

Viewer access is read-only. Nonmembers/cross-workspace references are denied server-side. Every execution rechecks current membership, workflow availability and cancellation. Provider/model policy and the budget are enforced before dispatch, not trusted from browser configuration. Published versions stay immutable. No API accepts a trusted role, raw provider URL, system/developer prompt override, workspace API key, tool definition or executable AI code.

## Builder and playground UI

All five nodes have a distinct AI icon/color, name, source/model summary, structural configuration status, normal output handles and validation feedback. A scrollable responsive palette keeps the larger node set usable. Panels select approved models, source paths, instructions, category/length/style/context/tone settings, strict schemas and bounded output tokens. Runtime provider/model/budget requirements are labeled separately from static graph validity. Existing layout, undo/redo, edge validation, immutable snapshots and histories still apply.

`/ai` adds authenticated provider status, zero-by-default budget configuration, a single-node playground, actual result/usage display and a sanitized usage audit. Unconfigured providers do not fabricate responses. Mock sessions show an explicit MOCK label and mock content; a live configuration is described as configured, not health-verified. The playground is durable after browser closure and repeated keys do not enqueue another paid test. Execution history adds an explicit authorized load action for AI accounting and still-retained results, keeping ordinary node audits shape-only.

## Configuration and local operation

1. Run the existing local setup, migrations and provider seeding. `npm run integrations:setup:local` prepares dedicated encryption keys without printing values.
2. Set the server/worker-only `FLOWPILOT_OPENAI_API_KEY`. Do not set NEXT_PUBLIC_ keys or paste secrets into the builder. No key was configured for this task.
3. Use `config/ai-models.example.json` as a disabled template. Supply current approved Responses/Structured Outputs model IDs, capabilities, limits and pricing in `FLOWPILOT_AI_MODELS_JSON`; choose the logical default in `FLOWPILOT_AI_DEFAULT_MODEL`. No model is enabled by default.
4. Add exact `https://api.openai.com` to `HTTP_ACTION_ALLOWED_ORIGINS`. The fixed provider endpoint does not bypass the existing approved-origin or connection-time SSRF policy. Compatible native TLS egress is required; there is no unsafe proxy/private-network fallback.
5. Restart the application and workers with identical provider/model/vault/budget policy. As OWNER/ADMIN, configure nonzero workspace limits in AI workspace. Use the playground knowingly; real requests can incur provider charges.
6. Normal local commands remain `npm run build`, `npm start`, and `npm run worker` in another terminal. Do not run an ambient worker while integration suites create their own workers.

Workspace-managed keys remain future work and must reuse the existing vault with tenant binding. There is no OpenAI connection falsely marked CONNECTED in the integration catalog. No autonomous agent/tool, WhatsApp, billing or production deployment was added.

## Automated and real-worker verification

| Exact command                                       | Actual result                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm install --save-exact openai@latest ajv@latest` | Installed pinned OpenAI 7.45.1 and Ajv 8.20.0                                 |
| `npm test`                                          | **175 passed, 0 failed, 0 skipped**, preserving all prior 159                 |
| `node --import tsx --test tests/ai.test.ts`         | **16 passed, 0 failed**, also rerun after explicit operation-channel labeling |
| `npm run typecheck`                                 | Passed                                                                        |
| `npm run lint`                                      | Passed without warnings                                                       |
| `npm run format:check`                              | Passed                                                                        |
| `npm run db:validate`                               | Passed                                                                        |
| `npm run db:migrate` / `npx prisma migrate status`  | Fifteen migrations; database up to date                                       |
| `npm run build`                                     | Passed production compilation, TypeScript and route generation                |

Tests cover all five contracts, strict JSON schemas/nullable fields/enums, unsafe model/input/schema rejection, prompt-channel/data-minimization boundaries, secret redaction, tool/output-boundary rejection, actual mock token accounting, three bounded rate retries with one usage record, refusal/malformed/category/token-exhaustion handling, auth rejection, uncertain outage retention, concurrency-safe budget exhaustion, duplicate request prevention, workspace/viewer restrictions, immutable versions/pricing/audit, playground idempotency/internal workflow protection, SIGKILL recovery without another call, reviewed reconciliation, TLS timeout, missing usage, result expiry, and durable workspace request limits.

The deterministic unit mock implements AIProvider. Worker/browser integration uses the **official SDK adapter** against a deterministic isolated OpenAI-shaped TLS service, selected only by explicit test-process preloads. The preload asserts that the native socket lookup receives the validated public address, reroutes only that fixture to loopback, and preserves TLS hostname/certificate verification. There is no production mock-provider switch or canned-output fallback. An additional loopback/fake-key test label marks provenance MOCK; it does not substitute responses. Every fixture certificate/key is generated in a temporary directory and removed.

A real separate worker executes a chain of all five AI nodes, and racing workers produce one set of calls/usage records. Another test kills a worker after the mock provider receives the request, then restarts the worker and verifies UNKNOWN accounting plus no duplicate call. These verify actual PostgreSQL queue/worker behavior with a mocked provider, not live model behavior or model quality.

## Browser verification

`npm run test:e2e`: **19 passed, 0 failed, 0 skipped, 0 flaky**, preserving all prior 16 scenarios. The three new scenarios cover:

- Main application explicitly unconfigured, no fake output, viewer read-only controls and cross-workspace API denial.
- A controlled app on port 3002 with an explicit MOCK provider label, budget settings, queued single-node test, actual mock-service output/token/cost metadata, and same-key deduplication.
- All five configuration panels, strict schema settings, immutable publication, a full real-worker AI workflow, authorized retained results, sanitized history, and a mobile overflow check.

Evidence in ignored `test-results/`:

- `ai-controlled-AI-playgroun-1757c-ck-adapter-output-and-usage-chromium/ai-playground-mock.png`
- `ai-all-five-AI-panels-publ-52942-rker-with-sanitized-history-chromium/ai-builder-mock.png`
- `ai-all-five-AI-panels-publ-52942-rker-with-sanitized-history-chromium/ai-worker-history-mock.png`

Logs: `.cache/task5d-tests.log`, `.cache/task5d-ai-final.log`, `.cache/task5d-browser.log`. Full 19-scenario JSON evidence is preserved in `.cache/task5d-all-e2e-results.json`. After correcting replay status to reload the persisted job, `npm run test:e2e -- e2e/ai.spec.ts` passed all three AI scenarios again; log: `.cache/task5d-ai-browser-final.log`, latest JSON: `.cache/e2e-results.json`, HTML: ignored `playwright-report/`. Screenshot review confirms SUCCEEDED with the retained result after same-key retry. Counts include Node's parent test records, consistent with earlier reports. Full suites need the historical loopback local-test adapter enabled explicitly and the server restarted; restore its default-off setting after verification. The AI fixture app requires port 3002; the existing Google fixture uses 3001. No live credentials are needed for automated tests, and fixtures never contact public OpenAI or send real email.

## Live verification and known limitations

**Live OpenAI Responses connectivity, model compatibility, model quality, actual invoice charges and live latency are UNVERIFIED.** The dedicated key is absent and live testing was not explicitly authorized. No paid live test was attempted. Passing deterministic mocks is not evidence of a successful live AI call. Live Google verification remains unchanged and does not block this implementation.

Operational/model limits include administrator-supplied model/pricing configuration, platform credentials only, text-only selected inputs, bounded strict-schema subset, basic heuristic redaction rather than complete DLP, no probability calibration, no automatic uncertain-cost reconciliation, ten-minute result retention, and no provider-invoice/customer-billing integration. Provider refusals, hallucinations, semantic errors and prompt injection can still occur; schemas and permission boundaries do not make generated facts trustworthy. Review consequential downstream workflows and provider privacy/data-residency terms.

Per-workspace budgets are not a global platform/provider spending cap or a production abuse-detection system. A platform rollout needs trusted workspace allocation, provider project budgets/alerts, pricing freshness controls, fleet supervision, compatible session-mode database/egress, retention/backup/KMS policy, and audit/usage pagination. Reconciliation is manual and labeled; it cannot prove an invoice charge or reverse a remote generation. Unknown requests retain reservations until reviewed. Current-row ciphertext clearing does not erase backups. No claim of production readiness, deployment or another milestone is made.

## Final environment checks

After the final UI change, TypeScript, lint, formatting and production build passed again (`.cache/task5d-build-final.log` contains the build output). A private-value scan of all 29 client JavaScript artifacts found no configured server secrets or AI fixture values. `git diff --check` passed. The application was restarted with the local test integration adapter disabled; `npx tsx .cache/integration-default-smoke.ts` confirmed it is hidden and admission is rejected with 404. The normal worker was restarted only after the browser suites finished. AI remains unconfigured by default; no dedicated live key is present. Task 5D changes remain local and have not been committed, pushed or deployed.
