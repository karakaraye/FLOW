# Task 5E — official Meta WhatsApp Cloud API

Validation date: 29 October 2026. Task 5D was present as local, uncommitted work and was preserved. Task 5E is also local; nothing was committed, pushed, published or deployed. No Task 6 work was started.

| Status                                  | Verdict                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Implementation verification             | **PASS** — TypeScript, lint, formatting, build, schema and migration checks        |
| Controlled mocked-provider verification | **PASS** — 194 automated tests and 22 browser scenarios; all provider calls mocked |
| Live Meta API verification              | **UNVERIFIED — no authorized live recipient or credentialed test**                 |
| Production readiness                    | **NOT READY / NOT CLAIMED**; developer test onboarding only                        |

## Architecture and official API research

The existing PostgreSQL WorkflowRun queue, deterministic executor, external-worker advisory locks, immutable WorkflowVersions, workspace authorization and encrypted credential vault are reused. No new dependencies, second queue, credential store or workflow engine were introduced. The adapter is modular under `src/lib/whatsapp/`; browser UI never receives a Meta token.

Official documentation retrieved on 2026-10-29:

- [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog/): lists **v26.0**, released July 29, 2026. The configured and implemented version is v26.0; unsupported versions fail closed. Old version numbers in historical sample snippets were not treated as the supported release.
- [Platform overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) and [account model](https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts): WhatsApp accounts hold business presence/phone numbers; Messaging accounts hold templates and billing. The account guide explicitly says the existing WABA ID now identifies the Messaging account, with the ID and `waba_id` unchanged; distinct WhatsApp-account IDs are described as a later rollout phase.
- [Managing Messaging accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/): use `messaging_account_id` when token access reaches more than one account on a phone; `paid_messaging_account_id` is the deprecated alias. Every FlowPilot send supplies the verified Messaging account ID explicitly. Phone-number IDs are never used as account/template/billing identifiers. A separate future WhatsApp-account ID is not invented or accepted without a documented verification path.
- [Messages API](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages), [template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview), [webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview), and [endpoint authentication](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint).

Downloaded research snapshots are in ignored `.cache/meta-*.html` (some official endpoints returned Markdown despite the filename). Legacy account docs initially returned an HTTP error; the canonical account-model documentation was retrieved successfully. Research retrieval is not live authenticated API verification.

Only `https://graph.facebook.com/v26.0/` is allowed by the adapter, with fixed numeric-asset paths: debug_token, account, phone_numbers, message_templates and messages. The existing approved-origin policy, public DNS validation, pinned TLS transport, certificate validation, redirect refusal and body/time bounds remain enforced. `appsecret_proof` is supplied for business calls. No unofficial gateway, browser automation or WhatsApp Web sessions exist.

## Connection model and credentials

Operator setup is **default off**, using server-only configuration in `.env.example`: Meta App ID/Secret, webhook verification token, version, stable recipient HMAC key, exact test-asset pairs and approved test recipients. There are no committed real credentials. The UI accepts an access token only in an authenticated OWNER/ADMIN POST; it clears the input after submission and stores the token through the existing tenant-bound AES-GCM IntegrationCredential vault. Platform App Secret and verification token stay in operator environment configuration, like existing platform OAuth secrets.

Before CONNECTED, the adapter checks debug_token validity, explicit expiry metadata, the issuing App ID, granular asset restrictions when returned, both `whatsapp_business_messaging` and `whatsapp_business_management`, token/data-access expiry, account identity and provider-reported membership of the supplied phone in that account's phone_numbers edge. Asset allowlisting is an additional operator restriction. Verification is bounded to the first 100 phone entries and cannot falsely accept an unlisted phone. Verification expiry is capped at 24 hours even for longer-lived system tokens. Rotation/reverification may refresh the same account/phone only; replacing an identity requires a separately reviewed onboarding path. One provider phone identity is globally bound to one workspace, so webhook routing is unambiguous.

