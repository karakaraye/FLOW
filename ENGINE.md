# Workflow engine (Task 2)

## Run locally

Apply migrations with `npm run db:migrate`, start the application with `npm run dev` (or `npm run build` then `npm start`), and run `npm run worker` in another terminal in this repository. Keep both running. Use the same database and authentication secret for both processes. No new packages or external queue services were added.

Visit Workflows, create and connect nodes visually (or import an existing JSON definition), save a draft, publish it as an OWNER or ADMIN, then queue a manual execution. History shows genuine persisted status, timings, errors, and per-node audit summaries. Pending run pages refresh every two seconds; the history list refreshes when reloaded. Definitions and history are scoped to your current workspace. Lists are limited to the latest 100 rows; version detail lists the latest 25 snapshots. Pagination is not included.

Working supplied-data templates are available; scheduling, webhooks, integrations, AI, and billing are not implemented. The React Flow builder now edits the same engine JSON without introducing another executor. The JSON example below documents the format; it is not an installed template or fake execution.

## Durable execution architecture

The existing PostgreSQL database is the queue. Redis/BullMQ would add an unnecessary service for four synchronous, bounded, database-only nodes. A separate Node/tsx worker polls every 500 ms. `WorkflowRun` admission commits before HTTP 202 is returned; closing a browser has no effect on the job.

A worker selects the oldest QUEUED row using `FOR UPDATE SKIP LOCKED`. Claim, node records, completion status, and encrypted-payload deletion commit in one transaction. Multiple workers can cooperate. If a worker/connection crashes before commit, PostgreSQL rolls back its claim and records; the job remains QUEUED for the next worker. There is no committed RUNNING state to become stranded. RUNNING is an internal transaction state; readers generally see QUEUED followed by SUCCEEDED or FAILED. `startedAt` and `finishedAt` are persisted at completion. This choice is appropriate for short, pure nodes and deliberately does not stream partial results.

There is at most one committed set of node results per admitted run, enforced by row locks and `(runId, nodeId)` uniqueness. Work may be recomputed after a rollback. This is not a general exactly-once guarantee for external side effects. Future HTTP/email/payment/integration nodes require a separate delivery and idempotency design; do not add them to this transaction blindly.

`npm run worker -- --once` processes at most one available job and exits. `--run-id <id>` limits polling to a selected queued run (used in the real process integration tests). SIGTERM/SIGINT finish current work before exiting. SIGKILL/connection failure rolls it back. Transaction errors keep jobs recoverable and retry after one second; infrastructure exception details are not logged.

## Definitions and node behavior

```json
{
  "schemaVersion": 1,
  "nodes": [
    { "id": "start", "type": "manual_trigger", "config": {} },
    {
      "id": "prepare",
      "type": "set_data",
      "config": { "values": { "score": 12 } }
    },
    {
      "id": "check",
      "type": "condition",
      "config": { "path": "score", "operator": "gt", "value": 10 }
    },
    { "id": "yes", "type": "log_event", "config": { "message": "Accepted" } },
    { "id": "no", "type": "log_event", "config": { "message": "Not accepted" } }
  ],
  "edges": [
    { "from": "start", "to": "prepare" },
    { "from": "prepare", "to": "check" },
    { "from": "check", "to": "yes", "branch": "true" },
    { "from": "check", "to": "no", "branch": "false" }
  ]
}
```

- `manual_trigger`: exactly one root; passes the admitted input onward.
- `set_data`: shallow-merges literal `config.values` into an object input. A non-object input starts from an empty object. Strings remain data; nothing is interpreted as executable code.
- `condition`: reads an own-property dotted object path (array traversal and prototype access are not supported). Operators are `equals`, `not_equals`, `gt`, and `exists`. Equality uses canonical structural JSON equality. `exists` does not require a comparison value. Missing fields fail for other operators; `gt` fails on a nonnumeric field. Each condition has exactly one true and one false outgoing edge.
- `log_event`: passes data through and records its successful NodeRun as the event. Its literal message remains in the authorized source definition; message contents are deliberately omitted from execution audits and stdout. It does not call an external logging service.

Execution uses a stable topological order with node-ID ordering for ties. Only edges from successful, active parents contribute. A node with no active incoming edge is SKIPPED. Joins use **any active parent**: a single active parent passes its output directly; multiple active parents produce an object keyed by parent ID in stable order. A failure stops further execution: all remaining nodes are SKIPPED, with a fixed reason code. The final output audit describes the last successfully executed node's data shape.

