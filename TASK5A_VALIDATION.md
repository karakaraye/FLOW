# Task 5A — secure integration foundation

Verdict: **PASS** for the scoped foundation, verified 28 October 2026. Real providers remain Coming Soon. No Task 5B work or production deployment occurred.

## Architecture and database

The existing Better Auth, Prisma/PostgreSQL, workspace authorization, JSON workflow engine, and durable worker remain intact. Integration modules live in `src/lib/integrations/`: contracts, provider metadata, encryption, authentication state, a local test adapter, and an authorized service. `jose` 6.2.13 is the only additional direct dependency; Node crypto supplies authenticated encryption.

New models are `IntegrationProvider`, `WorkspaceIntegration`, `IntegrationCredential`, and `IntegrationAuditEvent`, with provider, status, and event enums. Migrations `20261028162411_integration_foundation` and `20261028190000_integration_security_constraints` add tenant/provider composite foreign keys, unique live primary connections, positive revisions/generations, fixed error-code constraints, and an append-only audit trigger. Nine migrations are applied. No database reset was used.

`npm run db:seed:providers` upserts six metadata definitions without creating credentials or connections. It preserves operator-disabled provider state. There is currently one live primary connection per workspace/provider; future multiple accounts require verified provider account identities rather than user-chosen account IDs. Removed connections retain tombstones and audit history while releasing the live slot.

## Credentials and key management

AES-256-GCM uses a fresh 12-byte random nonce and a 16-byte authentication tag. Versioned envelopes bind workspace, connection, provider, record, purpose, and key ID through authenticated additional data. Credentials and pending authentication state have distinct purposes. Tenant swapping, altered tags, retired keys, malformed envelopes, and invalid configuration fail closed.

`INTEGRATION_ENCRYPTION_KEYS` is a server-only JSON map of 1–5 key IDs to canonical base64-encoded 32-byte random keys; `INTEGRATION_ACTIVE_KEY_ID` selects writes. There is no fallback to the authentication secret or database storage. Retain old keys while rotating every live credential and pending state to the active key, then retire old keys after checking backup and recovery requirements. A database key ID must match the authenticated envelope. Missing keys prevent credential operations, but authorized local revocation/removal can still clear stored ciphertext.

`npm run integrations:setup:local` generates dedicated random local keys only when absent, preserves existing keys, writes ignored `.env` with mode 0600, and prints no values. The default test flag is false. These environment keys protect a database-only compromise; they do not protect against an attacker controlling the application process, machine, environment snapshots, or key-bearing backups. Production requires a managed secret service/KMS, workload identity, least privilege, audited access, protected key backups, and a rotation/restore policy. No production secret service is claimed here.

Revocation clears current database payloads, pending state, and scopes and records revocation/destruction timestamps. This is not erasure of old WAL/backups, cryptographic destruction of retained keys, or revocation at an external provider. Audit triggers do not defend against a database superuser or intentional parent workspace purge.

## Adapter and authentication design

The typed adapter contract defines initiation, callback validation, refresh, health, revoke, capabilities, and normalized errors. The credential persistence contract is bound inside the authorized, locked service; there is no public credential-read API. Only fixed allowlisted error codes/messages reach responses or audit rows. No arbitrary provider exception text or payload is logged.

Gmail, Google Sheets, WhatsApp Business, generic HTTP API, and OpenAI are metadata-only Coming Soon providers. Planned scopes/capabilities are explicitly descriptive. No real OAuth exchange, unrestricted HTTP execution, provider action node, or AI integration exists.

The separate local-test adapter is deliberately not OAuth. It requires `INTEGRATION_TEST_ADAPTER_ENABLED=true`, a configured loopback `BETTER_AUTH_URL`, and an independent random 32-byte `INTEGRATION_TEST_ISSUER_KEY`. It verifies signed HS256 JWTs with fixed issuer/audience, token kind, expiry, user/workspace/provider/connection binding, state digest, and PKCE challenge. Proofs expire after 60 seconds, pending attempts after five minutes, access tokens after five minutes, and refresh tokens after one hour. Actual credential health verification is required before CONNECTED. Browser requests never receive or submit these proofs, state values, or tokens. The test adapter has been disabled again in the current environment after verification.

Future real OAuth must use Authorization Code with PKCE S256, cryptographically random single-use state bound to user/workspace/provider/connection and an expiring revision, exact preconfigured HTTPS callback URIs, minimum scopes, server-only TLS code exchange, and provider identity/issuer/audience verification where applicable. Do not derive redirects from request Host or arbitrary user URLs. Callback query strings, codes, tokens, and state must be excluded from access/error logs. Verify account identity and health before marking connected. Refresh-token rotation, reauthorization, remote revocation/retry, expiry, and concurrent revoke fencing are prerequisites. Future network calls need a fenced/CAS or durable outbox design outside long database locks; the current local adapter is network-free and does not establish external side-effect guarantees for the existing pure workflow worker.

## Lifecycle, authorization, and limits

States are DISCONNECTED, PENDING, CONNECTED, EXPIRED, ERROR, and REVOKED. Expiry is also derived for metadata from the stored verified expiration timestamp. Authentication attempts bind the initiating member; completion consumes pending state. Concurrent mutations use row locks and expected revisions. Refresh cannot resurrect revoked credentials. Disabled providers cannot authenticate.

