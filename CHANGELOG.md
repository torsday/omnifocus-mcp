# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

## [Unreleased]

### Added

- **`project_update` safety primitives** — fourth vertical-slice adoption under #138 / #142 / #139, following the `task_delete` / `project_delete` / `task_update` slices (#246). Input schema gains optional `expectedModifiedAt`, `dry_run`, and `idempotency_key` alongside the existing patch fields. Handler pre-fetches the project via `adapter.getProject` (yielding `modifiedAt` for the concurrency guard), then composes `withIdempotencyKey → getProject → assertNotModifiedSince → dryRunGuard(preview, live)`. Dry-run returns the existing `{ updated: true, id }` envelope with `meta.dryRun = true` and `meta.syncPending = false`; live runs `adapter.updateProject` and invalidates project cache scopes. ([#246](https://github.com/torsday/omnifocus-mcp/issues/246))
- **`task_update` safety primitives** — third vertical-slice adoption under #138 / #142 / #139, following the #240 `task_delete` and #242 `project_delete` slices (#244). `task_update` is the highest-frequency mutation surface: optimistic concurrency keeps patches from overwriting concurrent edits, dry-run lets agents preview the patched task before committing, and idempotency keys make transport-level retries safe even on partial writes. Input schema gains optional `expectedModifiedAt`, `dry_run`, and `idempotency_key` alongside the existing patch fields. The preview envelope merges the supplied patch onto the pre-fetched task (including additive `addTags` / `removeTags` resolution) so the caller sees every field that would change without mutating the adapter. Composition mirrors the reference slice: `withIdempotencyKey → getTask → assertNotModifiedSince → dryRunGuard(preview, live)`. ([#244](https://github.com/torsday/omnifocus-mcp/issues/244))
- **`project_delete` safety primitives** — second vertical-slice adoption under #138 / #142 / #139, following the #240 `task_delete` pattern (#242). `project_delete` has an even larger blast radius than `task_delete` — cascade-removes every contained task — so the primitives pay for themselves here too. Input schema gains optional `expectedModifiedAt`, `dry_run`, and `idempotency_key`; handler now pre-fetches the project via `adapter.getProject` to feed both the concurrency guard and the cached cascade expectations. Composition mirrors the reference slice: `withIdempotencyKey → getProject → assertNotModifiedSince → dryRunGuard(preview, live)`. Dry-run leaves the project and its contained tasks untouched; replays of a dry-run return the preview envelope even if a later call flips `dry_run` off under the same key. ([#242](https://github.com/torsday/omnifocus-mcp/issues/242))
- **`task_delete` safety primitives** — reference vertical slice composing all three foundation primitives on the highest-risk mutation surface (#240). Input schema gains three optional fields: `expectedModifiedAt` (ISO-8601; rejects the call with `OF_CONFLICT` if the task's current `modifiedAt` differs, without touching the adapter); `dry_run` (returns a preview envelope with `meta.dryRun = true` and `meta.syncPending = false`, performs no mutation or cache invalidation); `idempotency_key` (coalesces retries under the same key, replaying the stored envelope — success *or* dry-run — with `meta.idempotentReplay = true`). Order of operations in `handleTaskDelete`: pre-fetch → concurrency guard → `withIdempotencyKey(…, dryRunGuard(…))`. The pattern other mutation tools under #138 / #142 / #139 will copy. ([#240](https://github.com/torsday/omnifocus-mcp/issues/240))
- **`assertNotModifiedSince` guard** — foundation primitive for the optimistic-concurrency surface (#139). `assertNotModifiedSince(expected, observed, resource)` normalises both ISO-8601 timestamps via `Date.parse` before comparing, so equivalent-but-differently-formatted values (`Z` vs `+00:00`, millisecond precision) match. Divergence throws `ConflictError` (`OF_CONFLICT`) with `details: { resource, expected, observed }`; malformed input throws `ValidationError`. When `expected` is `undefined` the guard is a no-op, matching the opt-in passthrough convention of `dryRunGuard` / `withIdempotencyKey`. No tool surfaces are wired yet — per-tool adoption tracks under #139. ([#238](https://github.com/torsday/omnifocus-mcp/issues/238))
- **`dryRunGuard` + `meta.dryRun`** — foundation primitive for the dry-run surface (#142). `dryRunGuard(dryRun, preview, fn)` wraps a mutation: when `dryRun === true` it invokes `preview()` (sync or async) instead of `fn()` and returns the envelope with `meta.dryRun = true` and `meta.syncPending = false`; otherwise it runs `fn()` verbatim. Error envelopes from `preview` are stamped too — validation rejected at preview time is still a dry-run outcome. `markDryRun` is exported for tools that construct the preview envelope deeper in their flow. `ResponseMeta` gains the optional `dryRun` field. No tool surfaces are wired yet — per-tool adoption tracks under #142. ([#236](https://github.com/torsday/omnifocus-mcp/issues/236))
- **`IdempotencyStore` + `withIdempotencyKey`** — foundation primitive for the idempotency-key surface (#138). `IdempotencyStore` is an LRU+TTL store keyed by caller-supplied idempotency key, with env-tuned capacity (`OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES`, default 1024) and TTL (`OMNIFOCUS_IDEMPOTENCY_TTL_MS`, default 600_000). `withIdempotencyKey(store, key, fn)` wraps a mutation: first call executes `fn` and caches the full `ToolEnvelope` (success or error); later calls within TTL replay verbatim with `meta.idempotentReplay = true`; concurrent callers coalesce onto a single in-flight promise (write-side analogue of #22's read-cache coalescing). No tool surfaces are wired yet — per-tool adoption tracks under #138. `ResponseMeta` gains the optional `idempotentReplay` field. ([#234](https://github.com/torsday/omnifocus-mcp/issues/234))
- **Transport chaos harness** — `tests/chaos/chaosSpawner.ts` vends a parameterised `ScriptSpawner` for every DESIGN §19 failure mode (OmniFocus not running, automation permission denied, hard timeout, malformed JSON, `osascript` ENOENT, empty stdout, unclassified script error). `tests/chaos/transport.chaos.test.ts` drives both `JxaTransport` and `OmniJsTransport` through each mode and asserts the domain-level outcome is the correct typed error (`OmniFocusNotRunning`, `PermissionDenied`, `Timeout`, `ScriptError`, `TransportUnavailable`) with the expected `code`, `remediationClass`, and a non-empty `suggestion`. Composes with `CircuitBreaker`: a sustained-failure test verifies the circuit opens after `failureThreshold` failures and the next call fast-fails with `CircuitOpen`, and a recovery test shows a successful half-open probe closes it again. Unit-tier; never touches real `osascript`. ([#31](https://github.com/torsday/omnifocus-mcp/issues/31))
- **`run_jxa_script` / `run_omnijs_script`** — opt-in raw escape-hatch MCP tools (ADR-0004). Off by default; registered only when the server is started with `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`. Each tool accepts `{ script, arg? }` and returns `{ result }` (arbitrary JSON). Every invocation emits a `raw_script.invoked` audit event at `info` with the full script body and tool name (DESIGN §21). Descriptions carry prominent `⚠ DANGEROUS` warnings and route agents back to the typed tools. Adapter interface's optional `runJxaScript` / `runOmniJsScript` methods now accept an optional `arg` argument; `JxaTransport`, `OmniJsTransport`, and `TransportRouter` updated to forward it. ([#75](https://github.com/torsday/omnifocus-mcp/issues/75))
- **`task_duplicate`** — new MCP tool that clones a task. Editable fields (name, note, defer/due, flagged, tags, estimate, repetition, sequential, completedByChildren) copy over; system fields (id, timestamps) regenerate; completed/dropped state is reset so the clone is a fresh, active task. `recursive: true` walks the subtask subtree depth-first. Default placement is alongside the source; optional `destination: { projectId } | { parentId } | { toInbox: true }` override. Adds `duplicateTask(id, opts)` to the adapter interface with `InMemoryAdapter` and `JxaTransport` wired; `OmniJsTransport` stubbed `notYetWired`. Contract harness gains a `tasks — duplicate` block covering default placement, recursive descendants, destination reparenting, and completed-state reset. Cache invalidates source and destination project scopes. ([#222](https://github.com/torsday/omnifocus-mcp/issues/222))
- **Cache: thundering-herd coalescing** — concurrent `wrap(key, factory)` calls for the same key now collapse to one factory invocation; later callers join the first's promise (DESIGN §16). `CacheStats` gains a `coalesced` counter surfaced via `internal_status`. Factory rejections are not cached; `invalidate()` during flight uses a per-call symbol token so a stale post-invalidate value cannot land in the cache. ([#22](https://github.com/torsday/omnifocus-mcp/issues/22))
- **`task_reorder`** — new MCP tool that positions a task among its siblings. OmniFocus has no numeric sibling index; position is expressed relative to another task (`before` / `after`) or as absolute `at: "start" | "end"` within an explicit `in:` container (`{ projectId } | { parentId } | { inbox: true }`). `{ at, in }` against a different container reparents the task. Adds `reorderTask(id, position)` + `TaskPosition` to the adapter interface with `InMemoryAdapter` and `JxaTransport` wired; `OmniJsTransport` stubbed `notYetWired` (consistent with `moveTask`). Contract harness gains a `tasks — reorder` block exercising before/after/start/end and cross-parent validation. Cache invalidates both source and destination project scopes. ([#221](https://github.com/torsday/omnifocus-mcp/issues/221))
- **`task_move`** — new MCP tool that reparents a task to a different project, another task (as a subtask), or the inbox. Exactly one of `projectId`, `parentId`, or `toInbox: true` must be set; mismatched destinations throw `ValidationError`. Idempotent: returns `noChange: true` when the task is already at the destination. Cache invalidates both source and destination project scopes. ([#41](https://github.com/torsday/omnifocus-mcp/issues/41))
- `LifecycleManager` — lazy OmniFocus detection + version gate (DESIGN §17). Single-flight probe that caches `{ ofVersion, ofEdition }` on first success, emits one `of.detected` log event, and exposes `checkMinimumVersion(minimum, featureName)` that throws `FeatureRequiresOfVersion` (`OF_FEATURE_REQUIRES_VERSION`) when detected OmniFocus is older than required. Does not poison the cache on probe failure. ([#25](https://github.com/torsday/omnifocus-mcp/issues/25))
- Adapter contract test harness — parameterized suite at `tests/contract/adapter.contract.ts` that every `OmniFocusAdapter` implementation must satisfy. Covers CRUD on tasks/projects/tags/folders, filter semantics (`listTasks`/`listProjects`/`listTags`/`listFolders`), and the typed error taxonomy (`NotFound`, `ValidationError`). Wired green against `InMemoryAdapter` in the unit tier (`tests/contract/inMemory.contract.test.ts`); the same suite is runnable against `JxaTransport` / `OmniJsTransport` / `TransportRouter` from the integration tier. `tests/README.md` documents the layout. ([#30](https://github.com/torsday/omnifocus-mcp/issues/30))
- `ReadPool` / `WriteQueue` — concurrency primitives per ADR-0009 / DESIGN §16. `ReadPool` is a FIFO-fair bounded-concurrency semaphore (`OMNIFOCUS_READ_POOL_SIZE`, default 2). `WriteQueue` is a single-slot strictly-serial queue with soft-cap backpressure (`OMNIFOCUS_WRITE_QUEUE_CAP`, default 50) that throws `QueueFull` (`OF_QUEUE_FULL`) synchronously when saturated; the same class backs the separate OmniJS queue. Both implement `DrainableQueue` so the shutdown controller can drain them. ([#20](https://github.com/torsday/omnifocus-mcp/issues/20))

See [GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues) and [Project #4](https://github.com/users/torsday/projects/4) for the live backlog and status.

---

## [1.0.0] — Unreleased

> **Status:** Pre-release. All features listed here are implemented and tested.
> Version will be bumped to 1.0.0 at the formal release cut.

### Added

#### MCP Tools — Tasks

| Tool | Description |
|------|-------------|
| `task_list` | List tasks with rich filters (project, tags, flagged, available, completion, date ranges, sort, cursor pagination) |
| `task_get` | Fetch a single task by persistent ID with optional subtask tree |
| `task_get_many` | Bulk-fetch up to 100 tasks by ID in one round-trip |
| `task_find_by_name` | Find tasks by name (names are not unique; returns all matches) |
| `task_create` | Create a task in the inbox, a project, or as a subtask |
| `task_update` | Partial-patch mutable task fields; tag diff mode (addTags/removeTags) |
| `task_delete` | Permanently delete a task (irreversible) |
| `task_complete` | Mark a task complete |
| `task_uncomplete` | Mark a completed task incomplete |
| `task_drop` | Drop (soft-delete) a task |
| `task_undrop` | Restore a dropped task |
| `task_set_repetition` | Set the repetition rule (method, unit, steps, weekdays, monthlyAnchor) |
| `task_clear_repetition` | Remove the repetition rule from a task |
| `task_parse_transport_text` | Parse OmniFocus transport-text DSL into structured task data |

#### MCP Tools — Projects

| Tool | Description |
|------|-------------|
| `project_list` | List projects with filters (folder, status, flagged, sort, cursor pagination) |
| `project_get` | Fetch a single project with optional task tree |
| `project_create` | Create a project (folder, completion criterion, defer/due, flagged) |
| `project_update` | Partial-patch mutable project fields |
| `project_delete` | Permanently delete a project and all its tasks (irreversible) |
| `project_complete` | Mark a project complete |
| `project_drop` | Drop (soft-delete) a project |
| `project_move` | Move a project to a different folder |
| `project_mark_reviewed` | Record a project review and set the next review date |

#### MCP Tools — Folders

| Tool | Description |
|------|-------------|
| `folder_list` | List folders, optionally filtered by parent folder |
| `folder_get` | Fetch a single folder with project/subfolder counts |
| `folder_create` | Create a folder, optionally nested |
| `folder_update` | Rename a folder |
| `folder_delete` | Delete a folder (cascade option for projects/subfolders) |
| `folder_move` | Move a folder to a new parent |

#### MCP Tools — Tags

| Tool | Description |
|------|-------------|
| `tag_list` | List all tags, optionally filtered by parent or status |
| `tag_get` | Fetch a single tag with task count |
| `tag_create` | Create a tag, optionally nested |
| `tag_update` | Rename a tag |
| `tag_delete` | Hard-delete a tag (irreversible) |
| `tag_move` | Move a tag to a new parent |
| `tag_set_status` | Set tag lifecycle status (active / on-hold / dropped) |
| `tag_set_allows_next_action` | Enable/disable next-action eligibility for a tag |
| `tag_get_location` | Read the geographic location trigger on a tag |
| `tag_set_location` | Set a geographic location trigger (OmniFocus Pro) |

#### MCP Tools — Notes

| Tool | Description |
|------|-------------|
| `note_get` | Read the plain-text note from a task or project |
| `note_get_html` | Read the HTML note (formatting-fidelity variant) |
| `note_set` | Replace the plain-text note on a task or project |
| `note_set_html` | Replace the HTML note |
| `note_append` | Append text to an existing note |

#### MCP Tools — Search & Perspectives

| Tool | Description |
|------|-------------|
| `search_query` | Full-text search across task names and notes with optional filters and cursor pagination |
| `perspective_evaluate` | Evaluate a built-in perspective and return matching tasks (Inbox, Today, Flagged, etc.) |

#### MCP Tools — Sync & Observability

| Tool | Description |
|------|-------------|
| `sync_trigger` | Initiate an OmniFocus sync with Omni Sync Server |
| `sync_status` | Return the last sync state without triggering a new sync |
| `internal_status` | Return server health snapshot: uptime, OF running state, last sync, circuit-breaker states |

#### Domain

- **Branded ID types** (`TaskId`, `ProjectId`, `FolderId`, `TagId`) prevent cross-kind ID confusion (ADR-0008)
- **ISO-8601 with offset** date strings at all adapter boundaries (ADR-0007)
- **`RepetitionRule`** Zod schema with cross-field validation (weekdays ↔ weeks, monthlyAnchor ↔ months)
- **`_links` navigation hints** on `Task` and `Project` — `omnifocus://noun/id` URIs for self, related project, parent, tags, and folder; agents can pass links directly to `resources/read`

#### Infrastructure

- **ADR-0013 uniform envelope** — every tool returns `{ data, meta }` on success and `{ error, meta }` on failure
- **`ResponseMeta`** fields: `correlationId`, `durationMs`, `cacheHit`, `transport`, `ofVersion`, `syncPending`, `warnings`, `rateLimit`
- **Structured `Warning` codes**: `WARN_IDS_NOT_FOUND`, `WARN_RESULT_TRUNCATED`, `WARN_SYNC_PENDING`, `WARN_DEPRECATED_FIELD`, `WARN_DRY_RUN`, `WARN_LOOP_DETECTED`
- **Typed error hierarchy**: `NotFound`, `ValidationError`, `PermissionDenied`, `OmniFocusNotRunning`, `Timeout`, `RateLimited`, `CircuitOpen` — each with `suggestion` and `remediationClass`
- **30s LRU read cache** invalidated on every mutation (ADR-0006)
- **Per-tool sliding-window rate limiter** (default 120 calls / 60s) with `meta.rateLimit` state on every response
- **Loop-detection middleware** — `WARN_LOOP_DETECTED` in `meta.warnings` after ≥5 identical `(tool, args)` calls within 60s (DESIGN §6.11)
- **Cursor pagination** with `filterHash` validation — swapping filters mid-sequence fails loud
- **Attachment guards**: `assertAttachmentPath` (allowlist + symlink-escape protection) and `assertAttachmentSize` (configurable cap)
- **Stdout guard** — stray writes to stdout raise an error (MCP uses stdio; any byte corrupts the protocol)

#### Developer Experience

- `docs/tools.md` — generated reference catalog (34 tools) with parameter tables, example calls, and example responses; `pnpm docs:check` CI gate keeps it current
- `docs/troubleshooting.md` — Permission Denied recovery runbook for macOS Ventura/Sonoma/Sequoia/Monterey
- Property-based test suites (fast-check) for cursor codec, `RepetitionRule` schema, and transport-text parser
- Snapshot tests locking all tool descriptions; lint enforces four-section shape (what / when-not / returns / side-effects)

### Breaking Changes

_None. This is the initial stable public release._

### Security

- Attachment path validator blocks symlink escape attempts and hard-denies `/System`, `/Library`, `/private/System`, `/private/Library`
- `OMNIFOCUS_ALLOW_RAW_SCRIPT` env var required to enable `run_jxa_script` / `run_omnijs_script` escape-hatch tools (opt-in, off by default — ADR-0004)
- Config secrets redacted from structured logs at startup

---

## [0.0.1] — 2026-04-19

### Added

- Design artefacts locked: `SPEC.md`, `DESIGN.md` (28 sections), `docs/domain-reference.md`, 13 ADRs.
- GitHub labels, milestones, issues, and Project board scaffolded.
- No code yet — this is the placeholder release claiming the npm name.

---

[Unreleased]: https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/torsday/omnifocus-mcp/compare/v0.0.1...v1.0.0
[0.0.1]: https://github.com/torsday/omnifocus-mcp/releases/tag/v0.0.1