Local revocation crypto-erases the stored credential, disables phone/subscriptions and blocks incoming events/actions. Generic vault key rotation remains available through existing integration operations. Remote system-user-token revocation is **not claimed**; the operator must revoke or rotate it in Meta. Revocation/expiry before worker dispatch fails closed.

This is developer-owned account onboarding, not self-service customer authorization. Future Embedded Signup must add verified state/session binding, Meta-hosted customer authorization/code exchange, server-side app/token/asset verification, distinct tenant connection slots, permission/app-review/business-verification checks and a documented account hierarchy migration. Production eligibility or permissions are not assumed. A deleted/retired phone is not automatically transferable to another workspace.

## Models and additive migrations

Eighteen total migrations are applied, preserving the fifteen prior migrations:

1. `20261029020000_whatsapp_business`: WhatsAppConnection, WhatsAppPhone, WhatsAppContact, WhatsAppMessage, WhatsAppAttempt, WhatsAppEvent, WhatsAppStatus, WhatsAppSubscription and WhatsAppEventRun; composite tenant relations, phone/provider-message identities, run-node/attempt/event dedup constraints, bounded states and send ceilings, cross-tenant run/version/event binding triggers and immutable message identity.
2. `20261029021000_whatsapp_audit_and_run_relations`: cascading run relations and extension of the existing closed audit-code allowlist for the three fixed consent decisions. All prior permitted codes are retained.
3. `20261029022000_whatsapp_uncertain_review`: paired reviewedAt/reviewedBy metadata and one fixed audit code for explicit unknown-outcome review. Review does not change UNKNOWN into success or trigger a resend.

