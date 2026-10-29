# Task 6A — Paystack TEST subscriptions and central usage limits

Date: 29 October 2026. Implementation is confined to the existing FLOW repository. The uncommitted Task 5D/5E work and eighteen prior migrations were preserved. Nothing was committed, pushed, published or deployed. No Task 6B work occurred.

| Verification category                      | Status                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Implementation / quality checks            | **PASS** — TypeScript, lint, formatting, build, Prisma and migration/schema checks                     |
| Controlled simulated Paystack verification | **PASS** — 218 automated tests and 25 browser scenarios; all payment behavior uses controlled fixtures |
| Actual Paystack test-mode API calls        | **UNVERIFIED / NOT ATTEMPTED** — no dedicated Paystack test key configured                             |
| Live Paystack / real-money billing         | **DISABLED / NOT ATTEMPTED**; `sk_live_*` is refused                                                   |
| Production readiness                       | **NOT CLAIMED**                                                                                        |

## Architecture and existing models

The implementation extends the existing SubscriptionPlan and Subscription entities, authentication/RBAC, encrypted vault primitives, PostgreSQL-backed worker and existing AI/message safeguards. No new dependency, queue service or payment/card form was introduced. `src/lib/billing/` separates catalog policy, entitlements/accounting, the fixed-origin Paystack client, billing services and durable event/reconciliation processing.

SubscriptionPlan remains the tier identity. The legacy `monthlyPriceCents` integer field is retained; new NGN values are minor units (kobo), despite the historical name. Existing legacy plans/subscriptions remain untouched and do not automatically become verified paid subscriptions. The current server catalog supplies new checkout proposals, while immutable checkout snapshots preserve actual selected amount/currency/interval/provider mapping. Existing subscribers retain their verified charge snapshot; operator catalog changes do not invoke Paystack's update-existing-subscriptions behavior.

Subscription now records the TEST provider binding, customer/plan identity, interval and amount snapshot, verified paid-through/paid-at timestamps, cancellation intent, reconciliation time, encrypted cancellation token and revision. BillingCheckout durably records one initialization intent/reference, idempotency hash, email binding hash, selected price, optional encrypted checkout URL and one recurring-subscription creation intent/code. BillingPayment stores append-only independently verified payment facts, including payments whose subscription setup remains uncertain. Its composite foreign key binds to the immutable originating checkout/workspace, so replacing the current subscription preserves historical payments. BillingAudit is append-only. BillingEvent stores authenticated event identity and selected routing metadata; QuotaEntry and ExecutionLease provide durable metering and claims.

Seven new additive migrations are applied, twenty-five total:

- `20261029030000_paystack_and_entitlements`: billing/ledger/lease tables and existing subscription extensions.
- `20261029031000_billing_subscription_intent`: recurring-subscription attempt/code ownership.
- `20261029032000_billing_event_recovery`: retry state and due time.
- `20261029033000_billing_security_and_backfill`: financial bounds, immutable audit/payment/checkout/ledger identities, tenant lease checks and historical usage backfill.
- `20261029034000_billing_history_binding`: historical checkout/subscription identity binding.
- `20261029035000_execution_lease_release`: explicit worker release plus a bounded crash hold.
- `20261029036000_verified_payment_history`: independently verified payment facts bound to checkout/workspace, including uncertain subscription setup.

No old migration was edited, no database reset occurred, and no unrelated records were deleted. Successive migrations refine only this new, unpublished billing schema; the final required payment checkout binding was applied before any non-fixture billing data existed. Existing execution, AI and durable message-attempt usage is backfilled into the ledger rather than granting a free reset when quotas are introduced. Source rows/history remain intact. PostgreSQL's canonical spelling for the 90-second interval default is represented in Prisma to avoid a false schema diff.

## Official Paystack documentation

Official pages inspected on 2026-10-29:

- [Subscriptions](https://paystack.com/docs/payments/subscriptions/)
- [Webhook authentication and delivery](https://paystack.com/docs/payments/webhooks/)
- [Verify payments](https://paystack.com/docs/payments/verify-payments/)
- [Transactions API](https://paystack.com/docs/api/transaction/)
- [Subscription API](https://paystack.com/docs/api/subscription/)
- [Plan API](https://paystack.com/docs/api/plan/)

Initial urllib requests received HTTP errors; ordinary curl GET requests successfully retrieved all six pages through the configured session network path. Research snapshots are in ignored `.cache/paystack-*.html` and extracted `.txt` files. Retrieval is documentation research, not credentialed API verification.

The documentation confirms integer minor units, separate monthly/annually intervals, test-domain responses, server-side transaction verification, HMAC-SHA512 `x-paystack-signature`, subscription statuses, invoice/charge/cancellation events and the warning that failed subscription charges are not automatically retried. Merchant-generated references use documented alphanumeric/hyphen characters. Opaque historical/provider references also accept bounded dots/equalities/underscores without allowing URL traversal or arbitrary paths.

The client uses only approved `https://api.paystack.co` endpoints: plan fetch, transaction initialize/verify/fetch, subscription create/fetch and disable. It reuses the existing approved-origin, public-address DNS validation, connection-time pinning, TLS/certificate verification, redirect refusal, bounded JSON transport and timeouts. No arbitrary provider URL, live-key fallback or hidden financial-operation retry exists. Checkout redirects are restricted to `https://checkout.paystack.com/<bounded-code>` without query/fragment/userinfo. Platform keys stay server-only.

## Plan catalog and entitlements

`src/lib/billing/config.ts` is the single commercial policy source. `.env.example` and `config/billing-plans.example.json` document the full optional `FLOWPILOT_BILLING_CATALOG_JSON` override. The catalog validates all four tiers, NGN integer amounts, optional annual amounts and bounded integer resource limits. Customers cannot edit catalog policy or Paystack mappings through workspace APIs.

Default monthly **proposals**, not immutable commercial promises:

| Tier     | NGN / month | Stored kobo | Active workflows | Monthly executions | Monthly AI USD-micro allowance | Integration slots | Monthly outgoing admissions | Worker concurrency |
| -------- | ----------: | ----------: | ---------------: | -----------------: | -----------------------------: | ----------------: | --------------------------: | -----------------: |
| FREE     |           0 |           0 |              100 |              1,000 |                      5,000,000 |               100 |                         100 |                  2 |
| STARTER  |       5,000 |     500,000 |              200 |             10,000 |                     20,000,000 |               100 |                       1,000 |                  4 |
| BUSINESS |      15,000 |   1,500,000 |              500 |            100,000 |                    100,000,000 |               100 |                      10,000 |                  8 |
| PRO      |      35,000 |   3,500,000 |            1,000 |            500,000 |                    250,000,000 |               100 |                     100,000 |                 16 |

These generous starting resource proposals need commercial/cost review before launch. Annual amounts are **null/unavailable by default**, not inferred or discounted. An operator can configure an explicit annual amount and a distinct TEST Paystack plan code. A fixture tests an explicitly supplied annual price of twelve monthly payments; that is test configuration, not a published annual offer.

`PAYSTACK_TEST_PLAN_CODES_JSON` maps tier/interval to operator-created Paystack TEST plans. A fresh provider plan must match amount, currency, interval and test domain before checkout and again before recurring setup. Changing prices requires deliberate catalog configuration and appropriate new provider plan mappings; this implementation does not update provider plans or silently reprice existing subscriptions.

Subscription fees and provider expenses are separate. NGN subscriptions do not settle or promise reimbursement of OpenAI/WhatsApp/Google bills. AI plan metering is a USD-micro estimated-provider-spend ceiling; the existing per-workspace daily/monthly AI budgets, model limits and uncertain-cost reservations still apply independently. WhatsApp consent/windows/test-recipient allowlists and daily/rate limits, Gmail recipient/operator limits and other external provider restrictions remain in force. A paid plan cannot bypass them. Provider bills remain the operator/authorized account holder's responsibility; this milestone adds no wallet, FX conversion, invoiced provider-cost pass-through or platform-wide provider spending guarantee.

## Checkout and verified state machine

1. Only OWNER/ADMIN can request a checkout. They supply a logical tier and interval plus an idempotency key; extra fields such as a browser amount are rejected. The server verifies the mapped TEST plan, locks the workspace and snapshots a unique checkout reference before initialization. Repeated keys reuse the intent; different keys for the same unresolved choice reuse its pending checkout. A conflicting unresolved choice is rejected.
2. Paystack hosts the card form. Initialization is a one-off card TEST transaction at the server price. No card details are collected or stored by FlowPilot. The callback only displays a verification-pending notice; query parameters cannot grant a plan.
3. A signed event, explicit management reconciliation or the worker's periodic pass verifies the exact reference with Paystack: test domain, success status, exact amount/currency, transaction identity, expected customer/email binding and paid timestamp. A verified payment is recorded independently even if recurring setup is not yet complete. Failed/unverified payments grant no paid access.
4. The server rechecks the remote plan and durably claims **one** subscription creation intent. Using the verified transaction's reusable authorization transiently in memory, it creates a subscription for the verified customer and chosen plan, with its first renewal scheduled at the end of the already paid month/year. This explicit returned code binds the subscription to this checkout/workspace. It does not guess ownership by customer email plus plan, which would be ambiguous when one customer pays for several workspaces.
5. Fetching that exact subscription must independently verify test domain, code, customer, plan, interval and price. Only then is the paid subscription activated. The initial paid period uses calendar arithmetic with month-end/leap-year clamping. An already expired initial paid period goes to explicit review; it never schedules an unintended past-due recurring charge. Used checkout URLs are cleared after activation.

INITIALIZING → OPEN → PAID_PENDING_SUBSCRIPTION → ACTIVE is the normal checkout path. UNKNOWN and PAID_REQUIRES_REVIEW are explicit attention states. A timeout/uncertain initialize or recurring-create response is not blindly repeated. A known subscription code can be reconciled after interruption; an attempted create with no known code requires operator investigation in Paystack. The system does not guess a code, issue another subscription, manufacture a refund or assume no charge occurred. The verified initial payment remains visible in history even when entitlements remain FREE.

Only one unresolved checkout is admitted per workspace. No overlapping paid checkout is admitted during a verified paid period. Unexpected overlapping payments remain review items, not automatic extra entitlement. Workspace-owner requests cannot assign another workspace's reference/subscription.

## Renewal, cancellation, expiry and plan changes

The worker or an OWNER/ADMIN can reconcile the latest provider subscription. A renewal extends paid-through time only when a provider-returned paid/success invoice has a coherent bounded billing period **and** its transaction is independently verified for test domain, amount, currency and the bound customer. Payment/reference identity is unique; duplicate events and retries do not extend time twice. Older receipts cannot regress paid-through time. Missing/delayed events can be recovered from the subscription's returned invoice/current-state data; reconciliation is bounded to the latest twenty returned invoice entries and the existing transport size limit.

`invoice.payment_failed` nudges reconciliation; current provider facts determine PAST_DUE rather than trusting stale event order. No custom charging/retry loop exists. Already verified paid time remains usable. There is **zero unpaid grace**: at paid-through expiry, effective entitlements fall back to FREE even if a provider status still says active. History and workflow definitions are preserved.

Cancellation records local intent, calls the official disable endpoint with the encrypted cancellation token, then verifies current provider status. Unconfirmed cancellation is explicitly displayed; renewal may still happen until provider confirmation. Confirmed non-renewing/cancelled/completed state becomes local CANCELED while verified paid access remains through its end date. Retrying an explicit cancellation can reconcile/disable; it never initializes another charge.

FREE → paid activates after verification. Paid-tier changes are deliberately **period-boundary only**: confirm cancellation, retain existing paid time, then create the next tier/interval checkout after expiry. FREE downgrade is cancellation plus expiry. No mid-period proration, credits, automatic scheduled re-purchase or inferred annual discounts exist. Current calendar-month usage is retained across all changes; there is no upgrade/reset loophole. This restriction is visible in the UI and tested for both higher-tier activation and fallback to FREE.

## Webhook authentication, idempotency and recovery

`POST /api/billing/paystack/webhook` accepts at most 64 KiB and verifies HMAC-SHA512 against the exact raw bytes, comparing decoded equal-length digests in constant time before parsing. The test-only key guard applies here too. Browser redirects, IP headers and supplied workspace metadata cannot substitute for authentication.

Authenticated canonical JSON hashing supplies a durable event identity because these event envelopes do not supply a universal delivery ID. Only selected routing metadata/reference/subscription code is stored; raw payload/card authorization objects are not persisted. Supported object events are charge.success, subscription.create, invoice.update, invoice.payment_failed, subscription.not_renew and subscription.disable. Unsupported object events are recorded as IGNORED; unsupported array-shaped administrative events are outside this implementation and are rejected rather than stored with card metadata.

Accepted events commit before HTTP acknowledgment. The existing worker claims PENDING/RUNNING billing events using a PostgreSQL session advisory lock. Reconciliation is idempotent under duplicate/out-of-order delivery; immutable unique payments and durable financial intents prevent duplicate effects. Transient failures have durable next-attempt timestamps and bounded exponential retries (eight attempts, then NEEDS_REVIEW). A worker restart can reclaim a prior RUNNING event; it does not repeat an uncertain create. Unknown references/codes become UNMATCHED without selecting a tenant from request data.

A periodic worker pass also checks stale unresolved checkouts and subscriptions without needing a webhook/browser. Its due timestamps are in PostgreSQL; the in-process minute throttle is not the durable record. The initial local implementation processes one due record per minute with a five-minute staleness threshold; fleet throughput, pagination and operational reconciliation tooling need expansion before production.

## Atomic quota and execution enforcement

All commercial limits use centralized helpers and a per-workspace PostgreSQL transaction advisory lock:

- Enabled, unarchived normal workflow creation/activation and template installation check active-workflow capacity. Internal single-workspace AI playgrounds are excluded from that resource count, but their executions and AI spend are metered.
- Manual runs, authenticated FlowPilot webhook admission and Meta-triggered runs consume one monthly execution entry only on successful admission. Existing idempotent runs return before another debit. If a Meta-trigger subscription is over quota, its event records PLAN_QUOTA_EXCEEDED and skips that admission, avoiding a quota-blocked event permanently starving other worker jobs.
- AI reservation first retains all existing model/operator budget checks, then atomically reserves plan spend. Known actual settlement or definitive no-usage rejection adjusts the original ledger entry transactionally. UNKNOWN keeps its reservation; reviewed manual reconciliation updates the same entry and audit. Unknown usage is not silently refunded.
- Integration metadata creation reserves a slot, including disconnected/pending records. Reverification through the shared credential service also checks resource capacity. Reserved slots are counted conservatively instead of allowing unlimited pre-created connections to activate after downgrade. Existing provider/tenant restrictions remain.
- WhatsApp send admission and Gmail send admission share one logical message metric keyed by run/node. Provider retries never debit another message. Failed and uncertain admissions count conservatively; reading Sheets is not a message.
- Workers atomically acquire an ExecutionLease before changing QUEUED to RUNNING. Counts use unexpired, unreleased leases rather than trusting run status alone: cancelling a run cannot free its slot while an external request remains in flight. Pure DB work serializes under the quota transaction and releases before commit. External work releases only on completion; a lost worker leaves at most a 90-second recovery hold, longer than the existing bounded execution deadline. The existing per-run advisory lock and uncertain-effect recovery remain in force. An explicit one-shot external worker may wait up to ten 100 ms intervals for a finishing slot; otherwise the job stays durably QUEUED without extra quota consumption.

Periods are UTC calendar months, independent of monthly/annual subscription anchors. Jobs/AI reservations are assigned their admission month; late settlement adjusts that original entry. A period change never recharges an old retry. Successful/failed/cancelled jobs retain their original execution debit. Deleting a workflow/run does not erase ledger debits; workspace deletion follows existing parent-cascade semantics. A downgrade does not delete excess resources; new admissions/activations are blocked until usage/resources fit the effective plan. Already admitted jobs may execute under the current concurrency cap; later AI/message effects still require current quota and provider policy.

There is no in-memory-only usage counter. The existing structural safety cap on stored workflow records is 2,000 so the configurable PRO active allowance can be represented; node, input, queue, execution-time, vault, SSRF and provider safety limits are preserved.

## Dashboard, APIs and permissions

`/billing`, linked from the existing sidebar, shows four plan proposals, explicit monthly/annual availability, effective plan, recorded payment/subscription state, cancellation confirmation, paid-through/renewal information, real ledger/resource usage and remaining allowances, checkout/payment history and sanitized audits. It distinguishes UNCONFIGURED, controlled MOCK and actual PAYSTACK TEST configuration. It does not show mock results as actual Paystack verification. Callback notices explicitly say they are not proof of payment.

All workspace members may read sanitized plan/usage/payment metadata. Only OWNER/ADMIN may initialize a checkout, reconcile or cancel. EDITOR does not gain billing management. Existing authenticated API wrappers enforce session, exact Origin on writes, JSON limits and fixed safe errors; workspace ownership is checked server-side. Keys, reusable authorization codes, cancellation tokens, encrypted URLs and payer email hashes are not returned in overview/history. Only an authorized checkout response returns its intended hosted checkout URL.

Endpoints:

- GET `/api/workspaces/:workspaceId/billing/overview`
- POST `.../billing/checkout` with plan/interval and Idempotency-Key
- POST `.../billing/reconcile` with an optional owned checkoutId
- POST `.../billing/cancel` with current revision
- POST `/api/billing/paystack/webhook` with raw-body provider signature

## Verification evidence

Actual final verification results:

| Exact command / check                                                                           | Result                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                      | **218 passed, 0 failed, 0 skipped**, preserving all previous 194; final duration 67,837.419 ms                      |
| `node --import tsx --test tests/whatsapp.test.ts tests/billing.test.ts`                         | **43 passed, 0 failed**: 24 billing records plus the prior 19 WhatsApp records                                      |
| `npm run test:e2e`                                                                              | **25 passed, 0 failed, 0 skipped, 0 flaky**, preserving all previous 22; report duration 98,538.173 ms              |
| `npm run test:e2e -- e2e/billing.spec.ts`                                                       | Three billing browser scenarios passed; repeated after the final checkbox layout correction                         |
| `npm run typecheck`                                                                             | Passed                                                                                                              |
| `npm run lint`                                                                                  | Passed without warnings                                                                                             |
| `npm run format:check`                                                                          | Passed                                                                                                              |
| `npm run build`                                                                                 | Passed production compilation, TypeScript and route generation; repeated after the final checkbox layout correction |
| `npm run db:validate`                                                                           | Passed                                                                                                              |
| `npm run db:migrate` / `npx prisma migrate status`                                              | Twenty-five migrations applied; database up to date                                                                 |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | Passed: **No difference detected**                                                                                  |
| Configured-secret and fixture-value scan of 32 client JavaScript artifacts                      | Passed; no matches                                                                                                  |
| `git diff --check`                                                                              | Passed                                                                                                              |
| `npx tsx .cache/integration-default-smoke.ts` after restoring default-off/restarting            | Passed: historical local-test provider hidden and admission rejected                                                |

Counts include Node parent test records, consistent with previous milestones. No test, skip or flaky result is represented as passing.

Billing automation covers catalog/minor units/annual policy and live-key rejection; checkout initialization and concurrent duplicate requests; remote price validation; unpaid redirect/event rejection; exact transaction/currency/customer/domain proof; real-worker activation; canonical duplicate/out-of-order events; tenant and RBAC isolation; independently verified renewals and missing-event reconciliation; failures/cancellation/expiry; period-boundary tier changes; explicit annual pricing; unknown initialization/creation without retries; expired-payment and changed-plan rejection before recurring creation; concurrent workflow/admission/activation/integration/AI/message quotas; actual AI settlement; Gmail/WhatsApp dispatch denial; lease caps/recovery/tenant constraints; and immutable snapshots/audits/payment history.

Browser scenarios cover unconfigured and readonly/foreign management, hosted-checkout URL creation, rejection of redirect-only activation, signed worker processing, actual usage increments, reconciliation, renewal failure, confirmed cancellation, expiry/tier change, retained history and mobile overflow. Screenshot review confirmed MOCK provenance and actual ledger/payment states. It also found and corrected a full-width checkbox style without changing backend behavior.

Evidence: `.cache/task6a-all-tests.log`, `.cache/task6a-targeted-final.log`, `.cache/task6a-all-browser.log`, `.cache/task6a-billing-browser.log`, `.cache/task6a-billing-browser-final.log`, `.cache/task6a-build.log`, `.cache/task6a-typecheck.log`, `.cache/task6a-lint.log`, `.cache/task6a-format.log`, `.cache/task6a-schema.log`, `.cache/task6a-migrations.log`, `.cache/task6a-schema-diff.log`. Full browser JSON is preserved in `.cache/task6a-all-e2e-results.json`; the current `.cache/e2e-results.json` and ignored HTML report contain the latest targeted UI run. Screenshots in ignored `test-results/` include:

- `billing-server-priced-MOCK-32683-ion-and-actual-worker-usage-chromium/billing-paid-mock.png`
- `billing-renewal-reconcilia-4424b--plan-change-retain-history-chromium/billing-renewal-history-mock.png`

Full suites use an explicitly enabled historical loopback test adapter and freshly restarted stable build, with no ambient worker competing with their controlled workers. The fixture apps use ports 3001/3002/3003/3004 for Google/AI/Meta/Paystack. The historical test adapter is disabled again after verification, and all fixture apps stop.

The fixtures use a deterministic Paystack-shaped HTTPS service with temporary certificates. An explicit test-process preload asserts the normal transport pinned a public address, then remaps only api.paystack.co to the fixture while retaining SNI/certificate validation. Application code has no mock-transport switch. The fake TEST key and MOCK label are explicit fixture provenance; no real card or actual provider API is contacted. Real child workers process signed billing events, execute metered workflow jobs and exercise pending-slot recovery. Existing AI/Google/WhatsApp/HTTP real-worker regression suites retain their provider fixtures.

An initial expanded full run recorded **216 passed / 2 failed out of 218 records**: the existing WhatsApp concurrency test and its parent failed because a brief safety hold left a one-shot job queued. The hold was retained and bounded slot waiting fixed the regression; targeted combined evidence passed afterward. The initial failure is preserved in `.cache/task6a-initial-concurrency-regression.log`. An initial full browser run recorded 23 passed / 2 failed because a new billing assertion assumed zero usage in the worker-shared workspace; earlier AI scenarios had already consumed executions, and the test failure restarted the dependent fixture. The assertion now checks exactly one additional debit against the actual baseline and that run’s ledger identity. The corrected full run passed all 25; the initial result is preserved in `.cache/task6a-initial-browser-baseline-failure.log`. Earlier development checks also caught a rollback-dependent test setup and a missing renewal checkout binding; both were corrected before final regression. Schema-diff verification caught PostgreSQL interval normalization, corrected by matching the canonical schema expression without changing its 90-second meaning.

## Setup and operational limits

1. Apply migrations and build: `npm run db:migrate`, `npm run build`; run `npm start` and `npm run worker` separately.
2. Keep production billing disabled. Set only `PAYSTACK_TEST_ENABLED=true` and a dedicated `PAYSTACK_SECRET_KEY=sk_test_...` in server environment configuration. Never use NEXT_PUBLIC for secrets; `sk_live_*` is refused even if the enable flag is set.
3. Create appropriate TEST plans in the Paystack dashboard and set the tier/interval mapping JSON. Configure optional explicit annual prices/catalog overrides knowingly; none are inferred. Do not update existing Paystack plans inadvertently, because the documented provider API can reprice existing subscriptions by default.
4. Approve exact `https://api.paystack.co` in the existing HTTP origin allowlist. Native TLS egress compatible with existing DNS pinning and configured network policy is required. No unsafe proxy/private-address fallback was added.
5. Configure the Paystack TEST webhook URL at `/api/billing/paystack/webhook` on an authorized HTTPS test endpoint. A browser callback URL is not that webhook. This task did not publish an endpoint or deploy anything.
6. Keep the vault keyring stable/retained for encrypted billing tokens; retiring an old key before explicit re-encryption makes cancellation material unavailable. A dedicated billing-secret rotation UI/CLI is not included. The application/worker must share policy, configuration and secrets.

Remaining limits: no actual Paystack test-mode API proof; no production keys, real-money tests or live commercial activation; no automatic resolution/refund/retry for ambiguous recurring creates; no mid-cycle proration, credit notes, dunning, tax/FX/provider-cost invoicing, annual discount or automated future-tier purchase; bounded reconciliation history and throughput; no production accounting-retention/export policy or billing-key rotation interface. Supported checkout is card only; direct debit and other channels are not implemented. Unsupported array-shaped administrative webhook events remain outside scope. PostgreSQL session advisory locks require compatible database pooling. Commercial prices/allowances, provider contracts, account readiness, webhook delivery and actual billing dates must be reviewed and tested with authorized TEST credentials before release.

Live Google/OpenAI/Meta verification remains unchanged and UNVERIFIED. No Task 6B work, publication, deployment or production-readiness claim is made.

## Final verdict

**Implementation and controlled simulated-provider verification: PASS. Actual Paystack test-mode API verification: UNVERIFIED. Production readiness: NOT CLAIMED.** No dedicated actual Paystack test key was present. No actual Paystack payment, live key, real-money transaction, deployment or publication occurred.

The normal application and PostgreSQL worker are restored with the historical integration test adapter disabled. Paystack itself remains disabled/unconfigured by default. Existing Google/OpenAI/Meta live-verification status is unchanged. All changes remain local and uncommitted/unpushed; stop after Task 6A.