The validator rejects unknown fields/configuration, unsupported node types/schema versions, unsafe or duplicate IDs, missing/duplicate/invalid connections, extra triggers, disconnected nodes, invalid branch labels, and cycles. Prototype-related keys and paths are forbidden. There is no eval, user JavaScript, expression language, dynamic module loading, or network-capable executor.

## Models, publishing, and admission

- `Workflow`: tenant ownership, name, editable JSON draft, and optimistic `revision`.
- `WorkflowVersion`: immutable JSON snapshot; `number` is the draft revision being published, so gaps are possible. Re-publishing the same revision returns the same version.
- `WorkflowRun`: durable job, exact version, requesting user ID, idempotency key/hash, encrypted transient input, shape-only audit, status, timestamps, and fixed error code.
- `NodeRun`: unique node result per run, stable position/type, status, timestamps, sanitized input/output summaries, and fixed error code.

Migrations add the workflow tables, foreign keys/indexes, version update protection, and direct deletion protection. Published versions cannot be updated or directly deleted, including through accidental ORM calls. Parent workspace/workflow teardown may cascade deletion; no public deletion endpoint exists. A composite foreign key requires a run's version to belong to its workflow. Historical version definitions remain unchanged when drafts are edited. Editing and publishing require the expected revision and return 409 on stale state.

Admission serializes per workspace with a PostgreSQL advisory lock and per-workflow row lock. The database also enforces `(workflowId, idempotencyKey)` uniqueness. A required `Idempotency-Key` identifies a logical request. Identical version/input retries return the existing run even after it finishes. Reusing the key with different version/input returns 409. New intentional executions require a new key. Keys are scoped to the workflow and are not admission credentials.

## API and roles

All paths begin `/api/workspaces/:workspaceId`. Existing Better Auth sessions are required. Mutations require JSON and an exact Origin matching `BETTER_AUTH_URL`. Membership and roles are rechecked server-side inside the operation transaction, with membership locks protecting against concurrent revocation.

| Method | Path                     | Body                                                       | Roles                |
| ------ | ------------------------ | ---------------------------------------------------------- | -------------------- |
| GET    | `/workflows`             | —                                                          | All members          |
| POST   | `/workflows`             | `{ "name": "...", "definition": {...} }`                   | OWNER, ADMIN, EDITOR |
| GET    | `/workflows/:id`         | —                                                          | All members          |
| PATCH  | `/workflows/:id`         | `{ "revision": 1, "name": "...", "definition": {...} }`    | OWNER, ADMIN, EDITOR |
| POST   | `/workflows/:id/publish` | `{ "revision": 1 }`                                        | OWNER, ADMIN         |
| POST   | `/workflows/:id/runs`    | `{ "versionId": "...", "input": {} }` plus Idempotency-Key | OWNER, ADMIN, EDITOR |
| GET    | `/runs`                  | —                                                          | All members          |
| GET    | `/runs/:id`              | —                                                          | All members          |

Nonmembers and cross-workspace resources return 404. Anonymous requests return 401, insufficient roles 403, stale revisions/key conflicts 409, oversized data 413, and capacity limits 429. No API allows a caller to supply a trusted role or another requesting user's identity. Run responses exclude encrypted payloads, request hashes, and idempotency keys. Viewer controls are read-only in the dashboard and authorization also applies directly to the APIs.

## Limits and data protection

- 32 nodes, 64 edges, 32 KiB definition/output size.
- 16 KiB admitted input, 64 KiB streamed HTTP body, JSON depth 12 and 3,000 visited values.
- 100 workflows and 100 pending runs per workspace, enforced during admission transactions.
- 1-second execution budget checked around each bounded synchronous node; a 10-second transaction deadline; 4-second PostgreSQL statement timeout and 5-second idle transaction timeout. Infrastructure timeouts roll back and retain the queued job. These built-ins have bounded computation; this is not a sandbox for third-party executors.

Audit input/output JSON records data type and object/array counts only, never user values, keys, event messages, or arbitrary exception text. Node labels and workflow names are structural metadata: do not put credentials in them or in definitions. Condition failures store fixed codes such as MISSING_VALUE and TYPE_MISMATCH.

