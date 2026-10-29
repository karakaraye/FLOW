# Task 4 — Automation template library

**Verdict: PASS**

Verified on 28 October 2026 in the existing FLOW repository using PostgreSQL 17, the production-mode Next.js application, real Better Auth sessions, the existing visual builder, and real background-worker processes. No new dependencies, engine, builder, external integration, paid marketplace, deployment, or Task 5 work was introduced.

## Architecture and files

`src/lib/templates/contracts.ts` validates catalog metadata, engine schema, definitions, layout, example inputs, categories, slugs, search, and size limits. `catalog.ts` defines the seven honest built-in starters. `service.ts` implements public reads, restricted management, installation, and provenance queries. `http.ts` provides sanitized public read errors. Existing authenticated/origin-checked API infrastructure is reused.

Customer pages: `src/app/(app)/templates/page.tsx`, `[slug]/page.tsx`, and `loading.tsx`. Components: `src/components/templates/preview.tsx`, `install-button.tsx`, and `admin.tsx`. Restricted administration: `src/app/(app)/platform/templates/page.tsx`.

The read-only React Flow rendering from Task 3 was extracted into `src/components/builder/readonly-canvas.tsx` and reused by both previews and `run-canvas.tsx`. It uses the same custom node components and converters. The editor and worker were not replaced. Workflow detail lookup/rendering now displays source provenance. Public-site and dashboard copy distinguish available templates from future integrations.

Other changes: Prisma schema/two additive migrations; `scripts/seed-templates.ts`; `scripts/catalog-admin.ts`; package scripts; public, workspace, and platform API routes; `tests/templates-contracts.test.ts`, `templates-integration.test.ts`, `templates-cli.test.ts`; `e2e/templates.spec.ts`; README/ENGINE/VALIDATION and this report.

## Database models and migrations

- **PlatformAdministrator:** an explicit user binding with creation timestamp, separate from WorkspaceMember roles. User deletion cascades removal. No HTTP grant/revoke or automatic bootstrap exists.
- **AutomationTemplate:** unique fixed slug, private JSON draft, optimistic revision, DRAFT/PUBLISHED/ARCHIVED status, timestamps.
- **AutomationTemplateVersion:** immutable published content snapshot, version number, publication timestamp, parent relation. `(templateId, number)` is unique; `(id, templateId)` supports a composite provenance constraint. Snapshot content includes name, description, category, tags, schema version, definition, layout, source, requirements, inputs, outputs, and example input.
- **TemplateInstallation:** workspace, independent Workflow, source template/version, requesting user ID, idempotency key, identity node map, timestamp. `(workspaceId, idempotencyKey)` and workflow identity are unique. A composite FK requires the workflow to belong to that workspace. Another requires the source version to belong to its template. Source references are restricted from deletion while installations exist; workspace/workflow teardown cascades installation removal.

Migrations: `20261028165000_automation_templates` and `20261028170000_template_immutability`. Both are transactional. SQL triggers prohibit direct updates/deletes of published template versions, including accidental ORM calls. Parent teardown may cascade version deletion when not restricted by installation provenance. Positive revision/version checks are enforced.

An initial Prisma development-migration attempt needed a redundant composite unique constraint for its one-to-one relation. Prisma then refused its noninteractive unique-index warning even though Workflow.id is already globally unique. I also initially attempted the protection migration before the table migration existed. I checked the partial state, generated and reviewed an additive schema diff, marked only that new failed migration rolled back, and applied the corrected migrations. The protection function was replaced idempotently and the new migrations were wrapped in transactions. Existing tables/data were not reset, dropped, or deleted. Final migration deployment reports seven migrations and no pending migrations.

## Catalog and installation experience

Customers can browse cards, search published names/descriptions, filter all seven categories, reset filters, inspect details and requirements, pan/zoom/fit a read-only preview, and install without handling JSON. Category/search controls reset consistently with URL state. Empty, loading, error, viewer/read-only, and mobile layouts are provided.

