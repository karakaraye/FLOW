# FlowPilot AI

A multi-tenant automation SaaS foundation with real visual workflow creation, publishing, manual execution, and execution history. Accounts use Better Auth, PostgreSQL-backed sessions, and Prisma. A PostgreSQL-backed worker runs the four built-in node types. The React Flow builder edits the existing JSON engine format. Signed webhooks and approved HTTPS actions are available; Google OAuth adapters are available when configured (live verification remains pending); Controlled AI nodes and developer-owned Meta WhatsApp integration extend the same worker. Live Google, OpenAI and Meta verification remains pending; payments and production deployment remain outside this release.

## TEST subscriptions and usage (Task 6A)

Open **Billing and usage** for FREE, STARTER, BUSINESS and PRO proposals, actual usage/remaining allowances, verified payment history and cancellation. Default monthly NGN proposals are ₦0 / ₦5,000 / ₦15,000 / ₦35,000, stored as integer kobo. Annual prices are separate and disabled until explicitly configured; no discount is inferred. Prices/limits are centralized in `src/lib/billing/config.ts` with an optional complete catalog override illustrated by `config/billing-plans.example.json`.

Billing defaults off. For an authorized sandbox setup, configure only the server-side `PAYSTACK_TEST_*` settings and dedicated `PAYSTACK_SECRET_KEY=sk_test_...` from `.env.example`, map the provider's TEST plans, approve exact `https://api.paystack.co` in the existing HTTP allowlist, and restart app/workers. Live keys are refused. Configure the authenticated TEST webhook at `/api/billing/paystack/webhook` on an authorized HTTPS test endpoint; this milestone does not publish or deploy one. No card form or card details are stored by FlowPilot.

Checkout callbacks cannot activate plans. Signed events and server-side verification establish payment facts; a server-created, verified subscription binding is also required for paid entitlements. Initial recurring renewal starts after the already verified paid period. Ambiguous initialization/creation is held for reconciliation, never blindly repeated. Cancellation must be confirmed by Paystack; paid access lasts through its verified end date. Unpaid expiry has zero grace and falls back to FREE without deleting history. Paid-tier changes are period-boundary only, with no proration or automatic new purchase.

Commercial allowances apply atomically to enabled workflows, executions, AI spend, integration slots, outgoing messages and worker concurrency. Counters reset by UTC calendar month and do not reset on upgrades/retries. Existing AI budgets, message consent/windows, approved recipients and other provider limits still apply. Subscription fees do not settle external provider bills. Read [TASK6A_VALIDATION.md](TASK6A_VALIDATION.md) for exact plans, quota policy, migrations, test evidence and limitations. **Actual Paystack test-mode API calls remain unverified**; automated financial behavior uses controlled fixtures. Nothing is ready or enabled for production billing.

## WhatsApp Business (Task 5E)

Official Meta Cloud API v26.0 supports signed inbound text triggers, service-window text replies and consented provider-approved utility templates. Open **Integrations → WhatsApp Business** for controlled developer onboarding, subscriptions, consent/suppression, templates, actual events and delivery/uncertainty audit. Customer Embedded Signup and production eligibility are not implemented. No real messages were sent during verification.

The integration defaults to disabled. Set the server-only `META_*` values documented in `.env.example`, approve exact test assets and recipients, add `https://graph.facebook.com` to the approved HTTP origins, and restart the application and worker. App Secret/verification token stay server-only; access tokens are verified against the supplied assets and encrypted in the existing vault. Use a stable dedicated recipient HMAC key across token/App Secret/vault rotation. Configure nonzero daily limits knowingly. Real test recipients require explicit operator authorization.

Apply additive migrations with `npm run db:migrate`, build with `npm run build`, then run `npm start` and `npm run worker` in separate terminals. Configure Meta's authenticated callback at `/api/integrations/whatsapp/webhook` and its messages subscription; publish and explicitly activate an incoming workflow version in the dashboard. API acceptance is not delivery. Unknown sends never automatically resend and block that recipient until reviewed. Local revocation requires separate token rotation/revocation in Meta.

See [TASK5E_VALIDATION.md](TASK5E_VALIDATION.md) for exact evidence, identity/account-model research, retention, live-unverified status and production gaps. Unpublished import examples requiring configuration are in [examples/whatsapp](examples/whatsapp/README.md). No unofficial WhatsApp automation, bulk cold messaging, media handling, marketing broadcasts or inbox was added.

