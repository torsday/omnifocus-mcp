# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

## [Unreleased]

See [GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues) and [Project #4](https://github.com/users/torsday/projects/4) for the live backlog and status.

### Added

- **`import_opml`** — MCP tool that completes the OPML round-trip with `export_opml`. Server-side parser in `src/services/export/opmlParser.ts` (no new deps; lightweight stack-based tokeniser tuned to the format `export_opml` produces). `ExportService.importOpml()` resolves projects by OF ID first and falls back to name match; unmatched projects land in inbox; `destinationProjectId` overrides routing. Lossiness is documented: due/defer/flagged are preserved; tags, notes, attachments, and repetition rules are dropped (not encoded in standard OPML). ([#377](https://github.com/torsday/omnifocus-mcp/issues/377))

- **`task_batch_delete` / `task_batch_drop`** — batch mutation tools mirroring `task_batch_complete`. One JXA round-trip removes or cancels a list of tasks. Validation is atomic; execution is best-effort with per-index `{succeeded, failed}` in the response. Both invalidate the read cache and set `meta.syncPending` on success. ([#401](https://github.com/torsday/omnifocus-mcp/issues/401))

- **`project_get_many` / `tag_get_many`** — batch read tools mirroring `task_get_many`. One JXA round-trip hydrates up to 100 IDs; results preserve input order, missing IDs are omitted and surfaced via `meta.warnings` with `WARN_IDS_NOT_FOUND`. Wired through the adapter interface, `InMemoryAdapter`, `JxaTransport`, `OmniJsTransport`, and `TransportRouter`. ([#399](https://github.com/torsday/omnifocus-mcp/issues/399))

- **`forecast_get` ergonomic interface** — `date` (ISO-8601 or relative shortcut) and `days` (1–7) parameters as a cleaner alternative to raw `from`/`to` ranges. When `days > 1`, the response includes a `byDate[]` array grouping `dueToday` tasks by calendar day (`YYYY-MM-DD`). Mutual exclusivity between `date`/`days` and `from`/`to` is validated and rejected with `ValidationError`. ([#398](https://github.com/torsday/omnifocus-mcp/issues/398))

- **`task_search` cursor pagination** — `limit` (1..500, default 100) and opaque `cursor` parameters routed through `SearchService`'s stable-sort pagination (same primitive `search_query` already used). The tool's context now threads `searchService` instead of the raw adapter. ([#397](https://github.com/torsday/omnifocus-mcp/issues/397))

- **`task_search` filter expansion** — `q` is now optional so the tool can serve tag-only / project-only / date-range queries without a keyword. Three new filters added: `available` (active reachable tasks only), `dueBefore` and `dueAfter` (ISO-8601 or relative shortcut date bounds).

- **`task_list` inbox filter** — `inbox: true` surfaces tasks with no project assignment via OmniFocus's `inboxTasks()` collection in JXA and `projectId === null` in `InMemoryAdapter`. Mutually exclusive with `projectId` and `parentId` (rejected with `ValidationError` when combined). ([#400](https://github.com/torsday/omnifocus-mcp/issues/400))

- **`omnifocus://snapshot` syncStatus** — the snapshot resource payload now includes `lastSyncAt` (ISO-8601 with offset, or `null` if never synced) and `inFlight` (boolean) sourced from `getLastSync()`. Agents can detect stale data at session start without a separate `sync_status` round-trip. ([#402](https://github.com/torsday/omnifocus-mcp/issues/402))

- **Live database watcher with targeted invalidation** — a native Swift `FSEventStream` binary (`tools/watcher/omnifocus-watcher.swift`, ~70–90 LOC) streams JSON change events for every `.ofocus` write. `DatabaseWatcher` spawns the binary with a `fs.watch` fallback when it's absent or crashing. Each change resolves to a `ChangeContext{source, detectedAt, changedPaths}` callback; `mcpServer.ts` issues targeted `cache.invalidate('task:id')` per changed object instead of clearing the whole cache, and emits per-object `sendResourceUpdated({uri: 'omnifocus://task/id'})` plus aggregate URIs. New `getChangesSince()` adapter method backed by `changes_since.js` (JXA) returns `{tasks, projects}` for objects with `modificationDate >= sinceIso`. Build via `pnpm build:watcher` (current arch) or `pnpm build:watcher:all` (universal); the binary is gitignored and distributed via npm optional packages.

### Changed

- **`task_delete` / `task_batch_delete` require `confirm: true`** — input schemas now include `confirm: z.literal(true)`, rejecting any call where the field is absent or `false` before any adapter or JXA call runs. Tool descriptions surface the requirement with a `REQUIRED` prefix so agents notice it. Closes a class of accidental-permanent-deletion bugs noted in #413. ([#413](https://github.com/torsday/omnifocus-mcp/issues/413))

- **`LoopDetector` dual-threshold behaviour** — adds an `errorThreshold` (default 10 calls / 60s) on top of the existing warning threshold (5 calls / 60s). Past the warn threshold, `record()` returns `level: "warn"` and the middleware appends `WARN_LOOP_DETECTED` to `meta.warnings` (existing behaviour). Past the error threshold, `record()` returns `level: "error"` and the middleware throws `LoopDetected` (`OF_LOOP_DETECTED`) before the handler runs — blocking a stuck agent rather than just advising it. Exports the new `LoopDetected` class and `OF_LOOP_DETECTED` code. ([#379](https://github.com/torsday/omnifocus-mcp/issues/379))

- **Tool registry completed** — `allDescriptions.ts` and `allInputSchemas.ts` previously covered 50 of 73 registered tools; the remaining 23 (export/import_taskpaper, perspective_*, project_* CRUD, review_*, run_*_script, task_complete/create/drop/uncomplete/undrop) now have entries. `docs/tools.md` regenerated to cover all 73 tools. Also clears 7 description-shape lint violations under DESIGN §6.8.

- **README overhaul** — adds a "why" section, documents the four MCP workflow prompts, and replaces the stale tool table with an accurate one. Aligns the public landing page with the post-v1.0.0 surface.

- **`@biomejs/biome` 1.9.4 → 2.4.13** — schema migration: `files.ignore` → `files.includes` with negation patterns; `organizeImports` moved to `assist.actions.source.organizeImports`; `noConsoleLog` renamed to `noConsole` (now bans all `console.*` to match the pino-only logging intent). `noRestrictedImports` graduated from nursery to style. `scripts/` override allows `console.*` for CLI scripts; test override sets `noTemplateCurlyInString: off` (cache key patterns like `'project:${id}'` are intentional string literals). One real bug surfaced and fixed: `useIterableCallbackReturn` in `findByName.ts` (`filter` callback missing default false). ([#384](https://github.com/torsday/omnifocus-mcp/issues/384))

- **`fast-check` 3.23.2 → 4.7.0** — `fc.hexaString()` (removed in 4.x) replaced with `fc.stringMatching(/^[0-9a-f]{64}$/)` in `cursor.property.test.ts`. `fc.date` arbitraries in `dates.test.ts` gain a `.filter(d => !isNaN(d.getTime()))` because 4.x can produce `Invalid Date` values even with explicit min/max bounds; the filter ensures `toISOString()` never throws `RangeError` inside a property body. ([#385](https://github.com/torsday/omnifocus-mcp/issues/385))

---

## [1.0.0] — 2026-04-25

### Changed

- **TypeScript 6 migration** — bump `typescript` dev-dep from `^5.4` to `^6.0.3` (#122). No source changes required: `pnpm typecheck`, `pnpm test` (1667 tests), `pnpm build`, and `pnpm lint` (47 pre-existing errors, unchanged) all pass against TS 6. Dependabot's closed attempt (#115) predated the Zod 4 migration in #123, which cleared the legacy `z.ZodType<T, z.ZodTypeDef, unknown>` patterns that previously made a TS bump look breaking. ([#122](https://github.com/torsday/omnifocus-mcp/issues/122))

- **Zod 4 migration** — bump `zod` to `^4.3.6` and `zod-to-json-schema` to `^3.25.2` (#123). Zod 4 reworks the class hierarchy into a tagged-union (`def.type` discriminator) and tightens `.default()` semantics: defaults now produce output-type values, so three input-side `.default("")` calls (booleanish env flags) and one path default (`OMNIFOCUS_ATTACHMENT_PATHS`) plus the `rateLimitSchema.default("120/60")` move to the new `.prefault()` API which keeps input-side defaulting for transform-bearing schemas. `result.error.errors` → `result.error.issues` on `ZodError`. The verbose `z.ZodType<T, z.ZodTypeDef, unknown>` type-erasure pattern used in the domain schemas (`project.ts`, `tag.ts`, `links.ts`, `folder.ts`, `perspective.ts`, `task.ts`) collapses to `z.ZodType<T>` since Zod 4 drops the middle def argument. `scripts/generate-tool-docs.ts` rewrote its runtime introspection from `instanceof z.ZodFoo` checks (many of which — `ZodBranded`, `ZodEffects` — no longer exist in v4) to `def.type` switching; the docs generator now correctly surfaces 49 tools rather than silently bailing at the first branded schema. All 1667 tests green; `zod-to-json-schema` output for registered MCP tools verified unchanged. No `as any` introduced. ([#123](https://github.com/torsday/omnifocus-mcp/issues/123))

### Added

- **Server composition foundation — `composeAdapter` + `makeMeta`** — second slice of #278 / sub-slice of #289 (#293). New `src/server/composition.ts` exports two factories that the rest of the registration work in #289 and #290 will build on: `composeAdapter(config)` returns the live `JxaTransport + OmniJsTransport → TransportRouter` chain (per-transport timeouts wired from `OMNIFOCUS_JXA_TIMEOUT_MS` / `OMNIFOCUS_OMNIJS_TIMEOUT_MS`), and `makeMeta(partial?)` returns a `ResponseMeta` with a freshly generated ULID-shaped correlationId and conservative defaults (`durationMs: 0`, `cacheHit: false`, `transport: "jxa"`, `ofVersion: "unknown"`) that callers override per-call. `startServer` swaps the `InMemoryAdapter` shortcut and `internal-${Date.now()}` placeholder for these factories so `internal_status` runs against the real transport chain; bundle grew from 66 KB to 180 KB as the JXA scripts and routing table came along for the ride. Cache wrapping (#22), service composition, the 49 `register*Tool` calls (#289), the 10 resource registrations (#290), and middleware composition (#291) all stay as follow-ups — this PR is foundation only. ([#293](https://github.com/torsday/omnifocus-mcp/issues/293))

- **MCP prompts wired into `startServer`** — first slice of #278 (server composition). `startServer` now calls `registerOmniFocusPrompts(server)` so MCP clients see the four DESIGN §29 workflow prompts (`daily-review`, `weekly-review`, `capture-meeting`, `project-planning`) on `prompts/list` and can invoke them via `prompts/get`. The prompt module has no runtime dependencies (no adapter, no services, no middleware), so this slice ships independently of the larger composition work — tool registrations (49 helpers + service chain + adapter pipeline), MCP resources (10 URIs), and per-tool middleware composition track as follow-up sub-issues. `server.started` log now includes `prompts: [...]` alongside `tools`. E2E smoke test extended with a `prompts/list` + `prompts/get(daily-review)` assertion. ([#278](https://github.com/torsday/omnifocus-mcp/issues/278))

- **E2E harness scaffolding** — `tests/e2e/E2EServer.ts` spawns the bundled server (`dist/index.js`) as a child process and speaks MCP over stdio via the official SDK `Client` + `StdioClientTransport`. Captures the child's stderr into `stderrBuffer` so a failing test can surface server-side logs without splattering them on green runs. Throws `E2EBundleMissingError` (`E2E_BUNDLE_MISSING`) with a `pnpm build` instruction when the bundle is absent. Canonical usage example in `tests/e2e/smoke.test.ts` drives the full `initialize → tools/list → tools/call(internal_status)` path — `internal_status` is the safest smoke target because it reports server uptime and works without a live OmniFocus. Suite gated on `OMNIFOCUS_E2E=1` (mirrors `OMNIFOCUS_INTEGRATION=1`); `pnpm test` skips it, `pnpm test:e2e` runs it. Scaffolding-only slice of #80; per-tool E2E coverage tracks as follow-up on the parent. ([#256](https://github.com/torsday/omnifocus-mcp/issues/256))

- **`task_batch_create` / `task_batch_update` / `task_batch_complete`** — batch mutation tools that perform atomic validation + best-effort execution in a single JXA round trip (#65). Validation is atomic: if any input fails schema, the whole batch is rejected before any mutation. Execution is best-effort: once the batch reaches OmniFocus each item succeeds or fails independently, and the response reports per-index `{ succeeded, failed }` renamed to operation-specific keys (`created` / `updated` / `completed`) plus a shared `failed: [{ index, errorCode, message }]` bucket. Adds `batchCreateTasks` / `batchUpdateTasks` / `batchCompleteTasks` to the adapter interface (returning `BatchOutcome<TaskId>`), wired through `InMemoryAdapter` and `JxaTransport` (one JXA script per method — `task_batch_create.js` / `task_batch_update.js` / `task_batch_complete.js`); `OmniJsTransport` stubbed `notYetWired`. `meta.syncPending` is `true` whenever any item succeeded. Advanced single-item features (additive tag diffs, `expectedModifiedAt`, `dry_run`, `idempotency_key`) are not supported in batch form; callers fall back to the singular tools for those. ([#65](https://github.com/torsday/omnifocus-mcp/issues/65))

- **`perspective_evaluate` — custom perspectives via OmniJS** — `perspective_evaluate` now accepts custom-perspective ids (from `perspective_list`, `kind: "custom"`) in addition to the seven built-in ids (#55). The tool inspects the id at the service layer: built-ins (`inbox`, `flagged`, …) route to JXA via `evaluatePerspective`; opaque custom ids route to OmniJS via the new `evaluateCustomPerspective` adapter method, which sets `document.windows[0].perspective = p` and walks `content.rootNode.descendants`, serialising each `Task` to the domain shape. Input schema widens from `z.enum(BUILTIN_PERSPECTIVE_IDS)` to `z.string().min(1)` — `perspectiveId` is now opaque at the wire boundary. Custom perspectives require OmniFocus Pro; the OmniJS script returns `{ error: { code: "FEATURE_REQUIRES_PRO" } }` when `Perspective.Custom` is unavailable, which the transport maps to `FeatureRequiresPro` (`OF_FEATURE_REQUIRES_PRO`). Unknown ids surface `NotFound` (`OF_NOT_FOUND`). `InMemoryAdapter` gains a `seedCustomPerspective(identifier, taskIds)` helper for deterministic unit tests. ([#55](https://github.com/torsday/omnifocus-mcp/issues/55))

- **`project_create` idempotency key** — sixth vertical-slice adoption of the mutation-safety primitives, mirroring the `task_create` slice on the project-create surface (#252). Input schema gains optional `idempotency_key`; handler wraps the existing create + cache-invalidation flow in `withIdempotencyKey` so retries under the same key replay the stored envelope (`{ created: true, id }`) with `meta.idempotentReplay = true` instead of producing a duplicate project. Concurrent calls with the same key coalesce onto a single adapter create. `expectedModifiedAt` is N/A for create (no prior version); `dry_run` deferred — the `{ created, id }` return shape has no preview equivalent since OmniFocus generates the id server-side. ([#252](https://github.com/torsday/omnifocus-mcp/issues/252))

- **`task_create` idempotency key** — fifth vertical-slice adoption of the mutation-safety primitives, following the `task_delete` / `project_delete` / `task_update` / `project_update` slices (#250). `task_create` is the primary motivator for idempotency per #138 ("without idempotency, safe retry creates duplicate tasks"). Input schema gains optional `idempotency_key`; handler wraps the existing create + cache-invalidation flow in `withIdempotencyKey` so retries under the same key replay the stored envelope with `meta.idempotentReplay = true` instead of producing a duplicate task. Concurrent calls with the same key coalesce onto a single adapter call (write-side analogue of #22's read-cache coalescing). `expectedModifiedAt` is N/A for create (no prior version); `dry_run` deferred — the `{ id }` return shape has no preview equivalent since OmniFocus generates the id server-side. ([#250](https://github.com/torsday/omnifocus-mcp/issues/250))

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