Details show category/source/version, manual trigger, input requirements, expected behavior/output transformations, node count, engine schema, explicit limitations, and an optional example input. Previewing and installing do not execute a workflow. An install opens the existing editor; the customer configures/saves, validates, publishes, manually runs, and inspects genuine execution history. The workspace installation list links each copy and retains the original source version.

### Seeded catalog — exact capabilities

| Slug                    | Name/category                                            | Actual behavior                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-normalization`    | Data Defaults and Standardization / Data Processing      | Shallow-merges configurable literal defaults (`source=manual`, `status=new`, `reviewed=false`) into supplied data, then records a sanitized event. Does not trim, rename, coerce, transform case, or normalize formats. |
| `record-classification` | Conditional Record Classification / Business Operations  | Tests numeric `score > 50`; adds `classification=high` or `standard`; records an event. One supplied record, no bulk import.                                                                                            |
| `lead-qualification`    | Lead Qualification Prototype / Sales Operations          | Tests numeric `leadScore > 70`; adds `qualification=qualified` or `nurture`. No CRM lookup, lead storage, outreach, or messaging.                                                                                       |
| `expense-approval`      | Expense Approval Decision Prototype / Finance Operations | Tests numeric `amount > 1000`; adds `decision=review_required` or `within_threshold`. No real approval, currency conversion, payment, or financial record change.                                                       |
| `customer-priority`     | Customer Priority Routing Prototype / Customer Support   | Tests exact `priority == "urgent"`; adds `queue=priority` or `standard`. Does not assign tickets or notify anyone.                                                                                                      |
| `data-validation-audit` | Field Presence and Audit / Developer Tools               | Tests existence of `recordId`; adds `presence=present` or `missing`. A present null counts as existing. Not schema/type validation.                                                                                     |
| `daily-task-defaults`   | Task Intake Defaults / Productivity                      | Adds literal `stage=inbox`, `needsReview=true`, and records an event. Does not create a task in an external system.                                                                                                     |

All use manual_trigger, set_data, condition, and/or log_event only. Runtime audits retain shape/status/error codes, not raw transformed output values. Templates explicitly state this limitation and do not advertise integrations as operational.

`npm run db:seed:templates` validates sources before writing, publishes built-ins through the trusted local operator path, and skips existing slugs. Repeated seeding preserves admin edits, newer versions, and archives. It does not grant platform permissions. Catalog creation/seeding is bounded to 200 entries.

## Copy and installation correctness

Installation rechecks workspace membership and OWNER/ADMIN/EDITOR permission inside a transaction, serializes per workspace using the existing advisory-lock convention, locks source availability against concurrent archive, validates the immutable content again, enforces the existing workspace workflow limit, and atomically creates Workflow plus TemplateInstallation.

Each install gets a new private Workflow ID and an independent deep copy of definition/layout. Graph-local node identifiers remain stable: the engine builds fan-in objects keyed by parent ID, so renaming IDs could break a condition path such as `left.score`. A dedicated regression test verifies this case. These local identifiers are not shared database node records. Execution creates new globally unique NodeRun IDs under each independent run/workflow. The frozen identity node map and source-version FK preserve initial provenance.

Installation creates no WorkflowVersion and runs nothing. The customer must explicitly publish through the existing workspace API. The worker executes that private WorkflowVersion, not the shared source definition. Shared draft edits/publications/archives never silently update customer copies.

A required 8–100 character safe `Idempotency-Key` is unique per workspace. Same key/source version returns the same installation; a different source version with the same key returns 409. Six concurrent duplicate requests were tested to create exactly one workflow/installation. Retries of a previously successful install remain readable/replayable after archive, but fresh installs from any archived source version return 404. Viewer POSTs remain forbidden, including replay requests.

## Management and security

The separate `/platform/templates` interface supports validated draft creation/editing, explicit server validation, immutable publication, archive, and installation listing. Workspace OWNER/ADMIN membership does not confer catalog permission. Every management action checks the PlatformAdministrator row server-side; row locks protect concurrent revocation. Public API reads never use editable draft metadata and never return draft/archived entries. Search examines only the latest published snapshot, so unpublished name/description edits cannot leak through filters.

Trusted operator commands:

```sh
npm run catalog:admin -- grant <existing-user-id>
npm run catalog:admin -- revoke <existing-user-id>
```

These require existing database/operator access. Grant is idempotent, rejects unknown users, and is never inferred from email/domain, workspace role, signup input, or being the first user. Both commands were exercised automatically on a temporary fixture; no real user was granted platform permissions during setup.

Mutations retain session authentication, exact-Origin checks, JSON body limits, server validation, optimistic revisions, membership checks, and sanitized errors. Workspace list/detail queries scope provenance to authorized membership. Management installation listing returns bounded opaque IDs/timestamps, not customer workflow data or credentials. Published template/version deletion is not exposed as an API; archive is the supported withdrawal operation. Explicit publication can restore an archived entry; seed never silently restores it.

## API endpoints

| Method | Path                                                  | Permission / behavior                                                                               |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/templates?q=&category=`                         | Public; current published summaries only, literal case-insensitive name/description search          |
| GET    | `/api/templates/:slug`                                | Public; current published source/details; 404 for draft/archived/missing                            |
| GET    | `/api/workspaces/:workspaceId/template-installations` | Any workspace member; latest 100 own-workspace installations                                        |
| POST   | same workspace path                                   | OWNER/ADMIN/EDITOR; `{versionId}` and Idempotency-Key; independent draft; 201 with replay indicator |
| GET    | `/api/platform/templates`                             | PlatformAdministrator; bounded draft/status list                                                    |
| POST   | same platform path                                    | PlatformAdministrator; `{slug, content}`                                                            |
| GET    | `/api/platform/templates/:id`                         | PlatformAdministrator; private draft and latest 25 versions                                         |
| PATCH  | same detail path                                      | PlatformAdministrator; `{revision, content}`                                                        |
| POST   | `/api/platform/templates/:id/validate`                | PlatformAdministrator; validates current saved draft                                                |
| POST   | `/api/platform/templates/:id/publish`                 | PlatformAdministrator; `{revision}`; immutable snapshot                                             |
| POST   | `/api/platform/templates/:id/archive`                 | PlatformAdministrator; `{revision}`; hides entry and blocks new installs                            |
| GET    | `/api/platform/templates/:id/installations`           | PlatformAdministrator; latest 100 provenance records                                                |