Every service operation checks current membership server-side. OWNER/ADMIN may create, edit, authenticate, verify, refresh, rotate, revoke, and remove connections. EDITOR/VIEWER have metadata-only access; there is no implicit credential-use permission. Tenant IDs are part of database constraints and queries. Existing authenticated API wrappers enforce exact Origin on mutations and a 64 KiB body limit. The service limits records to 100 per workspace including tombstones, mutations to 60 per minute per connection, and returned audit history to the latest 100 events. No secret field is serialized into DTOs or React props.

## APIs and dashboard

Paths below are relative to `/api/workspaces/[workspaceId]`:

| Path                                          | Methods                                        |
| --------------------------------------------- | ---------------------------------------------- |
| `/integration-providers`                      | GET metadata                                   |
| `/integrations`                               | GET list, POST disconnected record             |
| `/integrations/[integrationId]`               | GET metadata, PATCH label, DELETE local record |
| `/integration-events`                         | GET sanitized events, optional integrationId   |
| `/integrations/[integrationId]/test/start`    | POST local challenge                           |
| `/integrations/[integrationId]/test/complete` | POST local verification                        |
| `/integrations/[integrationId]/health`        | POST verified health                           |
| `/integrations/[integrationId]/refresh`       | POST verified refresh                          |
| `/integrations/[integrationId]/revoke`        | POST local revocation                          |
| `/integrations/[integrationId]/rotate-key`    | POST storage-key rotation                      |

Mutations require the current revision where applicable and reject unexpected fields. There is no endpoint returning decrypted credentials or accepting an arbitrary callback proof.

The responsive catalog, connection detail, loading state, role-disabled controls, lifecycle status, credential-presence metadata, and sanitized audit history replace the old integration placeholder. Local test controls are visibly labeled TEST ENVIRONMENT ONLY and unavailable by default. Real-provider authentication remains blocked. New UI components live in `src/components/integrations/`; dashboard routes are under `src/app/(app)/integrations/` (see repository paths for the layout).

## Verification and reproduction

Use a disposable local database/test environment, apply migrations and seed providers. Prepare keys and explicitly enable the loopback-only verification profile:

```sh
npm run integrations:setup:local -- --enable-test-adapter
npm run db:seed:providers
npm run build
npm start
# In another terminal, with the same environment:
npm test
npm run test:e2e
```

The server must restart after changing environment flags. Browser installation uses `npm run test:e2e:install`. The tests create real sessions and disposable workspaces; do not use a production database. The real-worker tests spawn their own workers, so stop an ambient worker while running the suite. Restore the default afterward with `npm run integrations:setup:local -- --disable-test-adapter` and restart the server. Run `npm run worker` for normal local workflow processing.

Executed results:

| Command/check                                      | Actual result                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                         | 123 passed, 0 failed, 0 skipped; all prior 96 preserved, including real separate-worker execution/recovery and template runs |
| `npm run test:integrations`                        | 27 passed, 0 failed                                                                                                          |
| `npm run test:e2e`                                 | 12 passed, 0 failed/skipped/flaky; all prior 8 preserved; 42.9 seconds                                                       |
| `npm run typecheck`                                | Passed                                                                                                                       |
| `npm run lint`                                     | Passed                                                                                                                       |
| `npm run format:check`                             | Passed                                                                                                                       |
| `npm run db:validate`                              | Passed                                                                                                                       |
| `npm run db:migrate` / `npx prisma migrate status` | Applied additive migrations; database up to date                                                                             |
| `npm run build`                                    | Passed production build                                                                                                      |
| `npx tsx .cache/check-provider-disable.ts`         | Disabled provider survived metadata reseeding; original state restored                                                       |
| Private-key literal scan of `.next/static`         | Passed; 27 JavaScript artifacts checked without printing key values                                                          |

Automated integration tests cover authenticated encryption, context/tag/key tampering, key rotation/retirement, pending-state rotation/expiry, actual JWT validation, expiry/refresh, fail-closed missing keys, redacted malicious adapter errors, audit immutability, composite foreign keys, duplicate admission, stale/concurrent updates, refresh/revoke races, tombstones, all four roles, cross-workspace access, unauthenticated and Origin rejection, and metadata-only responses. Browser tests exercise the real lifecycle, revocation/removal, role restrictions, mobile layout, future-provider blocking, and tenant isolation. Desktop/mobile screenshots are in ignored `test-results/`; the verified local-test screenshot was inspected.

A final `npx tsx .cache/integration-default-smoke.ts` check passed against the restarted HTTP server: authenticated provider metadata omitted local-test and creating a local-test connection returned 404. The application and normal workflow worker were then left running with test authentication disabled.

Reusable cloud installation/start instructions were saved as an environment configuration draft. The draft is not applied or published; review and save it in environment settings and publish the cloud environment to activate it. This is environment setup, not a production deployment.

## Remaining limitations

No real third-party connectivity or production deployment was attempted or verified. OAuth callbacks, provider account identity, network retries/outbox, remote revocation, external workflow actions, production key management, and operational monitoring belong to later explicitly authorized work. Display labels are non-secret user metadata; users must not paste secrets into labels. No token-entry form is exposed. Local signed test credentials prove this foundation's lifecycle and protection, not a real provider integration.
