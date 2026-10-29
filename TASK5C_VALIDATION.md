# Task 5C — Google Sheets and Gmail

Verdict: **PASS for implementation and controlled-provider verification. Live Google authorization and connectivity: UNVERIFIED.** Verified 28 October 2026 (Africa/Lagos). No real Google credentials/test account were configured. No email was sent to a real recipient. No deployment, publication, WhatsApp, AI, or subscription work occurred.

## Architecture

Google modules live in `src/lib/google/`: configuration/mapping validation, a trusted provider adapter, OAuth/credential lifecycle service, and node execution. They reuse Better Auth sessions, workspace authorization, the Task 5A AES-GCM vault and credential persistence helpers, and the Task 5B pinned TLS transport, durable HttpAttempt records, PostgreSQL queue, per-run advisory locks, and shared graph traversal. There is no second login system, vault, queue, or engine.

New dependencies are `google-auth-library` **11.3.1**, `nodemailer` **10.2.1**, and development types `@types/nodemailer` **8.0.2**. Google’s maintained library creates authorization URLs, exchanges PKCE codes, refreshes tokens, and verifies ID-token signatures/issuer/audience/expiry. Its transporter is routed through the existing approved-origin/pinned TLS layer with hidden SDK retries disabled. Google REST actions use that transport directly to control side-effect retries. Nodemailer compiles buffered MIME only; it does not open an SMTP connection.

Four schema-version-1 node types extend the existing validator, registry, generator, worker, and React Flow builder:

- `google_sheets_read_rows`
- `google_sheets_append_row`
- `google_sheets_update_row`
- `gmail_send_email`

Existing six node types and historical immutable definitions/records remain supported. Google-containing graphs take the existing durable external-worker path; pure graphs keep their original atomic transaction behavior.

## Google Cloud Console setup

Use a dedicated development project and test account first. This setup has not been performed against a live project here.

1. In Google Cloud Console, select/create the intended project. In APIs & Services, enable **Google Sheets API** and **Gmail API**.
2. Configure Google Auth Platform/OAuth consent branding, audience, and data access. Choose Internal only for an appropriate Workspace organization, or External in **Testing** with explicitly listed test users. Provide accurate app identity, support contact, privacy disclosures, retention/deletion instructions, and scope justifications. Do not publish the consent app as part of this task.
3. Create an OAuth client of type **Web application**. Register the exact redirect URI `http://localhost:3000/api/integrations/google/callback` for local development. If using a different configured loopback origin, register that exact origin/path. There are no wildcard, query, fragment, user-supplied redirect, or open return URL options.
4. Put the client ID and secret in server-side secret configuration: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Set `GOOGLE_OAUTH_REDIRECT_URI` to the registered URI and `BETTER_AUTH_URL` to the matching application origin. Values are absent from this repository and example file.
5. Prepare the existing dedicated encryption keyring with `npm run integrations:setup:local`. Maintain server-only `INTEGRATION_ENCRYPTION_KEYS` and `INTEGRATION_ACTIVE_KEY_ID`; never reuse an OAuth or Better Auth secret as a vault key. The setup script preserves existing keys and prints no values.
6. Explicitly approve these origins in server/worker `HTTP_ACTION_ALLOWED_ORIGINS`: `https://oauth2.googleapis.com`, `https://www.googleapis.com`, `https://sheets.googleapis.com`, `https://gmail.googleapis.com`. They are not implicitly exempt from Task 5B policy. Compatible restricted native TLS egress is required; this environment’s managed proxy is not a substitute for connection-time pinning. No blocked egress was bypassed.
7. Apply migrations and seed metadata: `npm run db:migrate`, `npm run db:seed:providers`. Restart the application and worker after changing server-side configuration.
8. As a workspace OWNER/ADMIN, save a Google Sheets or Gmail connection record, open it, and choose Connect Google account. Review Google’s consent screen. The callback must complete under the same signed-in initiating member. A verified account identity and required scopes are necessary before CONNECTED is committed.
9. Gmail sending remains blocked unless the operator sets `GOOGLE_GMAIL_SEND_ENABLED=true` **and** a JSON array of explicit, lowercase, consented email addresses in `GOOGLE_GMAIL_ALLOWED_RECIPIENTS`. Do not enable real-recipient sending without explicit authorization. No address was authorized for live sending in this task.

