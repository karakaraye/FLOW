# FlowPilot AI manual testing

Use a development database and test accounts. Live Google, Gmail, OpenAI, Meta and Paystack verification remains outstanding. These steps test the actual local app, database and worker without sending external messages or taking payments.

## Start on your computer

From your existing FLOW checkout, install Node.js 22.12+ and Docker Desktop/Compose, then run:

```sh
git pull --ff-only origin main
npm run setup:env
npm ci
docker compose up -d --wait db
npm run db:migrate
npm run integrations:setup:local
npm run db:seed:providers
npm run db:seed:templates
npm run dev
```

Keep that terminal open. In another terminal in the same folder:

```sh
npm run worker
```

Open http://localhost:3000 in your computer's browser. A localhost URL points to the machine running the browser: it does not automatically reach this chat's cloud workspace. Leave FLOWPILOT_ENV=development. Never use production/customer credentials for these tests.

## Walkthrough

1. **Account and session:** register a fresh test account with a password of at least 12 characters. Sign out, confirm dashboard access redirects to login, then sign in again. Incorrect passwords must fail. Real email verification/recovery delivery is not configured; this is development authentication.
2. **First workflow:** open Workflows → New workflow. Add and connect Manual trigger → Set data → Log event. Configure Set data with a small literal object such as `{"ready":true}` and a fixed log message. Save, publish and run manually. Execution history should show a real queued/running/finished run and successful node records. Raw customer payloads are deliberately sanitized in history.
3. **Templates and conditions:** open Templates, preview a built-in routing/qualification prototype, read its required JSON inputs, install it, publish it and run once with data matching each branch. The chosen branch should execute; the other branch should be skipped. These prototypes do not send messages or create external business records.
4. **Draft versus published:** edit the installed workflow and save a new draft. The prior published version must retain its original definition. Publish the revision before expecting new executions to use it.
5. **Durable queue:** stop ONLY your ordinary worker using Ctrl+C. Queue a manual workflow in the app and confirm it remains queued. Close/reopen the browser, restart `npm run worker`, and check the same run completes. Never stop PostgreSQL or kill a worker during real external actions to perform this test.
6. **Tenant boundary:** copy a workflow/history URL from account A. Open a private browser window, register account B, and visit the copied URL. It must return not-found/denied rather than account A's data. A new account's list must not contain A's workflows or runs. Role mutation paths are covered by automated tests; do not edit database roles to simulate a normal user flow.
7. **Settings and navigation:** inspect Settings, Integrations, AI and Billing and usage on desktop and mobile. Disabled providers, scheduling and other unfinished features must show their actual unavailable/preview state. Billing should display actual local usage and FREE allowances; no payment should be claimed successful without verified provider evidence.
8. **Health:** visit `/api/health/live` and `/api/health/ready` on the running app. They should return 200 when ready. `/api/operations/metrics` must reject an ordinary unauthenticated request (401); app ownership alone does not grant this operator endpoint.

## Automated verification

The last completed Task 6B run passed **235 automated tests** and **28 Chromium scenarios**. To repeat against your LOCAL test database, first stop your ordinary worker. Some tests deliberately crash their own controlled workers and create/drop their own uniquely named disposable databases. The recovery test needs local database-admin privileges and PostgreSQL tools inside the local Compose container, default `flow-db-1`; set RECOVERY_TEST_CONTAINER if your container has another name. Do not run against production.

Enable the loopback-only fixture adapter before starting/restarting the test server:

```sh
npm run integrations:setup:local -- --enable-test-adapter
npm run build
npm start
```

With this server running, in another terminal:

```sh
npm run typecheck
npm run lint
npm run db:validate
npm test
npm run test:e2e:install
npm run test:e2e
```

Run the suites sequentially. Authentication limits remain enabled; repeated runs can need a 60-second cooldown. Fixtures exercise real background workers and controlled provider services, not live provider accounts. Read TASK6B_VALIDATION.md for exact scope and earlier failures.

Afterwards stop the test server, disable the adapter, restart the ordinary app and restart the worker:

```sh
npm run integrations:setup:local -- --disable-test-adapter
npm run dev
# Separate terminal:
npm run worker
```

## Testing real providers

Do this separately, one provider at a time, using dedicated sandbox/developer assets and explicitly approved recipients. Never paste keys into chat or commit them. Configure credentials in the local ignored .env and follow the provider-specific validation documents (Tasks 5C–6A). Google consent/callback registration, Gmail recipient approval, OpenAI budget, WhatsApp assets/consent and Paystack TEST plan mapping are required. External callbacks need an approved reachable HTTPS test URL; localhost alone is insufficient. No tunnel, public endpoint, payment or live message is enabled by this guide.

For a failure, record the step, expected/actual behavior, safe request/run ID and a screenshot with credentials/personal data removed. Do not publish raw .env files, tokens or unsanitized provider payloads.