Generated using `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, then `npm run db:migrate` and `npx prisma generate`. No database reset or unrelated file/data deletion occurred. The initial Prisma one-to-one uniqueness validation was corrected with an explicit composite unique key before applying migrations.

## Signed incoming events and durable processing

`GET /api/integrations/whatsapp/webhook` validates subscribe mode, a constant-time verification-token match and a bounded numeric challenge. `POST` verifies `X-Hub-Signature-256` as HMAC-SHA256 over the exact raw bytes using the App Secret **before parsing**. The verification token cannot authenticate a POST. Raw input is capped at 64 KiB; events are bounded, structurally checked and limited to provider timestamps within seven days and at most five minutes in the future.

All batch entries must resolve through the verified account ID plus globally bound phone-number ID to an enabled, unexpired connection. Unknown/cross-account/disabled bindings reject the batch atomically. No submitted workspace/workflow ID is used for routing. A per-phone lock deduplicates messages by provider identity and statuses by provider identity/state/timestamp; persisted event rate is capped at 120/minute per phone.

A valid delivery is acknowledged only after PostgreSQL event persistence. The normal worker drains pending events transactionally with SKIP LOCKED; crashes roll back event processing for recovery. Explicit OWNER/ADMIN subscriptions pin a published version, creator, connection and phone. The worker rechecks current membership, connection, workflow state and trigger bindings before creating a normal WorkflowRun; event/workflow uniqueness prevents duplicate runs. The run uses existing encrypted transient input and queue limits. STOP suppression is processed before subsequent queued actions. A run containing WhatsApp inbound data older than 24 hours fails without processing it further.

The trigger `whatsapp_message_received` exposes only from, text, providerMessageId, phoneNumberId and receivedAt to the graph. Profiles, contact names, arbitrary payload fields and downloaded media are not forwarded. Unsupported media is recorded as UNSUPPORTED without claiming extraction or processing. It may open the normal service window as a genuine inbound customer event; no media content is fetched.

## Message nodes, consent and limits

- `whatsapp_send_message`: one authorized connection, one validated international recipient (8–15 digits, no plus), bounded nonempty text up to 4096 characters and optional own-property input-field mappings. Requires a signed inbound event for that recipient on that phone within 24 hours and no suppression.
- `whatsapp_send_template`: fetches fresh provider data, selects the exact template ID/language, requires APPROVED + UTILITY and a supported bounded text-only structure. Only positional BODY parameters, optional static text HEADER/FOOTER and up to ten parameters of 512 characters are supported. Named parameters, media, buttons, authentication and marketing templates are rejected. The provider's template name and structure are preserved; only permitted parameters are supplied.

Every send also requires an exact operator-approved test recipient, enabled assets, current EDITOR-or-higher membership, live workflow state, remaining daily allowance and no unreviewed uncertain send for that phone/recipient. Templates require explicit recorded utility consent even inside the service window. Receiving one message never grants utility/marketing consent. Suppression blocks both node types, including inside an open window. OWNER/ADMIN can record evidence source/timestamp, withdraw consent or suppress recipients; decisions use fixed sanitized audit codes. STOP, UNSUBSCRIBE, CANCEL, END, QUIT and OPT OUT inbound text suppress future messaging; a later ordinary message does not unsuppress. Localized/custom opt-out language remains a documented operational limitation.

Atomic workspace admission caps are zero by default, at most 20 logical messages per UTC day, five per rolling minute and at least six seconds between new messages to the same phone/recipient. Rejections and uncertain attempts count conservatively. There is no array recipient, loop/broadcast or marketing interface. AI cannot grant consent, extend windows, change permissions, select arbitrary assets or bypass these checks.

## External side effects and delivery

A deterministic run/node identity creates one durable WhatsAppMessage. Workspace locks plus unique run/node and per-attempt constraints prevent concurrent duplicate sends. Each external call has a committed IN_FLIGHT attempt before dispatch. Explicit definitive rate-limit rejections can retry at most three times with bounded waits; other definitive errors fail. Network timeout, malformed acceptance, 5xx ambiguity, persistence uncertainty or worker loss never causes an automatic resend. Restart recovery marks unresolved intent UNKNOWN and preserves attempts; original run/node admission remains permanently deduplicated. Meta-side idempotency is not assumed, and `biz_opaque_callback_data` is correlation, **not** provider deduplication.

UNKNOWN blocks new sends to that recipient until an OWNER/ADMIN explicitly records provider review. This records who/when without claiming a remote result or resending. A subsequent signed status receipt can reconcile an unknown attempt using its exact opaque message identity plus trusted phone/account/recipient. There is no invented message lookup API or automatic invoice/delivery reconciliation.

API acceptance stores the provider wamid and state ACCEPTED; it is never reported as recipient delivery. Signed status events retain provider timestamps and append per-message history. Derived state does not regress from READ/DELIVERED on older events, and failed delivery is distinct from API rejection. Unknown provider IDs are UNMATCHED audit events. Failed/revoked connections and missing receipts are not replaced by simulated outcomes. Worker-loss workflow status remains failed even if a later receipt confirms remote delivery.

## Privacy and retention

No full recipient or message body is stored in message/attempt/audit rows. Contacts use a phone-bound keyed HMAC plus last four digits. The separate stable HMAC key must survive App Secret and vault rotations; rotating it requires explicit migration of suppression/consent identities, not silent replacement. Never store that key in frontend configuration.

Selected inbound contents are encrypted for durable processing and cleared after event processing. Status receipts retain only selected original provider fields in encrypted storage for at most 24 hours, plus durable normalized identity/timestamp/status audit metadata; unmatched receipts remain encrypted within that window for audit, without inventing a match. Unprocessed event ciphertext expires after 24 hours. Existing queued run payloads are cleared when processed/cancelled; inbound runs expire at execution after 24 hours. Event metadata is pruned after 30 days; resolved outgoing message/attempt/status metadata after 90 days. UNKNOWN intents remain for review. Minimal consent/suppression hashes persist to prevent unsolicited messaging. Worker operation is required for cleanup. Clearing current ciphertext does not erase backups.

Static text/recipient literals deliberately saved into workflow definitions remain part of immutable workspace configuration; use field mappings and avoid unnecessary personal data. The app is not a customer-service conversation archive. Provider privacy terms, regional law, lawful consent records, data-subject requests, retention/backups, Meta policy changes, webhook/secret rotation and operator access controls need operational review before rollout.

## APIs and dashboard

- `GET /api/workspaces/:workspaceId/whatsapp/overview`: member-authorized sanitized configuration, connections, phones, consent summaries, subscriptions, event/run metadata and message/delivery/attempt history.
- `GET .../whatsapp/templates?connectionId=...`: EDITOR+ provider template discovery; first bounded page only, no arbitrary provider URLs or paging URL forwarding.
- `POST .../whatsapp/connect`: OWNER/ADMIN verified developer asset/token setup or same-identity re-verification.
- `POST .../whatsapp/manage`: OWNER/ADMIN consent decisions, immutable-version subscriptions, disable, local revoke and explicit unknown-outcome review.
- Public Meta webhook GET/POST as above; POST uses provider signature instead of browser session/Origin. Workspace management APIs reuse the existing authenticated API wrapper, exact Origin checks, body limits and safe errors.

Integrations links to `/integrations/whatsapp`. The dashboard distinguishes UNCONFIGURED, controlled MOCK and developer test modes; shows verified account/phone identities, template approval/category/support, actual events and outgoing state, consent/suppression, subscription activation, expiry/revocation guidance and manual uncertainty review. It contains no fake connected/delivery figures. Execution history now includes sanitized WhatsApp attempt/provider-ID/delivery metadata and a link to the audit view. Finished runs require reload for later delivery receipts.

The builder includes all three nodes, trigger replacement, no incoming trigger handle, connection/phone selectors, text/recipient/path fields, approved-template/language/parameter previews, connection-required messaging and shared validation. Publication remains immutable. Four unpublished import examples live in `examples/whatsapp/`; they require replacement identities/provider/budget/consent configuration and are not installed or presented as ready catalog templates.

## Verification results

Final results from actual executed commands:

| Command                                                                                         | Result                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm test`                                                                                      | **194 passed, 0 failed, 0 skipped**, preserving all previous 175; final duration 72,520.645 ms               |
| `node --import tsx --test tests/whatsapp.test.ts`                                               | **19 passed, 0 failed** in targeted verification; all 19 are included again in the final full suite          |
| `npm run test:e2e`                                                                              | **22 passed, 0 failed, 0 skipped, 0 flaky**, preserving all previous 19; final report duration 99,839.288 ms |
| `npm run test:e2e -- e2e/whatsapp.spec.ts`                                                      | **3 passed**, including template consent/configuration and real child-worker execution                       |
| `npm run typecheck`                                                                             | Passed                                                                                                       |
| `npm run lint`                                                                                  | Passed, no warnings                                                                                          |
| `npm run format:check`                                                                          | Passed                                                                                                       |
| `npm run db:validate`                                                                           | Passed                                                                                                       |
| `npm run db:migrate` / `npx prisma migrate status`                                              | All eighteen migrations applied; database up to date                                                         |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Passed; **No difference detected**                                                                           |
| `npm run build`                                                                                 | Passed production compilation, TypeScript and route generation                                               |
| Structural validation of all four `examples/whatsapp/*.json` using the actual engine validator  | Passed; these remain unconfigured/unpublished examples                                                       |
| Final configured-private-value/test-fixture scan of 31 client JavaScript artifacts              | Passed; no matches                                                                                           |
| `git diff --check`                                                                              | Passed                                                                                                       |