Production would require a separately registered exact **HTTPS** callback matching the trusted application origin, secure cookies/proxy configuration, managed secrets/KMS, monitoring, privacy/deletion operations, and any required Google verification. Loopback HTTP is development-only. External Testing grants can have short refresh-token lifetimes; organization policies and Google consent/revocation limits also apply. Production setup is documentation, not a deployment or verification claim.

## OAuth scopes and identity

Connections are separate per workspace/provider. Enabling Gmail never silently expands a Sheets connection or merges permissions. `include_granted_scopes=false`, explicit per-provider scopes, offline access, and explicit consent are used.

| Provider      | Scopes                                         | Purpose                                                                                              |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Both          | `openid`, `email`                              | Verify Google subject, verified email, and nonce from a signed ID token                              |
| Gmail         | `https://www.googleapis.com/auth/gmail.send`   | Outbound sending only; no inbox, labels, deletion, mailbox-wide or readonly scope                    |
| Google Sheets | `https://www.googleapis.com/auth/spreadsheets` | Read and write existing spreadsheet IDs accessible to the authorizing user; no Drive-wide permission |

Google’s `userinfo.email` scope URI is normalized to `email`. Unexpected additional or missing permissions are rejected rather than silently accepted. The current file-ID entry model does not use a Picker or create/open app-owned files; `drive.file` alone would not grant arbitrary existing spreadsheets entered by ID. Therefore the dedicated Sheets scope is used. A future Picker/app-file model could reduce this to `drive.file`; no unrestricted Drive scope is requested here.

State and PKCE verifier use cryptographically secure randomness, with S256 challenge. State is stored as a digest plus encrypted pending state containing nonce/verifier and the exact redirect URI. Attempts bind connection, provider, workspace, initiating user, current revision, and five-minute expiry. Callback parameters reject duplicates; redirect validation is exact and is not derived from an untrusted request Host. The current session and OWNER/ADMIN membership are required.

The pending attempt is durably consumed **before** network code exchange, without holding a database transaction across the call. Concurrent or repeated callbacks cannot exchange it twice. A network failure requires a new authorization attempt. A declined/error callback fails closed. Code exchange, signed ID-token verification, verified email, nonce, Google subject, exact scopes, future token expiry, and offline refresh token are required before saving CONNECTED. ID tokens and authorization codes are not retained. Reconnect clears prior locally stored credentials so a failed reconnect cannot silently restore an old account.

## Token lifecycle, rotation, and revocation

Access and refresh tokens plus verified account binding/scopes use the existing encrypted credential envelope and context. Metadata reads expose account email/subject, permissions, expiry/status and credential presence, never tokens, ciphertext, verifier, nonce, or refresh payloads.

A PostgreSQL session advisory lock per connection coordinates refresh across workers/processes. Tokens near expiry, or connections marked EXPIRED/ERROR, refresh before another action. Rotated refresh tokens are retained; omitted replacement tokens retain the previous valid refresh token. Scope expansion is rejected. Saving uses current revision/generation fencing, and revocation/reconnect/deletion cannot be undone by an in-flight refresh. Refresh failures persist sanitized status/audit codes; revoked/expired grants require reconnection. A delayed 401 cannot expire a newly refreshed token because the currently stored token is checked before changing state.

The existing storage-key rotation re-encrypts Google credentials and pending state with the active vault key without exposing them. Retain old keys while rotating and during backup policy transitions. Local revocation/removal does not require successful decryption. Disconnect clears local credentials/identity first, then attempts Google’s fixed revoke endpoint; the UI reports remote confirmation separately from an unavailable/unverified remote result. A successful revoke (or explicit invalid-token response) confirms the reported token outcome; Google may also revoke other grants sharing that client/account. Already dispatched operations and tokens in backups are not erased by deleting the current row.

Refresh coordination, like external-run locking, requires direct/session-mode PostgreSQL connections rather than transaction-only PgBouncer. Losing a refresh response after Google rotates a token can require reauthorization; there is no claim of transactional refresh across Google and PostgreSQL.

## Database and API changes