Transient queued input is authenticated-encrypted using AES-256-GCM with a key derived from `BETTER_AUTH_SECRET` and the run ID as authenticated context. It is removed on terminal completion and never returned by run APIs. Drain pending jobs before rotating this secret; otherwise old encrypted input cannot be decrypted and those runs fail with a sanitized error. An instance configured with the wrong secret must be corrected before starting its worker. Execution data is not a credential-storage feature.

## Verification

Stop ordinary workers before `npm test`; keep the application and PostgreSQL running. The suite spawns actual worker processes. It locks the audit table, waits for a worker to claim a run, kills that process with SIGKILL, verifies the rolled-back QUEUED row, and starts another worker that completes the same run. It also races two workers, tests concurrent admission, cross-tenant API/page access, all role actions, immutable snapshots, size/queue limits, successful and failed nodes, and branch skipping.

See `VALIDATION.md` for executed commands and results. This engine is suitable for the scoped local nodes; it is not a claim of production deployment readiness or support for external side effects.

## Task 3 canvas metadata

`Workflow.editor` and `WorkflowVersion.editor` store independently validated `{schemaVersion: 1, nodes: { [nodeId]: {x, y, label} }}` metadata. It is bounded to 12 KiB, matching node IDs, finite coordinates within ±100,000, and nonempty labels of at most 80 characters. Defaults preserve old workflows. Edits keep optimistic revision protection; publishing copies both definition and metadata into the existing immutable version. Layout-only changes can increment a draft revision, but do not change graph execution.

The added membership-authorized `GET /api/workspaces/:workspaceId/workflows/:workflowId/versions/:versionId` returns a specific source snapshot so run views can render historical graphs even after later edits. Run audit responses remain sanitized and do not include source definitions. Execution behavior is unchanged. The only engine-validator implementation adjustment uses `TextEncoder` instead of Node's `Buffer` for identical UTF-8 byte limits in both browser and server, tested with Unicode boundaries and all original 60 tests.

The client converter never puts labels, coordinates, selection, measured dimensions, zoom, or execution colors into engine JSON. All nodes retain their IDs; condition handles map directly to the existing `branch` property. See `TASK3_VALIDATION.md` for browser verification.

## Task 4 template copies

The shared catalog is a separate publication layer, not another execution engine. Only validated published AutomationTemplateVersion snapshots can install. Installation atomically creates an editable workspace Workflow draft and a provenance record; publication/execution then use the existing WorkflowVersion, admission, and worker contracts. Shared versions are never executed directly.

Graph-local node IDs are intentionally preserved across copies because fan-in data keys can be referenced by a condition path such as `left.score`. Changing those IDs could change execution semantics. JSON definitions and layouts are deep copies, Workflow IDs are unique, and NodeRun record IDs remain unique per run; no mutable node or execution record is shared between installations. An identity node map records source provenance. A regression test exercises a multi-parent join and its field path after copying.

Template status and platform catalog permission do not grant access to customer workflows. Source version references are retained for attribution, not looked up by the worker to execute customer runs. Archiving a source does not disable or overwrite existing customer copies. See TASK4_VALIDATION.md for the exact security and API design.

## Integration foundation

Task 5A adds encrypted workspace connection storage and metadata management, documented in [TASK5A_VALIDATION.md](TASK5A_VALIDATION.md). No external-action workflow nodes are registered. Future network side effects require a durable fenced/outbox design; the current pure-node transaction worker must not be assumed to provide external exactly-once effects.

## Task 5B external effects

The historical four-node transaction design above remains the pure-run path. Task 5B adds webhook_trigger and http_request to the same validator, traversal, builder, and queue. HTTP graphs persist intent and use per-run session advisory locks; worker loss terminates uncertain runs without silently resending. Webhooks authenticate raw signed deliveries before durable admission. Read [TASK5B_VALIDATION.md](TASK5B_VALIDATION.md) for the current protocol, key/policy configuration, recovery semantics, and tested guarantees. External effects are not exactly once.

## Task 5C Google adapters

Google Sheets read/append/update and Gmail send extend the same definition schema, shared traversal and external-attempt worker path. Scope-bound Google OAuth credentials use the existing vault; refresh coordination and revision fencing prevent revoked credentials from being restored. Reads may retry bounded transient failures; Gmail and Sheets writes never automatically retry. See [TASK5C_VALIDATION.md](TASK5C_VALIDATION.md). Controlled-provider execution is verified; live Google connectivity remains unverified.