The 19 new automated records (including the Node parent record, as in earlier milestone counts) cover invalid credentials, phone/account ownership, granular permission/expiry rejection, RBAC/tenants, challenge/signature checks, duplicate/cross-account events, immutable versions, pending-event recovery, real-worker service replies, racing workers, closed windows, missing consent, provider approval and parameters, duplicate/out-of-order receipts, suppression, definitive and ambiguous failures, bounded retries, SIGKILL recovery/correlated receipts, cross-tenant sends, media rejection, TLS timeout, hashing-key independence and atomic daily limits.

The three browser scenarios cover all nine requested flows: integration discovery/unconfigured state; verified MOCK developer onboarding; incoming-trigger, reply and template builder forms; signed challenge/event delivery; real workers; actual execution history; delivery updates; and viewer/cross-workspace management denial. A mobile overflow assertion also passes. Screenshot review confirmed explicit MOCK labeling, masked recipients and accurate provider-delivery status.

Logs: `.cache/task5e-all-tests.log`, `.cache/task5e-whatsapp-tests.log`, `.cache/task5e-all-browser.log`, `.cache/task5e-whatsapp-browser-final.log`, `.cache/task5e-build.log`, `.cache/task5e-lint.log`, `.cache/task5e-migrations.log`, `.cache/task5e-schema-diff.log`. Browser JSON is preserved in `.cache/task5e-all-e2e-results.json`; current `.cache/e2e-results.json`, ignored `playwright-report/` and `test-results/` contain browser evidence. All Meta/provider behavior in automated tests is mocked; no real messages were sent.