Additive migration `20261028223001_google_oauth_identity` adds nullable `WorkspaceIntegration.accountSubject` / `accountEmail` and `GoogleOAuthAttempt` (connection FK, unique state digest, created/expiry/consumed timestamps). Thirteen migrations are present. Existing IntegrationCredential, immutable integration audit, WorkflowVersion and HttpAttempt constraints remain in force. No resets or published-version changes were used.

| Method | Path                                                                    | Authentication                                                                           |
| ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/api/workspaces/:workspaceId/integrations/:integrationId/google/start` | Existing session + exact Origin + OWNER/ADMIN; current revision body                     |
| POST   | Same prefix `/google/refresh`                                           | Same checks; refresh only this verified provider connection                              |
| POST   | Same prefix `/google/disconnect`                                        | Same checks; local erasure then attempted remote revocation                              |
| GET    | `/api/integrations/google/callback`                                     | Existing session + one-time bound OAuth state, exact callback; no blanket CSRF exemption |
| GET    | Existing connection/list/provider APIs                                  | Existing workspace authorization; sanitized Google identity/setup metadata               |

Google availability is computed from configured client settings and operator provider state. Without setup, the cards retain Coming Soon and the detail explicitly says live authorization is unavailable; they never appear as fake connected accounts. A disabled provider remains disabled. No new public credential-read endpoint exists. Existing generic local revoke/remove controls retain their explicitly local semantics; use Google Disconnect for attempted remote revocation.

## Sheets capabilities

All three operations select a workspace-owned, authorized Sheets connection and use fixed `sheets.googleapis.com` endpoints. Spreadsheet IDs are bounded safe identifiers; ranges must include a sheet name and bounded A1 coordinates. Reads cover at most 100 rows and 26 columns. Writes target a single row and at most 26 scalar cells. Negative/backward, open-ended, invalid, unbounded, or oversized ranges are rejected.

Appends add one row; updates write one explicitly configured bounded row. Literal column values can be replaced by safe own-property input paths. Writes use `valueInputOption=RAW`, so text is not interpreted as a spreadsheet formula. There are no spreadsheet creation/deletion, tab deletion, bulk-clear, permission mutation, or Drive operations. Structured read output is `{range, rows}`; write output is the bounded Google operation result. Missing files, forbidden permissions, quota responses, invalid requests/ranges, expired authorization, invalid responses, and network failures produce fixed sanitized error codes. Values stay transient for downstream nodes; audits retain shapes only.

Reads may make at most three bounded attempts for transient 429/5xx or uncertain network/response failures. Writes never automatically retry, including ambiguous append/update outcomes. Reconcile the target sheet before deliberately starting another run after uncertainty.

## Gmail capabilities and anti-abuse

Gmail sends through `gmail.googleapis.com/gmail/v1/users/me/messages/send`. Sender is the verified authorized account; node JSON cannot choose another From identity. To supports 1–10 distinct plain email addresses. Subject is bounded to 200 characters without control characters; body is plain text, at most 6 KiB, with an additional compiled MIME limit of 9 KiB. Nodemailer performs MIME/Unicode encoding and line handling, with file/URL access disabled. Message-ID is stable per run/node for diagnosis, **not a Gmail deduplication guarantee**.

Subject/body may map from safe own-property dotted incoming-data paths. Mapped values are revalidated at execution. Recipients remain explicit configuration plus operator approval, preventing arbitrary workflow input from turning into an uncontrolled mailing list. No attachments, HTML, inbox read, label changes, deletion, alias management, or mailbox-wide access exists in this release. Literal HTML entered into the plain body is sent as text, not rendered HTML.

Email sending is default-off and requires an explicit approved-recipient list. A persistent workspace/provider hourly allowance caps Gmail at 20 operations and Sheets at 100, counting admitted uncertain operations conservatively. These are foundational controls rather than a full production abuse-detection service. Individual Google account/project quotas also apply. Provider error text, MIME bodies, recipients, sheet contents, and tokens are never copied into execution audits. Google message IDs/structured results may flow transiently to downstream nodes.

## Execution reliability, SSRF, and authorization

All Google actions use Task 5B durable intents before network requests. Run/node/attempt IDs, worker exclusion, cancellation checks, 60-second external graph budget and crash handling are reused. Non-GET provider operations receive one attempt only, regardless of HTTP-origin retry approvals; generic HTTP settings cannot turn on Gmail/write retries. A worker killed after sending is recovered as `WORKER_LOST_OUTCOME_UNKNOWN` / AMBIGUOUS without issuing the operation again. Invalid/oversized/uncertain provider responses after sending are conservatively reported as `GOOGLE_OUTCOME_UNKNOWN`. A remote operation can succeed before local persistence fails; this is not exactly once.

Provider URLs are constructed exclusively from trusted fixed endpoints and encoded validated IDs/ranges. There is no editable API base URL, arbitrary Gmail user ID, callback destination, token endpoint, proxy, or provider header override. Existing HTTPS-only, approved-origin, all-public-DNS-result validation, connection-time address pinning, TLS SNI/certificate verification, redirect refusal, timeout and size limits remain enabled. Form encoding is an internal transport option used for trusted OAuth endpoints; node configuration cannot introduce it or bypass HTTP validation.

OWNER/ADMIN manage Google consent/refresh/disconnect and publish versions; EDITOR may run versions explicitly published by management using approved workspace connections. VIEWER has metadata-only access. Membership, provider, workspace, state, scopes and encrypted identity are rechecked server-side. Cross-workspace connection references are rejected before credential use. Template copies retain normal tenant isolation and require destination-workspace connection rebinding; no credential grant is copied from a template author.

## Privacy, retention, and Google user-data policy

The integration retains verified Google subject/email, granted scopes, status/timestamps and encrypted access/refresh tokens. OAuth-attempt records retain opaque connection/digest/timing metadata; sensitive pending material is cleared on consumption/revocation and expires after five minutes. Routine execution audits contain data shapes and fixed codes, not sheet rows, recipients or email content. Workflow definitions/literal data and encrypted queued input still follow the existing workspace retention model; users must not put secrets in labels/definitions. Current pending input is cleared on terminal completion.

Disconnect/remove clears current credentials and Google identity; sanitized audit and consumed-attempt records remain for security/history until parent deletion under existing cascading policies. Production needs a documented retention/purge schedule, user data-deletion process, protected backups/WAL, access auditing, and removal of tokens from all managed secret/backup copies where required. Do not describe current-row clearing as erasure of backups or remote Google account data.

Before any public launch, provide accurate consent/privacy disclosures and operational deletion/support processes, review the current Google API Services User Data Policy and Limited Use requirements, and complete any applicable OAuth verification. Do not sell Google data, use it for unrelated advertising, or use it to train generalized AI models. This release does not implement production policy verification or certify compliance. Live consent configuration, policy classification, verification requirements, and organizational restrictions must be checked in the actual Google project.

## Verification

All tests use real PostgreSQL, Better Auth sessions, existing workers and the production Next.js build. The controlled fixture serves real TLS at loopback with generated temporary certificates; explicit **test-only preloads** map validated public Google endpoint addresses to that service while preserving TLS hostname/certificate checks. The fixture signs ID tokens with an ephemeral RSA key and serves corresponding verification certificates. Google’s real library verifies them through the same trusted-endpoint transport. The browser consent page is deliberately intercepted and labeled controlled; no browser or worker contacts real Google during these tests. There is no application environment flag enabling this mock or private-address destinations.

| Exact command                                                           | Result                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm install --save-exact google-auth-library@latest nodemailer@latest` | Installed pinned 11.3.1 and 10.2.1                                          |
| `npm install --save-dev --save-exact @types/nodemailer@latest`          | Installed pinned 8.0.2                                                      |
| `npm test`                                                              | **159 passed, 0 failed, 0 skipped**, preserving all 144 previous tests      |
| `npm run test:e2e`                                                      | **16 passed, 0 failed/skipped/flaky**, preserving all 14 previous scenarios |
| `npm run typecheck`                                                     | Passed                                                                      |
| `npm run lint`                                                          | Passed                                                                      |
| `npm run format:check`                                                  | Passed                                                                      |
| `npm run db:validate`                                                   | Passed                                                                      |
| `npm run db:migrate` / `npx prisma migrate status`                      | Thirteen migrations applied; schema up to date                              |
| `npm run build`                                                         | Passed production compilation, TypeScript and route generation              |