## AI automation (Task 5D)

Five AI nodes and an authenticated AI workspace/playground reuse the existing queue and vault. Models/pricing are operator-allowlisted; workspace budgets default to zero and uncertain costs remain reserved. OpenAI is unconfigured by default and no canned responses are substituted. Controlled-provider tests pass; **live OpenAI connectivity is UNVERIFIED**. See [TASK5D_VALIDATION.md](TASK5D_VALIDATION.md) for setup, strict schemas, accounting, privacy boundaries, exact verification and limitations.

## Google Sheets and Gmail (Task 5C)

Google OAuth, three Sheets nodes, and send-only Gmail now reuse the existing vault, builder and durable worker. The implementation is tested against controlled providers; **live Google connectivity is UNVERIFIED** because no real OAuth client/test account is configured. Gmail sending defaults to disabled and requires explicit recipient approval. See [TASK5C_VALIDATION.md](TASK5C_VALIDATION.md) for Google Cloud Console setup, scopes, callback configuration, policy requirements, test results and limitations. No deployment or publication occurred.

## Signed webhooks and HTTP actions (Task 5B)

Signed webhook triggers and approved HTTPS action nodes use the existing visual builder, encrypted credential vault, PostgreSQL queue, and worker. Run migrations and `npm run db:seed:providers`. HTTP actions default to denied: configure exact origins in server-only `HTTP_ACTION_ALLOWED_ORIGINS` and restart the server and worker. Write retries also require explicit server approval in `HTTP_IDEMPOTENT_ORIGINS`. See [TASK5B_VALIDATION.md](TASK5B_VALIDATION.md) for the HMAC protocol, setup, APIs, SSRF pinning, unknown-outcome recovery, and exact verification results.

## Integration foundation (Task 5A)

Run `npm run integrations:setup:local` and `npm run db:seed:providers` after database migration. Dedicated credential encryption keys are generated into ignored local `.env`; the test adapter stays off by default. Real providers remain Coming Soon. See [TASK5A_VALIDATION.md](TASK5A_VALIDATION.md) for architecture, APIs, key rotation, security boundaries, and the explicit local verification profile.

## Requirements

- Node.js 22.12+ (Node 24 recommended)
- npm 11+
- Docker with Compose v2, or an existing PostgreSQL 17 database
- HTTPS access to the npm registry and `binaries.prisma.sh` (Prisma verifies downloaded engine checksums)

## Local development

Use the existing FLOW checkout. Cloud tasks are already isolated; do not create another repository or worktree.

1. Run `npm run setup:env` to create an ignored `.env` with random local credentials (existing files are preserved), or copy `.env.example` to `.env`. For a manually copied file, set a unique PostgreSQL password in both `POSTGRES_PASSWORD` and `DATABASE_URL`. Generate `BETTER_AUTH_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit these values. Set `BETTER_AUTH_URL` to the application’s exact origin; the default local origin is `http://localhost:3000`.
2. Run `npm ci`. The postinstall step generates the Prisma client. A valid `DATABASE_URL` must be present when Prisma loads its configuration.
3. Run `docker compose up -d --wait db`. PostgreSQL is bound to loopback only and uses a persistent named volume. With an existing PostgreSQL service, skip Compose and point `DATABASE_URL` to that database.
4. Run `npm run db:validate` and `npm run db:migrate` to validate and apply the checked-in migration. Use `npm run db:dev -- --name your_change` only when intentionally authoring a new schema migration.
5. Run `npm run db:seed:templates` to add the seven working built-in starters. This is repeatable and preserves existing catalog slugs and archives.
6. Run `npm run dev` and open the local application on port 3000. Create an account at `/register`. The first authenticated application visit provisions a personal workspace and OWNER membership.
7. In another terminal in the same checkout, run `npm run worker`. In Workflows, choose New workflow, add and connect nodes, apply their configuration, save a draft, publish it, and queue a manual run. Follow its real status and sanitized node records in Execution history. The server and worker must share `DATABASE_URL` and `BETTER_AUTH_SECRET`.

For a production-mode local check, stop the dev server, then run `npm run build` and `npm start`. Use `docker compose stop db` to stop the local database without deleting data. Do not remove its volume unless you explicitly intend to erase its data.

## Commands