## Automated checks — executed results

| Command                                                                                                                                                                   | Final outcome                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --output prisma/migrations/20261028165000_automation_templates/migration.sql` | Passed; reviewed additive DDL                                                                          |
| `npx prisma migrate resolve --rolled-back 20261028170000_template_immutability`                                                                                           | Passed; recovery of only the new failed migration                                                      |
| `npm run db:migrate`                                                                                                                                                      | Passed; seven migrations, no pending migrations on repeat                                              |
| `npm run db:generate`                                                                                                                                                     | Passed; Prisma Client 7.10.1 generated                                                                 |
| `npm run db:validate`                                                                                                                                                     | Passed                                                                                                 |
| `npm run db:seed:templates`                                                                                                                                               | Passed repeatedly; seven built-ins retained without overwrite                                          |
| `npm run typecheck`                                                                                                                                                       | Passed                                                                                                 |
| `npm run lint`                                                                                                                                                            | Passed, no warnings                                                                                    |
| `npm run format:check`                                                                                                                                                    | Passed                                                                                                 |
| `npm run build`                                                                                                                                                           | Passed; compilation, TypeScript, page generation, and route collection                                 |
| `npm start`                                                                                                                                                               | Production-mode application started; tests targeted it                                                 |
| `npm test`                                                                                                                                                                | **96 passed, 0 failed, 0 skipped**, including parent records; final full run took 17.1 seconds         |
| `npm run test:e2e`                                                                                                                                                        | **8 passed, 0 failed, 0 skipped, 0 flaky**; final full browser run took 39.5 seconds, retries disabled |

Node test breakdown: all original 78 preserved, plus 6 template-contract/conversion tests, 11 PostgreSQL/API/worker integration tests, and one trusted-permission CLI test. New coverage includes publication validation, direct version update/delete immutability, search/category filters, private draft non-disclosure, transactional duplicate install prevention, all workspace roles, cross-workspace foreign keys/list isolation, independent copies, later publication/archives, provenance, source ID/fan-in semantics, and immediate platform permission revocation.

Every seeded template was installed into a private workflow, explicitly published, and processed by a separate actual worker using its documented example input. Each completed SUCCEEDED with the expected node count and no failed nodes. An installed copy also executed successfully after its source was archived. The original worker crash/recovery and competing-worker tests continued to pass.

Back-to-back test runs once hit the intentional sign-in rate limit (429 rather than the foundation test's expected invalid-password 401). Protection was not disabled, rate-limit rows were not cleared, and existing tests were not weakened. After the actual cooldown expired, the complete 96-test run passed. Screenshot review also caught a reset-control display mismatch; remounting the filter form on URL-state changes and a browser assertion fixed it.

## Browser evidence

All five existing Task 3 scenarios passed unchanged. Three new Chromium scenarios cover:

1. Catalog search and exact category filtering; reset selection consistency; preview and minimap; install without raw JSON; edit the installed workflow visually; save, validate, publish; queue a real run; launch a separate worker; observe SUCCEEDED/SKIPPED NodeRuns; inspect actual history and installation provenance.
2. Viewer installation rejection through both UI and API; no catalog-management permission; responsive 390×844 catalog; search-empty state and no horizontal overflow.
3. Restricted platform-admin UI creates a private draft, validates, publishes version 1, edits without leaking unpublished changes, publishes version 2, lists installations, and archives. Fixture elevation is explicit and removed in teardown.

Final machine-readable report: `.cache/e2e-results.json`; start time `2026-10-28T15:57:55.789Z`, expected 8, unexpected 0, skipped 0, flaky 0. HTML report: `playwright-report/index.html`.

Screenshots retained in ignored local test output:

- `test-results/templates-catalog-search-v-c79fa-mization-and-real-execution-chromium/template-catalog.png`
- `test-results/templates-catalog-search-v-c79fa-mization-and-real-execution-chromium/template-detail.png`
- `test-results/templates-catalog-search-v-c79fa-mization-and-real-execution-chromium/installed-template-execution.png`
- `test-results/templates-viewer-cannot-in-7053c-ty-states-remain-accessible-chromium/mobile-template-catalog.png`

Desktop catalog/detail and mobile screenshots were inspected. Test-created users, permission grants, workspaces, copies, runs, and temporary catalog entries were removed by targeted teardown. The seven built-ins remain available. Browser binaries/reports, `.env`, dependencies, and generated outputs remain Git-ignored.

## Known limitations and scope

- These are manual supplied-data starters, not real integrations or business-system updates. Literal defaults do not implement general normalization, and field presence is not full data validation. Runtime output values are intentionally not exposed by the existing audit contract.
- Customer customization uses the existing builder's literal configuration controls; optional JSON input examples are references. No JSON is needed for installation. Platform catalog authors use a validated JSON content editor, not a second visual builder.
- Catalog is capped at 200 entries; workspace workflow limit remains 100. Catalog entries are read as bounded latest snapshots before filtering. Installation lists show latest 100; management version detail shows latest 25. Pagination/full-text indexing are deferred.
- Seed scripts preserve existing slugs/archives; tests expect a disposable development catalog with built-ins available. Do not run the suites against production or clear authentication protections to rerun quickly.
- Browser coverage is Chromium desktop/mobile viewport, not Firefox, WebKit, physical devices, or a complete assistive-technology audit.
- The existing atomic worker may expose QUEUED directly followed by terminal status rather than observable RUNNING; no status is invented.
- No Gmail, WhatsApp, Sheets OAuth, Paystack, OpenAI node, external HTTP action, third-party submissions, paid marketplace, production deployment, environment publication, or fresh-task restoration was performed. Existing email verification/recovery limitations remain. No Task 5 work was started.