An initial combined browser run was interrupted after Google test records occupied a shared fixture’s previously empty connection slots. The new fixture now cleans up its own disposable Google connections; existing scenarios were not changed. The final complete run is the result reported above.

New automated coverage includes OAuth state/PKCE/offline consent, exact callbacks, invalid issuer/nonce/scopes/PKCE/expiry, concurrent single-use callbacks, separate provider scopes, verified identity/encrypted credentials, coordinated refresh/rotation, lost grants, refresh-vs-revoke fencing, tenant/role denial, MIME/recipient/header/range validation, real-worker Sheets read/append/update and Gmail sends, 401-driven refresh, quota handling/read-only retries, disabled sends/unapproved recipients/hourly limits, and SIGKILL recovery without duplicate sending. The original worker, webhook, SSRF and template tests remain unchanged and passing. Counts include Node parent test records as in previous reports.

Browser scenarios verify the configured Google setup card, actual session/state/callback flow against the fixture, identity/permissions, refresh/disconnect, sanitized read APIs, all four configuration panels, missing-connection feedback, immutable Gmail publication and successful execution through a separate worker. Screenshots are captured only for controlled test identities and contain no OAuth tokens or signing secrets:

- `google-Google-connection-m-a52ee-ainst-a-controlled-provider-chromium/google-connection-controlled.png`
- `google-Google-builder-conf-37249-on-preserve-tenant-security-chromium/gmail-worker-controlled.png`
- `google-Google-builder-conf-37249-on-preserve-tenant-security-chromium/sheets-builder-controlled.png`