Screenshots under ignored `test-results/`:

- `whatsapp-developer-connect-99e4b-reply-with-delivery-updates-chromium/whatsapp-builder-mock.png`
- The same directory's `whatsapp-worker-history-mock.png` and `whatsapp-delivery-mock.png`.
- `whatsapp-provider-approved-5f784-execute-through-real-worker-chromium/whatsapp-template-mock.png`.

Tests require a running, freshly built app and the historical loopback-only local-test adapter enabled explicitly. No ambient worker runs while suites create their own workers. The application and normal worker are restored afterward with the historical test adapter disabled and no Meta credentials enabled. Controlled fixture apps use port 3003 for Meta, 3002 for AI and 3001 for Google; these stop after testing.

The fixture runs a deterministic OpenAI-independent Meta-shaped TLS service. Only an explicit test-process preload remaps validated `graph.facebook.com` connections to it; it asserts the production transport pinned a public address and preserves SNI/certificate verification. Application code has no mock transport switch. The MOCK label is provenance only. Test certificates are generated temporarily and removed. Fixture phone/token values are non-operational test strings. Real child worker processes exercise durable queue admission, signed event processing, send attempts, racing workers, SIGKILL recovery, timeout and status correlation.

An initial full-suite attempt used the historical local-test adapter disabled and overlapped a build with the running server. It recorded 177 passed / 17 failed; failures came from the required historical fixture being unavailable and a transient server build artifact 500. Evidence is preserved in `.cache/task5e-all-tests-initial-setup-failure.log`; final regression runs use the documented explicit local-test setup and a freshly restarted stable build. An initial browser pass recorded 2 passed / 1 failed due to duplicate fixture template labels; a subsequent full run recorded 21 passed / 1 failed because the consent assertion also matched a hidden option. Both selectors/fixture labels were corrected without weakening assertions; evidence is preserved in `.cache/task5e-whatsapp-browser.log` and `.cache/task5e-browser-initial-selector-failure.log`. The final full browser run passed all 22 with zero retries/flaky results.

Known remaining limitations: no live Meta/Google/OpenAI proof, no Embedded Signup or production eligibility, no marketing/authentication/media templates, first-page discovery only, one controlled primary account/phone binding, local-only revocation, manual unknown-outcome review, limited opt-out vocabulary, no human inbox or broadcasts, and no provider-side exactly-once guarantee. Production needs approved authorization/onboarding, operator/domain/egress validation, real consent governance, managed secrets/rotation, supervised workers, verified Meta app subscriptions/HTTPS callback, provider limits/quality/billing monitoring and security review. Nothing is deployed or published.

## Final verdict and local operation

**PASS for implementation and controlled mocked-provider verification.** Live Meta connectivity is **UNVERIFIED**, as are live Google and OpenAI connectivity. Production readiness is **NOT CLAIMED**. No authorized live recipient or live Meta secret was present; no live message was attempted.

The app runs with `npm start`; run `npm run worker` separately to process persisted events/jobs and retention cleanup. New installations first copy/configure `.env.example`, install dependencies, apply migrations and build using the README. Meta defaults remain disabled, with zero allowed assets/recipients unless the operator configures them. The local test integration adapter was restored to disabled and the application restarted; its HTTP gating smoke test rejects local-test admission and hides that provider. Source remains uncommitted/unpushed for review. Stop at Task 5E; no deployment, publication or Task 6.