| Command                       | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                 | Development server                                                   |
| `npm run build` / `npm start` | Production build / local production server                           |
| `npm run typecheck`           | Strict TypeScript checking                                           |
| `npm run lint`                | Next.js and TypeScript ESLint rules                                  |
| `npm run format:check`        | Formatting validation                                                |
| `npm run db:generate`         | Regenerate Prisma client                                             |
| `npm run db:validate`         | Prisma schema validation                                             |
| `npm run db:migrate`          | Apply checked-in migrations                                          |
| `npm run db:studio`           | Local database browser                                               |
| `npm run test:database`       | PostgreSQL DDL and constraint tests                                  |
| `npm run test:public`         | HTTP checks of public pages and account forms                        |
| `npm run test:auth`           | Real HTTP authentication, protected routes, and tenant isolation     |
| `npm run worker`              | Background worker; required to process accepted runs                 |
| `npm run test:engine`         | Validator, executor, workflow API, and real worker integration tests |
| `npm test`                    | All automated tests                                                  |

Run HTTP tests with the application running at `BETTER_AUTH_URL` (default `http://localhost:3000`). Set `TEST_BASE_URL` to the same origin when using another port. Auth tests must target the same disposable development database as the application. They create uniquely named users, sessions, and workspaces, then remove their own records. Rate-limit rows may remain. Repeated runs can hit the intentional sign-up limit; wait for its 60-second window rather than disabling protection. The SQL test uses an isolated schema inside a rolled-back transaction; its database user needs CREATE SCHEMA permission. No test uses mock authentication. Stop ordinary workers before running engine tests: the suite launches real, controlled worker subprocesses, including one it kills mid-transaction. Keep the application server and database running. Restart `npm run worker` after testing.

## Architecture

```text
src/app/
  page.tsx                 Public website
  login/, register/        Account forms
  (app)/                   Authenticated layout and application pages
  api/auth/[...all]/       Better Auth HTTP handlers
  api/workspaces/[workspaceId]/  Membership-scoped workspace read
src/components/            Shared interface components
src/components/ui/         shadcn/ui-style Button with Radix Slot and CVA
src/lib/                   Database, authentication, session and authorization modules
prisma/schema.prisma       Models, enums, relationships and uniqueness constraints
prisma/migrations/         Foundation, workflow tables, and immutable-version migrations
src/lib/engine/            Validator, registry, executor, workflow service, queue worker
scripts/worker.ts          Standalone worker entrypoint
tests/                    Real PostgreSQL and HTTP integration tests
```

The shadcn/ui configuration is in `components.json`; its Button is maintained locally, using Radix Slot, CVA, and the standard `cn` utility. Tailwind v4 supplies the design system. No external font service is needed at runtime or build time.

## Security and tenant boundaries

- Better Auth handles password hashing, session tokens, HTTP-only cookies, origin/CSRF validation, sign-in, sign-up, and session revocation. Passwords must contain at least 12 characters. Rate limits are persisted in PostgreSQL, including across multiple application processes.
- Production must use HTTPS and a strong unique `BETTER_AUTH_SECRET`. Use the correct `BETTER_AUTH_URL`; do not broaden trusted origins to arbitrary hosts. Configure trusted client-IP forwarding at the deployment boundary before exposing the application publicly.
- Protected pages check the session on the server. Workspace data is selected using the authenticated user ID and the requested workspace ID together. A workspace ID alone never grants access. Nonmembers receive 404; anonymous API callers receive 401.
- Personal workspace provisioning uses a transaction and PostgreSQL advisory lock to avoid duplicate workspaces on concurrent first visits. It uses only the authenticated user’s ID. Existing membership is re-read from the database.
- `authorizedMembership` supports explicit role allowlists: OWNER, ADMIN, EDITOR, VIEWER. There are currently no workspace mutation endpoints. Future mutations must recheck membership and the relevant role on the server on every request; do not rely on a sidebar or a client-provided role.
- Foreign keys cascade tenant-owned records appropriately. A workspace has at most one subscription; plans referenced by a subscription cannot be deleted. Prices have a nonnegative SQL constraint. Monetary amounts use integer cents. No subscription is fabricated during signup.
- Never return account hashes, session tokens, or other members’ data in workspace APIs. No real credentials belong in source control.

## Available versus preview

Implemented: public site, real authentication, protected dashboard with real scoped counts, private workspace provisioning, visual workflow drafts with separate canvas metadata, immutable published versions, manual execution, sanitized node history, read-only account/workspace settings, and tenant/role-authorized APIs.