Full test output: `.cache/task5c-tests.log` and `.cache/task5c-browser.log`; the complete 16-scenario browser JSON result is preserved in `.cache/task5c-all-e2e-results.json`. The two Google scenarios were also rerun after the final new-workflow copy adjustment (`npm run test:e2e -- e2e/google.spec.ts`); their most recent result is `.cache/e2e-results.json` / ignored `playwright-report/`. Screenshots are in ignored `test-results/`. No real Google success is inferred from these fixtures.

Final operational checks passed: `npx tsx .cache/integration-default-smoke.ts` confirmed the restarted default-off server omits local-test and rejects local-test connection creation. A scan of 28 client JavaScript artifacts found no actual vault/issuer/Google secret values or fixture-preload material. The local test adapter and live Gmail sending are disabled, real Google client credentials remain absent, and the ordinary application/worker were restarted after isolated test completion.

## Reproduction and remaining limitations

Use existing local setup, migrations and provider seed commands. Start `npm start` after `npm run build`; use `npm run worker` for normal operation. Stop ambient workers before tests, since the suites spawn their own real workers. Full historical regression needs the existing local-test adapter enabled explicitly with `npm run integrations:setup:local -- --enable-test-adapter` and a restarted server; disable it and restart afterward. Real Google credentials are not needed for automated tests: the Google browser suite starts its own controlled app on port 3001 and restores/stops its fixtures. Keep that port free. Do not use a production database for these tests. All workers must share the intended OAuth, send-policy, origin and vault configuration. During one targeted check, an ordinary worker was started too early and consumed a controlled-provider job without that configuration; it was stopped and the check rerun in isolation. Start the ordinary worker only after test completion.

**Live Google OAuth, token lifecycle, Sheets API connectivity and Gmail delivery are UNVERIFIED.** Missing items are a configured Google OAuth client/consent project, enabled APIs, compatible approved egress, a suitable consenting test account/file, and explicit permission for any live recipient. No public deployment or consent publication occurred. The implementation is verified against controlled providers only.

Other limits: one live primary connection per workspace/provider; no Picker or `drive.file` file-selection flow; bounded A1 rows/columns; explicit recipients and subject/body mapping only; plain text without HTML/attachments; no automatic reconciliation or resumable external side effects; production monitoring, quota tuning, retention automation, managed key deployment and Google verification remain outside this task. A service can process an email or sheet write before a network/process failure; inspect Google/the target sheet before starting a replacement run. Stop after Task 5C.
