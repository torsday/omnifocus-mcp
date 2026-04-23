# Spec: omnifocus-mcp

**Status:** Draft — assumptions flagged for review
**Date:** 2026-04-19

## Summary

An MCP (Model Context Protocol) server that exposes the full OmniFocus 3/4 feature surface to LLM agents running on macOS. Intended for a single-user, local-first workflow: one agent, one OmniFocus install, one user. The server shells to OmniFocus via JXA (primary transport) and OmniJS (fallback for features JXA can't reach), presenting a clean, typed, MCP-native tool + resource surface.

## Users

| User type    | What they can do                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| End user     | Connects the MCP server to Claude (or any MCP-compatible client) and asks the agent to read, query, create, and modify their OmniFocus data in natural language |
| Agent (LLM)  | Discovers tools/resources via MCP; invokes them to perform CRUD and query ops against OmniFocus; never sees raw JXA or URL schemes |
| Power user   | Enables opt-in raw-script tools (`OMNIFOCUS_ALLOW_RAW_SCRIPT=1`) to execute arbitrary JXA/OmniJS when the wrapped tools don't cover a need |

## Functional Requirements

Grouped by noun. Every requirement is testable against a live OF install (integration) and against an in-memory adapter (unit).

### Tasks

- [ ] List tasks with filters: project, tag, flagged, available, blocked, completed-since, due-before/after, deferred-before/after, parent
- [ ] Get a single task by persistent ID, including subtasks
- [ ] Get many tasks by ID list in a single call (`task_get_many`) — one JXA round-trip for up to 100 IDs; returns `Task[]` in the same order as the input; missing IDs noted in `meta.warnings`
- [ ] Create a task in the inbox, in a specific project, or as a subtask of another task
- [ ] Update any editable task property: name, note (plain + rich), flagged, due, defer, estimated minutes, tags (add/remove), sequential/parallel, completed-by-children
- [ ] Complete / uncomplete / drop / undrop a task
- [ ] **Delete** a task — hard removal, irreversible (distinct from `drop`, which is a reversible status change)
- [ ] Find a task by name — ambiguity-aware; returns all matches; explicitly not the default lookup (use `task_get` with an ID where possible)
- [ ] Move a task to a different project, folder, or parent task
- [ ] Reorder a task within its parent
- [ ] Duplicate a task (with `recursive: boolean` — recursive duplicates include subtasks)
- [ ] Parse transport text (`Project: task @tag //note ::defer !! #due`) into one or many tasks
- [ ] Set or clear a repetition rule (method × unit × steps × weekdays)

### Projects

- [ ] List projects with filters: folder, status (active / on-hold / done / dropped), flagged, review-due
- [ ] Get a single project by ID, including its task tree
- [ ] Create a project in the root or in a folder, with completion criteria (parallel / sequential / single-action)
- [ ] Update project name, note, status, completion criteria, flagged, review interval, next review date
- [ ] Complete / drop / move a project
- [ ] **Delete** a project — hard removal, irreversible (distinct from `drop`)
- [ ] Mark a project as reviewed (sets next-review-date from interval)

### Tags

- [ ] List tags (flat + hierarchical)
- [ ] Get a single tag by ID including task count
- [ ] Create a tag, optionally as a child of another tag
- [ ] Update tag name, status (active / on-hold / dropped), parent
- [ ] Delete a tag
- [ ] Set / clear a tag location (lat/lon/radius or named place) — **assumption: we expose this; flag if unused**

### Folders

- [ ] List folders with their project counts
- [ ] Get a folder by ID including its project and subfolder tree
- [ ] Create, rename, move, delete a folder

### Perspectives

- [ ] List all perspectives (built-in + custom)
- [ ] Evaluate a perspective by ID or name, returning the resulting task list — custom perspectives routed through OmniJS

### Forecast

- [ ] Get forecast-view tasks for a date range, configurable to include deferred, due, flagged, overdue

### Review

- [ ] List projects due for review, sorted by next-review-date
- [ ] Mark a project as reviewed
- [ ] Set review interval on a project

### Notes & attachments

- [ ] Read a task/project note as plain text or rich text (HTML round-trip)
- [ ] Set / append to a task/project note
- [ ] List attachments on a task
- [ ] Add an attachment from a local file path
- [ ] Remove an attachment
- [ ] Save an attachment to a local file path (never return bytes over MCP)

### Search

- [ ] Full-text search across name + note with filters (project, tag, completion status, date range)

### Batch

- [ ] Batch-create tasks (one JXA round-trip)
- [ ] Batch-update tasks
- [ ] Batch-complete tasks

### Export & import

- [ ] Export a project / folder / selection as TaskPaper _(lossy — TaskPaper can't represent attachments, HTML notes, custom perspectives, tag locations, or repetition rules beyond the simple cases; see `docs/domain-reference.md` for the lossiness matrix)_
- [ ] Export as OPML _(lossy — OPML represents structure + text only)_
- [ ] Import TaskPaper into a target container _(round-trip fidelity only for fields TaskPaper covers)_

### Sync

- [ ] Trigger an OmniFocus sync
- [ ] Query last sync time and status

### Raw escape hatch (opt-in)

- [ ] `run_jxa_script` — execute arbitrary JXA, return parsed JSON (disabled unless `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`)
- [ ] `run_omnijs_script` — execute arbitrary OmniJS, return parsed JSON (same gate)

### Prompts

MCP prompts are parameterized workflow templates surfaced to clients as slash commands or guided flows. They compose existing tools into repeatable sequences — the agent executes the steps, the prompt defines the script.

- [ ] `daily-review` — loads `omnifocus://snapshot`, `omnifocus://overdue`, and `omnifocus://forecast/today`; produces a prioritised triage prompt for the agent
- [ ] `weekly-review` — iterates `omnifocus://review-due` project by project; for each, presents tasks and asks the agent to mark reviewed or defer
- [ ] `capture-meeting` — accepts `notes: string` param; instructs the agent to extract action items and call `task_batch_create` with the results in a target project
- [ ] `project-planning` — accepts `name: string` and `brief: string`; instructs the agent to call `project_create` then `task_batch_create` to populate it with subtasks

### Resources

Read-only, enumerable via `resources/list`, cached same as tools. Resources let an agent load structured context without spending a tool call.

- [ ] `omnifocus://snapshot` — aggregate orientation: inbox count, overdue count, due-today count, flagged count, review-due count. The agent reads this first to decide what to work on.
- [ ] `omnifocus://inbox` — current inbox contents as `Task[]`
- [ ] `omnifocus://forecast/today` — today's forecast grouped by overdue / due-today / deferred-today / flagged
- [ ] `omnifocus://overdue` — all overdue tasks as `Task[]`, sorted by due date ascending
- [ ] `omnifocus://flagged` — all flagged available tasks as `Task[]`
- [ ] `omnifocus://review-due` — projects with `nextReviewDate ≤ today`, sorted by `nextReviewDate` ascending
- [ ] `omnifocus://project/{id}` — single project with full task tree
- [ ] `omnifocus://perspective/{id}` — evaluated perspective result (built-in or custom)
- [ ] `omnifocus://tag/{id}` — single tag with its task list

### Agent ergonomics

Cross-cutting requirements that make the MCP excellent for LLM agents specifically.

- [ ] **Mutation responses return the full updated domain object.** `task_create` returns the created `Task`; `task_update` returns the updated `Task`; `project_complete` returns the updated `Project`. Agents must never need a follow-up read after a write.
- [ ] **Name lookups return all matches with disambiguation context.** `task_find_by_name` and `search_query` return every matching item with its `id`, `projectId`, `projectName`, `status`, `dueDate`, and `tags`. Agents can choose the right match without a second call.
- [ ] **Tool descriptions follow the four-part standard** (see `DESIGN.md §6.8`): what it does, when not to use it, what it returns, side effects. Every description passes the LLM-readability review in Success Criteria.
- [ ] **Prompt injection resistance at the response boundary.** Task names, notes, and tag names from OmniFocus are treated as untrusted data. They are never interpolated into `suggestion`, `message`, or other metadata fields — only surfaced inside the typed `data` payload where agents expect content.

## Non-Functional Requirements

- **Performance:**
  - Cold `task_list` over a 5k-task database: < 1s p95
  - Cold `task_get` by ID: < 400ms p95
  - `forecast_get` (today): < 600ms p95 cold, < 50ms cached
  - Typical cached read: < 50ms
  - Write (`task_update`, single task): < 600ms p95
  - Batch write of 20 tasks: < 1.2s p95 (one JXA round-trip, not 20)
  - Server cold start to first `tools/list` response: < 500ms
- **Reliability:**
  - Typed error hierarchy (see `DESIGN.md` §6.7 for the authoritative list), grouped by remediation class:
    - Environment: `OmniFocusNotRunning`, `PermissionDenied`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`
    - Input: `ValidationError`, `NotFound`
    - Transient: `Timeout`, `RateLimited`, `QueueFull`, `CircuitOpen`
    - Infrastructure: `TransportUnavailable`, `ScriptError`
    - Lifecycle: `ServerShuttingDown`
  - Per-tool circuit breaker opens after 3 consecutive failures within 60s; half-open after 60s; caller gets `CircuitOpen` while open
  - Mutations are serialized via a single-slot write queue; reads use a small pool (default 2 concurrent `osascript` processes)
  - Write queue rejects with `QueueFull` after 50 queued items (default; configurable)
  - Reads never block on writes (dirty-read of cache is acceptable)
  - Every OF-bound call has a hard timeout (default 30s JXA, 45s OmniJS); `Timeout` surfaces with the transport in the error body
- **Security:**
  - Never log user task content (name, note, tag names) at `info` or higher; content is `debug`-only
  - Raw-script tools are opt-in (`OMNIFOCUS_ALLOW_RAW_SCRIPT=1`) and loudly flagged in their descriptions; every raw invocation is audit-logged at `info`
  - No network I/O from the MCP server itself; all traffic is OF → Omni Sync via OF, not us. Enforced by a lint rule that forbids importing `http`, `https`, `fetch`, `node-fetch`, `axios`, `undici`
  - No secrets persisted or requested by the MCP server
  - Attachment operations restrict paths to `$HOME` by default; override via `OMNIFOCUS_ATTACHMENT_PATHS` (colon-separated allowlist)
  - No writes to stdout at any log level (stdout is MCP transport); enforced by an integration test that hooks `process.stdout.write`
- **Observability:**
  - All logs structured JSON lines on stderr via `pino`
  - Every tool call produces one span line: `{ event, tool, durationMs, transport, cacheHit, result, code?, correlationId }`
  - Correlation ID is per-MCP-request; if the client supplies one, we reuse it, else we generate a ULID
  - `internal_status` tool surfaces counters, cache stats, and circuit states on demand
  - `OMNIFOCUS_LOG_LEVEL` env var for runtime tuning (`trace | debug | info | warn | error`, default `info`)
- **Compatibility:**
  - macOS 13+ (Ventura) — tested on 13, 14, 15
  - OmniFocus 3.15+ and 4.x
  - Node.js 20 LTS and 22 LTS
  - MCP SDK current stable at time of release
  - UTF-8 end-to-end; no locale-dependent string handling
- **Maintainability:**
  - 100% of tool handlers < 30 lines (pure delegation)
  - Every public service method has a docblock per `coding.md`
  - Goldilocks unit coverage: every service method has happy + edge + error tests
  - Integration tests gated behind `OMNIFOCUS_INTEGRATION=1`
  - Adapter contract tests assert `InMemoryAdapter`, `JxaTransport`, `OmniJsTransport`, and `TransportRouter` are behaviorally substitutable
- **Versioning & stability:**
  - Semver. Tool names, input schema required fields, and response envelope shape are the public contract
  - Additive changes (new tool, new optional field) are minor
  - Removals, renames, or changes to required fields are major and require a deprecation cycle
  - Deprecations logged at `warn` for one minor version before removal

## Out of Scope (v1)

- **Multi-user / multi-install** — one user, one OF database per server instance. No auth, no tenancy.
- **Remote MCP transport** — stdio only; SSE/HTTP transports deferred until a real need appears.
- **Streaming large results** — pagination via cursor-based `limit` + `cursor` args; no MCP streaming responses in v1.
- **Writing to an OmniFocus database file directly** — we only interact through JXA/OmniJS. Never touch SQLite.
- **Cross-platform** — macOS only. iOS/iPadOS control via the Mac is possible via sync but not our concern.
- **OmniFocus Pro vs Standard gating** — we expose the full surface; features that require Pro (custom perspectives, Forecast tag, AppleScript) return a typed `FeatureRequiresPro` error if the install doesn't have it.
- **Conflict resolution** — we assume OF handles sync conflicts; we surface errors but don't resolve them.
- **Undo** — OF has undo; we don't layer our own.
- **i18n of error messages** — English only for v1.
- **Persistent config file** — env vars only; `~/.config/omnifocus-mcp/` not read or written.
- **Idempotency keys on mutations** — single-user blast radius is small; revisit if multi-agent scenarios emerge.
- **OpenTelemetry / external metrics export** — stderr JSON logs are the contract. OTel deferred.
- **Automatic OmniFocus launch** — prefer explicit `app_launch` tool; surprise side-effects are unwelcome.
- **Database-level backup or restore** — OF handles its own backups.
- **Named plug-in wrappers** — only the generic `plugin_invoke` ships; specific plug-in wrappers deferred until named.
- **Atomic (transactional) batches** — best-effort batches with per-index error details; atomic batches require OF-side primitives not exposed by JXA.

## Key Flows

### Flow: Agent asks "what's on my plate today?"

1. Client invokes `get_forecast` with `{ date: "today", include_flagged: true, include_overdue: true }`
2. Service consults read cache; on miss, adapter runs `forecast_get.js` JXA script
3. Script returns JSON of tasks grouped by (overdue / due-today / deferred-today / flagged)
4. Service normalizes dates to ISO-8601-with-offset, maps to domain models, populates cache
5. MCP tool response returns structured task list

**Edge cases:** OF not running → `OmniFocusNotRunning` with `{ suggestion: "Launch OmniFocus and retry" }`. Cold cache + 10k tasks: < 2s acceptable once, cached thereafter.

### Flow: Agent bulk-creates 20 tasks in a project

Two distinct phases with different atomicity semantics:

1. Client invokes `task_batch_create` with `{ projectId, tasks: [...] }`
2. **Validation phase (atomic-all-or-nothing):** service validates every input against the zod schema. If _any_ input fails validation, the entire batch is rejected with a single `ValidationError` whose `details.failures` lists `{ index, field, reason }` per failure. No OF call is made.
3. **Execution phase (best-effort, not atomic):** adapter serializes the validated batch into one JXA call. The script creates each task in order, collects per-index results, and returns an array of `{ index, taskId? , errorCode? }`. If OF rejects task #7 mid-batch, tasks #1–#6 are created and tasks #8–#20 continue.
4. Service invalidates cache for that project; response payload is `{ created: [...], failed: [...] }` so the agent can see what succeeded and what did not.

**Edge cases:** 1 of 20 inputs has an invalid tag ID format → whole batch rejected during validation; no OF call. OF rejects task #7 due to a domain rule (e.g. reference to a deleted project) → tasks #1–#6 created, task #7 reports its error, tasks #8–#20 continue. Batches are **not** idempotent in v1 — a client that retries a partial failure may create duplicates.

### Flow: Agent updates a recurring task's repetition rule

1. Client invokes `task_update` with `{ id, repetition: { method: "due_again", unit: "weeks", steps: 2 } }`
2. Service validates the repetition schema (only known methods/units allowed)
3. Adapter runs `task_update.js` with the serialized rule
4. OF applies the rule; next occurrence computes automatically on completion
5. Cache invalidated for that task's project

**Edge cases:** Invalid combination (e.g. `weekdays` set on a non-weekly rule) → `ValidationError`. OF rejects the rule → `ScriptError` with OF's message.

### Flow: Cold start — first-ever call on a fresh install

1. Client sends `initialize` → server responds with capabilities and tool list
2. Client invokes first tool (e.g. `task_list`)
3. Adapter detects OF is not running → `OmniFocusNotRunning` with `{ suggestion: "Launch OmniFocus and retry" }`
4. User launches OmniFocus; agent retries
5. First `osascript` invocation triggers macOS Automation permission prompt — blocking dialog
6. User grants permission → `task_list` succeeds; subsequent calls do not prompt
7. User denies permission → `PermissionDenied` with `{ suggestion: "Open System Settings → Privacy & Security → Automation; grant this terminal / client access to OmniFocus" }`

**Edge cases:** Permission granted then later revoked → next call surfaces `PermissionDenied`; circuit breaker opens after 3 attempts; agent told to stop and ask user. Apple Automation prompt dismissed via keyboard shortcut rather than clicked → macOS treats as denial.

### Flow: Agent saves an attachment to disk

1. Client invokes `attachment_save_to_path` with `{ task_id, attachment_id, path }`
2. Service validates `path` is writable; rejects paths under `/System`, `/Library`, or outside `$HOME` (configurable)
3. Adapter invokes JXA to extract attachment bytes to the target path
4. Returns `{ saved: true, path, sizeBytes }`

**Edge cases:** Path unwritable → `ValidationError` (with reason). Attachment missing → `NotFound`. Disk full → `ScriptError` with `reason: "disk_full"` (OS-level IO failure bubbles up through the adapter).

## Technical Notes

- **Language / runtime:** TypeScript 5.x on Node.js 20 LTS
- **MCP SDK:** `@modelcontextprotocol/sdk` (official)
- **Validation:** `zod` for tool input schemas, `zod-to-json-schema` for MCP tool definitions
- **Testing:** `vitest` for unit, same runner with `OMNIFOCUS_INTEGRATION=1` gate for integration
- **Lint/format:** `biome`
- **Bundler:** `tsup` (single-file output for easy distribution)
- **Packager:** `pnpm`
- **Logging:** `pino` to stderr (stdout is MCP)
- **Transport to OF:**
  - JXA via `child_process.execFile("osascript", ["-l", "JavaScript", ...])`
  - OmniJS via `open "omnifocus:///omnijs-run?script=..."` + filesystem callback for result _(exact URL form verified in M0 OmniJS spike)_

See `DESIGN.md` for architecture, and `docs/adr/*.md` for load-bearing decisions.

## Resolved decisions (v1 defaults)

Previously open; now committed with safe defaults that can be changed without breaking users:

| Decision                  | v1 default                                                                 | Revisit trigger                              |
| ------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Tag locations             | Exposed (`tag_set_location`, `tag_get_location`)                           | Evidence tag locations are never used        |
| Plug-in invocation        | Generic `plugin_invoke` via OmniJS; named-plug-in wrappers deferred        | User names a plug-in they want wrapped       |
| Rich-text notes           | `noteHtml` read + write shipped (round-trip fidelity)                      | HTML proves unreliable in OF's note field    |
| Batch atomicity           | Best-effort; per-index failure details returned; **not** atomic on OF-side | Demand for transactional batches             |
| Cache TTL default         | 30s; override via `OMNIFOCUS_CACHE_TTL_MS`                                 | Measured evidence 30s is wrong               |
| Attachment size cap       | 100 MB; override via `OMNIFOCUS_MAX_ATTACHMENT_MB`                         | User hits the cap                            |
| MCP client target         | Claude Desktop primary; Claude Code secondary; any stdio MCP client works  | New transport appears (SSE, HTTP)            |
| Distribution              | `npx @torsday/omnifocus-mcp` and `npm install -g`; Homebrew / DXT deferred | Demand or simpler install channels appear    |
| Telemetry                 | Structured JSON logs on stderr only; OpenTelemetry deferred                | Production use requires metrics/traces       |
| Rich-text note body shape | HTML fragment (not full document); UTF-8 throughout                        | OF changes its note storage model            |
| Config hierarchy          | Env vars only for v1; no config file                                       | User requests persistent settings            |

## Open Questions — all resolved

All spec-level questions are closed. Remaining uncertainty is empirical (measured during implementation) and is tracked in [GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues?q=is%3Aissue+label%3Aspike) under the `spike` label.

| Closed question                                  | Answer                                                                                                              | Design effect                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Primary daily workflow                           | All four — daily triage, bulk intake, ad-hoc queries, weekly review                                                 | No single tool area gets polish priority; M5 spreads effort evenly             |
| Named plug-in wrappers                           | None — generic `plugin_invoke` is sufficient                                                                         | `plugin_invoke` stays generic; drops from P2 to P3                              |
| Email intake (Mail Drop / `omnifocus://` URL)    | Not in this user's workflow                                                                                          | No email-intake section in docs; no email-shaped tools                          |
| Custom perspectives                              | Rich set; "I live in them"                                                                                          | **OmniJS transport promoted:** built no later than M2 (was M4); perspective evaluation over OmniJS is first-class, not a late addition |

## Success Criteria

- [ ] All functional requirements pass integration tests against a seeded live OF install
- [ ] All tool descriptions pass an "LLM-readability" review — a fresh Claude instance can correctly pick the right tool for each of 20 representative prompts without additional context
- [ ] `pnpm test` runs green with mocked adapter in under 10s
- [ ] `pnpm test:integration` runs green against a live OF in under 2 min
- [ ] No stdout output from the server at any log level
- [ ] Raw-script tools are unreachable unless the env var is explicitly set
- [ ] `task_list` over 5k tasks returns in under 1s p95 (cold)
