# Task 3 — Visual workflow builder

**Final status: PASS**

Verified on 28 October 2026 in the existing FLOW checkout using real PostgreSQL 17, the production-mode Next.js application, real Better Auth sessions, and separate Node background-worker processes. No second engine, mock execution, production deployment, or Task 4 work was introduced.

## Files created

- `src/components/builder/visual-editor.tsx`: React Flow canvas, palette, toolbar, actions, history, keyboard shortcuts, accessible connections, JSON import/export, and execution admission.
- `src/components/builder/engine-node.tsx`: custom node cards, handles, colors, summaries, and recorded-status highlights.
- `src/components/builder/node-panel.tsx`: label and literal configuration editing with shared-validator checks.
- `src/components/builder/run-canvas.tsx`: read-only immutable source snapshot with actual NodeRun statuses.
- `src/lib/builder/document.ts`: canvas/engine conversion, layout normalization, deterministic fingerprints, bounded undo/redo, connection and deletion operations.
- `src/lib/builder/metadata.ts`: server/client canvas metadata contract and limits.
- `src/app/(app)/workflows/new/page.tsx`: authorized visual workflow creation.
- `src/app/api/workspaces/[workspaceId]/workflows/[workflowId]/versions/[versionId]/route.ts`: tenant-authorized immutable source lookup.
- `prisma/migrations/20261028150940_visual_editor_metadata/migration.sql`: additive metadata columns on Workflow and WorkflowVersion, defaulting to `{}` for existing rows.
- `tests/builder-document.test.ts`, `tests/builder-service.test.ts`: conversion/history/component and real PostgreSQL persistence/security coverage.
- `e2e/fixtures.ts`, `e2e/builder.spec.ts`, `playwright.config.ts`: genuine browser login, workflow lifecycle, authorization/isolation, and mobile tests.
- This validation report.

## Files modified

- `package.json`, `package-lock.json`: React Flow **@xyflow/react 12.12.0**, Playwright **@playwright/test 1.64.1**, and useful browser/builder test scripts. No unrelated dependencies added.
- `prisma/schema.prisma`: independent `editor` JSON metadata on drafts and published versions.
- `src/lib/engine/service.ts`: validate/save metadata, snapshot it on publication, retain valid metadata for old JSON-only clients, and authorize specific version reads.
- `src/lib/engine/definition.ts`: portable UTF-8 byte counting using TextEncoder instead of Buffer. Validation rules and execution semantics are unchanged. Unicode boundary tests and all original 60 tests passed.
- `src/components/workflow-editor.tsx`: lazy-loaded client-only visual editor wrapper.
- `src/components/run-detail.tsx`, `src/app/(app)/history/[runId]/page.tsx`: load the exact executed snapshot and refresh its real recorded status.
- Workflow list/detail pages, dashboard copy, and public-site copy: visual editing is available; unimplemented capabilities remain labeled Coming Soon.
- `eslint.config.mjs`, `.prettierignore`: ignore generated browser reports, not application or test source.
- `README.md`, `ENGINE.md`, `VALIDATION.md`: current behavior, startup/testing instructions, and evidence. Existing `.gitignore` already excludes browser binaries, reports, results, dependencies, and `.env`.

## Editor features

- Native drag-and-drop node palette plus button/keyboard alternatives.
- Node selection, dragging, visual handle connections, deletion of nodes and incident edges, and independent edge deletion.
- Zoom, pan, fit view, background grid, and a functioning pannable/zoomable minimap.
- Undo/redo for graph/configuration/label/layout changes; a drag forms one history step. History is bounded to 50 local snapshots.
- Ctrl/Command S saves; Ctrl/Command Z undoes; Shift Z or Y redoes; Delete/Backspace removes selected graph items when focus is outside text fields. Native text-editing undo remains available inside fields.
- Unsaved/unapplied configuration indicators, save/publish guards, and native tab-close/reload protection. Selecting away from unapplied configuration asks before discarding it.
- Responsive palette, canvas, and configuration panel, labeled fields, keyboard connection form, keyboard-selectable graph nodes/edges, visible focus states, and read-only viewer controls. Desktop and 390×844 mobile viewport were exercised.