Coming Soon: scheduling, webhooks, integrations, AI, billing, profile editing, team invitations, and role editing. Email verification and password recovery are not configured; the UI explicitly states this limitation. These require an email provider and a separate implementation task before a production launch. An unverified email is not proof of email ownership.

## Current validation status

See `VALIDATION.md` for evidence and scope: the production build, strict TypeScript, lint, schema validation, migration deployment, and all 96 Node/component/database/HTTP tests (including the original 78) and all 8 Chromium Playwright scenarios passed in this cloud instance. Desktop and mobile screenshots were inspected. Production deployment was not performed.

See [ENGINE.md](ENGINE.md) for the definition format, API contracts, role matrix, durable queue semantics, limits, and security decisions.

## Visual builder and browser checks

The builder supports the existing four node types, labeled TRUE/FALSE handles, drag-and-drop, keyboard connection controls, node/edge deletion, pan/zoom/fit, a minimap/grid, configuration panels, undo/redo, and unsaved-change indicators. It validates with the existing engine contracts; invalid graphs cannot be saved or published. Save positions and labels separately from the engine definition. Run history renders the exact immutable version and real NodeRun statuses, rather than painting statuses onto a changed draft.

Install Chromium with `npm run test:e2e:install` (browser binaries stay in ignored `.cache/ms-playwright`). With PostgreSQL and the production-mode application running, stop ordinary workers and run `npm test`, then `npm run test:e2e`. The browser suite uses real accounts, sessions, and PostgreSQL, and launches a real worker for each admitted test run. It removes only its own records. Sessions from real browser logins are reused between scenarios; rate limits remain enabled, and the login helper respects a returned Retry-After window if needed. Restart `npm run worker` after testing.

`npm run test:builder` runs the document/component/persistence subset. Playwright writes its JSON report to `.cache/e2e-results.json`, HTML report to `playwright-report/`, and screenshots to `test-results/`; all are ignored by Git. These commands require a disposable development database shared with the application. Do not run the suite against production.

See [TASK3_VALIDATION.md](TASK3_VALIDATION.md) for the exact file changes, conversion/persistence design, browser evidence, final checks, and remaining limitations.

## Automation template library

Open Templates to browse/search/filter the seven supplied-data starters, inspect a read-only workflow preview and requirements, then select Install template. Installation creates an independent workspace draft in the existing visual editor. Review its literal rules, save, validate, publish, and queue a manual run. Existing execution history shows real results. Examples and limitations are explicit; these do not connect to CRM, financial, messaging, email, or external task systems. No JSON is required to install.

Workspace OWNER, ADMIN, and EDITOR can install; VIEWER can browse only. Public `GET /api/templates` and `/api/templates/:slug` return published source snapshots only. Workspace installation history is available at `/api/workspaces/:workspaceId/template-installations`. Drafts and archived entries stay out of the public catalog, and catalog updates never overwrite installed copies.

Shared catalog management at `/platform/templates` requires a separate PlatformAdministrator binding, not workspace ADMIN membership. There is no HTTP self-grant endpoint and no automatic first-user administrator. A trusted local operator with database access can explicitly run `npm run catalog:admin -- grant <existing-user-id>` or `npm run catalog:admin -- revoke <existing-user-id>`. Use the existing database tools to identify the intended user; never paste credentials into commands or chat. The management screen supports draft creation/editing, validation, immutable publication, archiving, and installation listing. Publishing an archived entry explicitly makes it available again; seeding never does so silently.

For focused verification use `npm run test:templates`. Full Node and browser suites require the application and PostgreSQL running with ordinary workers stopped; they launch real controlled workers. Use a disposable database with the built-in catalog seeded and available. Authentication limits remain enabled: back-to-back suites may need their documented 60-second cooldown. Do not clear rate-limit rows or disable protections to make tests pass. Restart `npm run worker` afterwards.

See [TASK4_VALIDATION.md](TASK4_VALIDATION.md) for models, exact template capabilities, API contracts, permission boundaries, provenance/copy semantics, results, browser artifacts, and limitations.

## Task 6B operations and security

Production preparation (no deployment): see [OPERATIONS.md](OPERATIONS.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and [TASK6B_VALIDATION.md](TASK6B_VALIDATION.md). Examples live under `deploy/`; encrypted backup/restore commands are `npm run ops:backup` and `npm run ops:restore`. `npm run test:security` runs focused security and disposable-database recovery tests. Explicit `FLOWPILOT_ENV=production` enables fail-closed deployment validation. Public registration/email recovery and live provider verification remain launch blockers.