## Supported nodes

| Type             | Configuration                                                                   | Visual behavior                                                                      |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `manual_trigger` | Label only; engine config remains `{}`                                          | Teal card, output handle, manual-input purpose                                       |
| `set_data`       | Label and JSON object of literal values                                         | Blue card, input/output, field-count summary                                         |
| `condition`      | Label, dotted input path, equals/not_equals/gt/exists, literal comparison value | Amber card, input and explicitly labeled TRUE/FALSE handles                          |
| `log_event`      | Label and literal event message                                                 | Violet card, input/output, event summary; execution audits still omit message values |

There are no executable expressions, arbitrary code, unsupported node types, AI steps, or integrations.

## JSON and persistence design

The engine definition remains `{schemaVersion: 1, nodes, edges}`. IDs are generated once or preserved on import/load; changing labels never changes IDs. A condition's handle maps exactly to `edge.branch: "true" | "false"`. Canvas selection, dimensions, labels, positions, status colors, and viewport do not enter engine JSON.

Labels/positions live in separately validated `{schemaVersion: 1, nodes: {[id]: {x, y, label}}}` metadata. Metadata rejects unknown IDs/fields, prototype keys, non-finite/extreme coordinates, oversize data, and invalid labels. Draft updates retain revision conflict protection. Publishing copies both source and layout into the existing immutable version. Database immutability triggers still prohibit changes to either field on a published version. A run view resolves its pinned version, not the latest edited draft, so historical node highlights cannot be attached to a different graph.

The existing workflow, publishing, admission, and history APIs are reused. The one additional GET endpoint only reads an authorized immutable version. Membership, workspace scoping, role checks, CSRF/origin checks, idempotency, and durable queue behavior remain server-enforced. Viewer controls cannot create/edit/connect/publish/run, and direct API attempts return 403. Cross-tenant pages/source lookups return 404.

## Validation behavior

The browser uses the same graph validator as the server, including node/configuration checks. Node configuration is checked with that validator before applying it. The canvas shows a red validation message for an invalid graph and prevents saving/publishing until it is valid. Empty canvases explicitly identify the missing manual trigger. Import rejects duplicate IDs, invalid/unsupported nodes, disconnected/cyclic graphs, bad conditions, invalid edges, and missing configuration without replacing the current graph. Backend validation still independently authorizes and validates every save/publication.

Intermediate invalid graphs can exist locally while connecting nodes. They are not silently repaired or published, and are not persisted as invalid drafts under the existing backend contract.

## Exact commands and final results

| Command                                                                         | Final result                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm install --save-exact @xyflow/react`                                        | Passed                                                                               |
| `npm install --save-dev --save-exact @playwright/test`                          | Passed                                                                               |
| `npm run db:dev -- --name visual_editor_metadata`                               | Passed; additive migration applied, existing data preserved                          |
| `npm run db:generate`                                                           | Passed; Prisma Client 7.10.1 generated                                               |
| `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright npx playwright install chromium` | Passed; Chrome for Testing 156 and headless shell installed                          |
| Chromium launch check                                                           | Passed                                                                               |
| `npm run db:validate`                                                           | Passed                                                                               |
| `npm run db:migrate`                                                            | Passed; five migrations, no pending migrations                                       |
| `npm run typecheck`                                                             | Passed                                                                               |
| `npm run lint`                                                                  | Passed, no warnings                                                                  |
| `npm run format:check`                                                          | Passed                                                                               |
| `npm run build`                                                                 | Passed; compilation, TypeScript, prerendering, and route collection                  |
| `npm start`                                                                     | Started successfully; tests targeted this production-mode application                |
| `npm test`                                                                      | **78 passed, 0 failed, 0 skipped**, including parent records                         |
| `npm run test:e2e`                                                              | **5 passed, 0 failed, 0 skipped, 0 flaky**; final full browser run took 30.3 seconds |

Node-test breakdown: all **60 unchanged Task 2 tests** plus **18 new document/component/persistence tests**, including parent test records. These check conversion of real graphs and branch handles, layout/execution equivalence, undo/redo, deletion, metadata validation, UTF-8 compatibility, read-only/condition components, real metadata persistence, immutable published layouts, tenant isolation, role authorization, and JSON-client compatibility. The original suite continues to exercise actual worker processing, SIGKILL recovery, concurrent workers, and idempotent admission.

Initial browser failures exposed overlapping dropped-node placement, an unhelpful empty-canvas message, and missing minimap dimensions; those product defects were fixed. Test setup was also corrected to use stable node-ID locators and reuse real browser sessions while retaining authentication rate limits. The final result above is from a complete run of all five scenarios with retries disabled, not a zero-test or selected-test run.

## Browser E2E evidence

1. **Visual lifecycle:** authenticates through the login form; creates a workflow; adds nodes by click and native drag/drop; edits all configuration types and labels; drags connections including TRUE/FALSE; checks zoom/fit, all minimap nodes, dragging, undo/redo; saves/reopens exact IDs/layout; publishes; admits a real queued job; launches a separate actual worker and sees SUCCEEDED/SKIPPED NodeRuns; edits a new draft without changing the immutable version; then runs a real failure and verifies FAILED/MISSING_VALUE on the old snapshot.
2. **Invalid graphs:** rejects duplicate IDs, missing connections, unsupported node types, invalid conditions, cycles, bad targets, and missing required configuration; verifies deletion/undo and direct backend rejection.
3. **Viewer:** inspects existing nodes with read-only controls; cannot save, publish, or run through direct API requests; cannot open the creation route.
4. **Tenant isolation:** another tenant cannot load the builder or its published definition/layout endpoint.
5. **Mobile/keyboard:** 390×844 viewport; adds/configures nodes, connects using keyboard-accessible selects, saves with Ctrl S, reopens the draft, and verifies no page-wide horizontal overflow.

Final machine-readable browser report: `.cache/e2e-results.json` (start time `2026-10-28T15:26:37.111Z`, expected 5, unexpected 0, skipped 0, flaky 0). HTML report: `playwright-report/index.html`.

Captured screenshots, retained locally in ignored test outputs:

- `test-results/builder-visual-lifecycle-c-a86c7-cute-and-preserve-snapshots-chromium/visual-builder.png`
- `test-results/builder-visual-lifecycle-c-a86c7-cute-and-preserve-snapshots-chromium/executed-workflow.png`
- `test-results/builder-mobile-and-keyboard-controls-remain-usable-chromium/mobile-builder.png`

Desktop builder and mobile screenshots were inspected. Reports, browser binaries, test output, and credentials remain ignored; test teardown deletes only its own test users/workspaces and their child records.

## Known limitations

- Chromium desktop and a mobile viewport were verified. Firefox, WebKit, physical touch devices, and a full assistive-technology/accessibility audit were not performed.
- The existing atomic worker normally exposes QUEUED followed by a terminal status. RUNNING is supported when actually reported, but it may not be observable. The UI never fabricates per-node running states.
- Validation reports the first engine error; users resolve it and validate again. Invalid intermediate edits are local until made valid.
- Undo/redo is local to the open editor, not durable across reloads. Zoom/pan viewport is not persisted; node coordinates and labels are. General application navigation can discard unsaved local edits; save first. Tab-close/reload warnings and the builder's execution-history link protect the supported cases.
- Existing pagination limits, email verification/password recovery limitations, and lack of production deployment remain unchanged. No claim is made of published cloud snapshots or fresh-task restoration.
- Scheduling, webhooks, integrations, AI nodes, marketplace, and payments remain unimplemented/Coming Soon. No Task 4 work was started.
