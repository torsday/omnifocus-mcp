# omnifocus-mcp — Backlog

**Status:** v1 design-complete — resequenced after 2026-04-19 user answers (rich custom perspectives → OmniJS promoted to M0/M2)
**Date:** 2026-04-19
**Tracker:** Markdown (this file). A GitHub Issues migration table lives at the bottom; creation is gated on user confirmation.

Task format: `- [ ] [type] <title> — <priority>, <size>` with `_Blocked by:_` annotations where needed.

**Types:** `feature`, `chore`, `spike`, `infra`, `docs`, `bug`
**Priorities:** P0 · critical, P1 · high, P2 · medium, P3 · low
**Sizes:** XS (≤2h), S (½ day), M (1 day), L (2–3 days), XL (≥1 week — split where possible)
**Risk:** 🔴 high, 🟡 medium, 🟢 low

---

## Cross-cutting concerns

Apply across every task; not a phase of their own.

- **Response envelope** (DESIGN §12). Every tool returns `{ data, meta, pagination? }` on success or `{ error, meta }` on failure.
- **Typed errors** (DESIGN §6.7). No generic `Error`; every throw is from the domain hierarchy.
- **Structured logging** (DESIGN §21). Every tool call emits one `tool.invoked` or `tool.error` event with a correlation ID.
- **UTF-8 + ISO-8601** (DESIGN §14, §27). Dates always ISO-8601 with offset; strings always UTF-8.
- **IDs only, never names** (ADR-0008). Branded opaque strings.
- **Tool description standard** (per `agent_systems.md`). What / when not to / returns / side effects.
- **Cache discipline** (ADR-0006). Reads through cache; writes invalidate conservatively.
- **Safety rails.** No stdout writes; no network imports; rate limits + circuit breakers on every tool.

---

## Milestone 0 — Foundation, both transports, operational guardrails

**Outcome:** server boots, answers MCP handshakes, enforces every cross-cutting invariant, and runs trivial JXA **and** OmniJS scripts end-to-end. OmniJS is foundational, not a later add-on, because Milestone 2 needs it for custom perspectives.

- [ ] [spike] Validate JXA round-trip against live OmniFocus — P0, S 🟡
      _Question:_ Can we reliably invoke JXA via `osascript` from Node and parse structured JSON results?
      _Time box:_ 0.5 day.
      _Output:_ note under `docs/spikes/2026-04-jxa-spike.md`.
- [ ] [spike] Validate OmniJS URL-scheme + callback-file pattern — P0, S 🟡
      _Question:_ Reliability? p95 latency? failure modes? timeout handling for wedged OF?
      _Time box:_ 1 day.
      _Output:_ note under `docs/spikes/2026-04-omnijs-spike.md`; pivots recorded as ADRs if needed.
- [ ] [infra] Publish `@torsday/omnifocus-mcp@0.0.1` placeholder to claim the name (ADR-0012) — P0, XS 🟢
- [ ] [infra] Initialise `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `tsup.config.ts` — P0, S 🟢
- [ ] [infra] Lint rules: forbid `http`/`https`/`fetch`/`node-fetch`/`axios`/`undici` imports; forbid `as <ID>` casts in domain code — P0, S 🟢
- [ ] [infra] `.claude/settings.json` — permission allowlist and post-edit lint hook — P1, S 🟢
- [ ] [infra] GitHub Actions: PR pipeline on `macos-latest` × Node 20/22 (typecheck, lint, build, unit) — P0, M 🟢
- [ ] [feature] Typed error hierarchy with `code`, `suggestion`, `details` — full set: `OmniFocusNotRunning`, `PermissionDenied`, `NotFound`, `ValidationError`, `ScriptError`, `TransportUnavailable`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`, `CircuitOpen`, `QueueFull`, `Timeout`, `RateLimited`, `ServerShuttingDown` — P0, S 🟢
- [ ] [feature] Structured logger (`pino` → stderr) with PII redaction at `info`+ — P0, S 🟢
- [ ] [feature] Correlation-ID generator (`ulid`) + per-request propagation — P0, XS 🟢
- [ ] [feature] Stdout-write guard: startup hook + integration test that asserts zero bytes out — P0, XS 🟢
- [ ] [feature] Config loader: env vars → typed config object; validation at startup — P0, S 🟢
- [ ] [feature] Branded ID types + constructors (`TaskId`, `ProjectId`, `TagId`, `FolderId`, `AttachmentId`) — P0, XS 🟢
- [ ] [feature] `isoDateString()` zod helper — validates ISO-8601 with offset, rejects bare local — P0, XS 🟢
- [ ] [feature] Response envelope helpers: `ok(data, meta?)`, `err(code, message, …)` — P0, XS 🟢
- [ ] [feature] `OmniFocusAdapter` interface + `InMemoryAdapter` skeleton — P0, M 🟢
- [ ] [feature] `JxaTransport` base class + script runner — P0, M 🟡
      _Blocked by:_ JXA spike
- [ ] [feature] `OmniJsTransport` base class with timeout, file cleanup, structured error handling — P0, L 🟡
      _Blocked by:_ OmniJS spike
- [ ] [feature] `TransportRouter` per-operation selection (implements `OmniFocusAdapter`) — P0, M 🟡
      _Blocked by:_ JxaTransport + OmniJsTransport
- [ ] [feature] Read pool (default 2 slots) + write queue (single slot, cap 50) + OmniJS queue (ADR-0009) — P0, M 🟡
- [ ] [feature] LRU read cache with TTL + invalidation scope API (ADR-0006) — P0, S 🟢
- [ ] [feature] Thundering-herd coalescing in cache layer — P1, S 🟢
- [ ] [feature] Per-tool circuit breaker — P1, S 🟢
- [ ] [feature] Per-tool rate limiter (default 30/60s) — P2, S 🟢
- [ ] [feature] Lifecycle manager: lazy OF detection, OF version cache, `FeatureRequiresOfVersion` gate (DESIGN §17) — P0, S 🟡
- [ ] [feature] Graceful shutdown: SIGINT/SIGTERM drain in-flight, reject new, flush logs — P1, S 🟢
- [ ] [feature] MCP server bootstrap over stdio, empty tool registry, `initialize` handler — P0, S 🟢
- [ ] [feature] Script-inlining build step (`tsup` loader for `src/scripts/**`) — P0, S 🟡
- [ ] [feature] `app_launch` tool (explicit, never automatic) — P3, XS 🟢
- [ ] [test] Adapter contract test harness — same suite runs against `InMemoryAdapter`, `JxaTransport`, `OmniJsTransport`, `TransportRouter` — P0, M 🟡
- [ ] [test] Chaos-injection harness for transport (OF-not-running, permission-denied, timeout, malformed-JSON) — P1, M 🟡
- [ ] [infra] Seed fixture script `scripts/seed-integration-db.js` for integration tests — P1, M 🟡
- [ ] [docs] Initial `README.md` with install + single usage example — P2, XS 🟢

**Phase exit:** `pnpm test` green in < 10s. Server starts and emits zero bytes on stdout. Both transports execute trivial round-trip scripts end-to-end.

---

## Milestone 1 — Core task & project surface + pagination

**Outcome:** the agent can list, read, create, update, and complete tasks and projects with cursor-based pagination — the 80% path of daily use.

- [ ] [feature] `Task`, `Project`, `TaskId`, `ProjectId` zod schemas + domain types matching `docs/domain-reference.md` — P0, M 🟢
- [ ] [feature] Pagination cursor codec: encode/decode `{ lastId, lastCreatedAt, filterHash }` — P0, S 🟢
- [ ] [feature] `TaskService` + `task_list` (with filters + pagination) — P0, M 🟡
- [ ] [feature] `task_get` — P0, S 🟢
- [ ] [feature] `task_create` (inbox / project / subtask) — P0, M 🟡
- [ ] [feature] `task_update` (name, plain note, flagged, due, defer, estimated, tags, sequential/parallel, completedByChildren) — P0, L 🟡
- [ ] [feature] `task_complete`, `task_uncomplete`, `task_drop`, `task_undrop` — P0, M 🟢
- [ ] [feature] `task_delete` (hard removal, irreversible; distinct from drop) — P1, S 🔴
- [ ] [feature] `task_find_by_name` (ambiguity-aware; returns all matches) — P2, S 🟢
- [ ] [feature] `task_move`, `task_reorder`, `task_duplicate` (with `recursive: boolean`) — P1, M 🟡
- [ ] [feature] `ProjectService` + `project_list` (with pagination) + `project_get` — P0, M 🟢
- [ ] [feature] `project_create`, `project_update` (completion criteria, review interval) — P0, M 🟡
- [ ] [feature] `project_complete`, `project_drop`, `project_move` — P0, S 🟢
- [ ] [feature] `project_delete` (hard removal, irreversible; distinct from drop) — P1, S 🔴
- [ ] [feature] Cache invalidation wired for all Milestone-1 mutations — P0, S 🟡
- [ ] [test] Unit suite for Milestone 1 against `InMemoryAdapter` — P0, M 🟢
- [ ] [test] Script-tier tests for each Milestone-1 JXA script — P0, M 🟡
- [ ] [test] Integration tests gated on `OMNIFOCUS_INTEGRATION=1` — P0, M 🟡

**Phase exit:** an agent can say "create a task in Project X due Thursday, flag it, tag @home" and it happens. Pagination works on any list exceeding its limit.

---

## Milestone 2 — Metadata + custom perspectives (OmniJS-enabled)

**Outcome:** the agent can navigate the full metadata hierarchy **and evaluate custom perspectives** — the phase where this MCP becomes usable for a custom-perspective-heavy workflow.

- [ ] [feature] `Tag` schema + `tag_list`, `tag_get` — P1, S 🟢
- [ ] [feature] `tag_create`, `tag_update`, `tag_delete`, `tag_move`, `tag_set_status`, `tag_set_allows_next_action` — P1, M 🟢
- [ ] [feature] `tag_set_location`, `tag_get_location` (lat/lon/radius/trigger) — P2, S 🟡
- [ ] [feature] `Folder` schema + full CRUD (`folder_list`, `_get`, `_create`, `_update`, `_delete`, `_move`) — P1, M 🟢
- [ ] [feature] `Perspective` schema + `perspective_list` (built-in + custom) — P0, S 🟢
- [ ] [feature] `perspective_evaluate` for built-in perspectives (Inbox, Forecast, Flagged, Projects, Tags, Review, Nearby) via JXA — P0, M 🟡
- [ ] [feature] `perspective_evaluate` for custom perspectives via OmniJS — P0, L 🟡
      _Blocked by:_ OmniJsTransport + TransportRouter (M0)
- [ ] [feature] `forecast_get` (range, include flags) — P0, M 🟡
- [ ] [feature] `search_query` (name / note / fulltext with filters + pagination) — P1, L 🟡
- [ ] [feature] MCP resources — `omnifocus://inbox`, `omnifocus://forecast/today`, `omnifocus://project/{id}`, `omnifocus://tag/{id}`, `omnifocus://perspective/{id}` (built-in + custom) — P1, M 🟢
- [ ] [test] Script + integration tests for M2 including custom-perspective coverage on OmniJS path — P0, M 🟡

**Phase exit:** an agent can evaluate any perspective (built-in or custom) by name or ID. Rich-perspective workflows are unlocked.

---

## Milestone 3 — Repetition, notes, review, batch, transport text

**Outcome:** the advanced daily-use features that distinguish OF from a to-do list.

- [ ] [feature] `RepetitionRule` schema with cross-field validation (weekdays only when unit=weeks, monthlyAnchor only when unit=months, etc.) — P1, M 🟡
- [ ] [feature] Wire repetition into `task_update`; dedicated `task_set_repetition`, `task_clear_repetition` — P1, M 🟡
- [ ] [feature] `note_get`, `note_set`, `note_append` (plain text) — P1, S 🟢
- [ ] [feature] `note_get_html`, `note_set_html` (rich-text round-trip as HTML fragment) — P1, M 🟡
- [ ] [feature] `review_list_due`, `review_mark_reviewed`, `review_set_interval`, `project_mark_reviewed` — P1, M 🟢
- [ ] [feature] `task_batch_create`, `task_batch_update`, `task_batch_complete` — one JXA round-trip per batch; best-effort with per-index errors — P1, L 🟡
- [ ] [feature] `task_parse_transport_text` — OF's transport-text DSL → one or many task creates — P2, M 🟢
- [ ] [test] Property tests: RepetitionRule schema, transport-text parser, cursor codec — P1, M 🟡

**Phase exit:** an agent can configure a weekly review and queue 20 tasks from a meeting dump in a single call.

---

## Milestone 4 — Long tail: attachments, export/import, sync, plug-ins, escape hatch

**Outcome:** every functional requirement in `SPEC.md` is covered; integration tests pass for all.

- [ ] [feature] `Attachment` schema + `attachment_list`, `attachment_add` (from path), `attachment_remove`, `attachment_save_to_path` — P2, L 🟡
- [ ] [feature] Attachment path-scope validator (`$HOME` default; `OMNIFOCUS_ATTACHMENT_PATHS` override) — P2, S 🟢
- [ ] [feature] Attachment size cap enforcement (`OMNIFOCUS_MAX_ATTACHMENT_MB`) — P2, XS 🟢
- [ ] [feature] `export_taskpaper`, `import_taskpaper` — P2, M 🟢
- [ ] [feature] `export_opml` — P3, S 🟢
- [ ] [feature] `sync_trigger`, `sync_status` — P2, S 🟢
- [ ] [feature] `plugin_invoke` (generic; no named wrappers in v1) — P3, M 🟡
      _Note:_ deprioritized per user input — no specific plug-ins to wrap in v1.
- [ ] [feature] `run_jxa_script`, `run_omnijs_script` — opt-in via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; every call audit-logged at `info` — P2, M 🔴

**Phase exit:** every functional requirement in `SPEC.md` has passing integration tests.

---

## Milestone 5 — Polish, observability, release

**Outcome:** ready to ship; a stranger can install and use it in five minutes.

- [ ] [feature] Loop-detection middleware (repeat-call warning in response) — P2, M 🟢
- [ ] [feature] `internal_status` tool (uptime, OF version, running, last sync, cache stats, circuit states, queue depth) — P2, S 🟢
- [ ] [test] Tool-description lint test — every tool matches the what/when-not/returns/side-effects shape — P2, S 🟢
- [ ] [test] Snapshot tests on tool descriptions — P2, S 🟢
- [ ] [test] E2E harness: spawn server, act as MCP client, exercise each tool — P1, L 🟡
- [ ] [infra] Integration CI workflow (`integration.yml`) — manual dispatch, self-hosted macOS runner optional — P2, M 🟡
- [ ] [infra] Release workflow (`release.yml`) — tag push → build → `pnpm publish --access public` — P1, M 🟢
- [ ] [infra] Bundle-size budget check in CI (< 500 KB minified) — P2, XS 🟢
- [ ] [docs] Full `README.md` — install for Claude Desktop + Claude Code, permission setup, troubleshooting — P1, M 🟢
- [ ] [docs] `docs/tools.md` — generated reference of every tool with schema + example — P2, M 🟢
- [ ] [docs] Client config snippets: Claude Desktop, Claude Code, generic stdio — P1, S 🟢
- [ ] [docs] `CHANGELOG.md` + release notes for v1.0.0 via `release_notes.md` prompt — P2, S 🟢
- [ ] [docs] Permission-prompt recovery runbook (`docs/troubleshooting.md`) — P2, S 🟢

**Phase exit:** `npx @torsday/omnifocus-mcp` installs, runs, and works with Claude Desktop end-to-end.

---

## Critical path

1. **Both transport spikes** (M0) — prove the approach for both JXA and OmniJS
2. **Adapter + both transports + router + pool/queue + envelope + errors + cache** (M0)
3. **Task + project core CRUD** (M1) — minimum shippable
4. **Custom perspective evaluation** (M2) — user's primary workflow, load-bearing
5. **M3 / M4 / M5 largely parallelizable once M2 lands**

**Fastest ship-to-value:** M0 → M1 → release v0.1 → M2 → release v0.2 → M3 → M4 → M5 → v1.0.

---

## Parallelizable work (no blockers once M0 core lands)

- All of M1 after adapter + envelope helpers exist
- M2 noun areas (tags / folders / forecast / search) run in parallel; only `perspective_evaluate (custom)` blocks on the router
- M3 notes / review / transport-text are independent
- Documentation (M5) starts incrementally per feature

---

## Open questions

All spec-level open questions are closed (see `SPEC.md` "Open Questions — all resolved"). Remaining uncertainty is empirical and lives in the two spikes at the head of M0.

---

## GitHub Issues migration — review table

| #  | Type    | Title                                                                           | Milestone         | Priority | Size | Blocked by |
| -- | ------- | ------------------------------------------------------------------------------- | ----------------- | -------- | ---- | ---------- |
|  1 | spike   | Validate JXA round-trip against live OmniFocus                                  | M0 Foundation     | P0       | S    | —          |
|  2 | spike   | Validate OmniJS URL-scheme + callback-file pattern                              | M0 Foundation     | P0       | S    | —          |
|  3 | infra   | Publish @torsday/omnifocus-mcp@0.0.1 placeholder                                | M0 Foundation     | P0       | XS   | —          |
|  4 | infra   | Initialise package.json, tsconfig, biome, vitest, tsup                          | M0 Foundation     | P0       | S    | #3         |
|  5 | infra   | Lint rules (forbid network imports, forbid ID casts)                            | M0 Foundation     | P0       | S    | #4         |
|  6 | infra   | .claude/settings.json — permissions + post-edit lint hook                       | M0 Foundation     | P1       | S    | —          |
|  7 | infra   | GitHub Actions PR pipeline (macos-latest × Node 20/22)                          | M0 Foundation     | P0       | M    | #4         |
|  8 | feature | Typed error hierarchy (full set)                                                | M0 Foundation     | P0       | S    | —          |
|  9 | feature | Structured logger (pino → stderr) with PII redaction                            | M0 Foundation     | P0       | S    | —          |
| 10 | feature | Correlation-ID generator + request propagation                                  | M0 Foundation     | P0       | XS   | —          |
| 11 | feature | Stdout-write guard + integration test                                           | M0 Foundation     | P0       | XS   | #9         |
| 12 | feature | Env-var config loader + startup validation                                      | M0 Foundation     | P0       | S    | —          |
| 13 | feature | Branded ID types                                                                | M0 Foundation     | P0       | XS   | —          |
| 14 | feature | isoDateString() zod helper                                                      | M0 Foundation     | P0       | XS   | —          |
| 15 | feature | Response envelope helpers — ok() / err()                                        | M0 Foundation     | P0       | XS   | #8         |
| 16 | feature | OmniFocusAdapter interface + InMemoryAdapter skeleton                           | M0 Foundation     | P0       | M    | #13        |
| 17 | feature | JxaTransport base class + script runner                                         | M0 Foundation     | P0       | M    | #1, #16    |
| 18 | feature | OmniJsTransport base (timeouts, file cleanup, errors)                           | M0 Foundation     | P0       | L    | #2, #16    |
| 19 | feature | TransportRouter per-operation selection                                         | M0 Foundation     | P0       | M    | #17, #18   |
| 20 | feature | Read pool + write queue + OmniJS queue                                          | M0 Foundation     | P0       | M    | #17, #18   |
| 21 | feature | LRU read cache with TTL + invalidation scope API                                | M0 Foundation     | P0       | S    | —          |
| 22 | feature | Thundering-herd coalescing                                                      | M0 Foundation     | P1       | S    | #21        |
| 23 | feature | Per-tool circuit breaker                                                        | M0 Foundation     | P1       | S    | —          |
| 24 | feature | Per-tool rate limiter                                                           | M0 Foundation     | P2       | S    | —          |
| 25 | feature | Lifecycle manager — lazy OF detection + version cache                           | M0 Foundation     | P0       | S    | #17        |
| 26 | feature | Graceful shutdown (SIGINT/SIGTERM)                                              | M0 Foundation     | P1       | S    | —          |
| 27 | feature | MCP server bootstrap over stdio + initialize handler                            | M0 Foundation     | P0       | S    | —          |
| 28 | feature | Script-inlining build step (tsup loader)                                        | M0 Foundation     | P0       | S    | #4         |
| 29 | feature | app_launch tool (explicit)                                                      | M0 Foundation     | P3       | XS   | #17        |
| 30 | test    | Adapter contract test harness                                                   | M0 Foundation     | P0       | M    | #16        |
| 31 | test    | Chaos-injection harness for transport                                           | M0 Foundation     | P1       | M    | #17, #18   |
| 32 | infra   | Integration seed-fixture script                                                 | M0 Foundation     | P1       | M    | —          |
| 33 | docs    | Initial README.md                                                               | M0 Foundation     | P2       | XS   | —          |
| 34 | feature | Task + Project domain zod schemas                                               | M1 Core surface   | P0       | M    | #13, #14   |
| 35 | feature | Pagination cursor codec                                                         | M1 Core surface   | P0       | S    | #14        |
| 36 | feature | TaskService + task_list (filters + pagination)                                  | M1 Core surface   | P0       | M    | #19, #34, #35 |
| 37 | feature | task_get                                                                        | M1 Core surface   | P0       | S    | #36        |
| 38 | feature | task_create                                                                     | M1 Core surface   | P0       | M    | #34        |
| 39 | feature | task_update (all editable properties)                                           | M1 Core surface   | P0       | L    | #36        |
| 40 | feature | task_complete / uncomplete / drop / undrop                                      | M1 Core surface   | P0       | M    | #34        |
| 41 | feature | task_move / reorder / duplicate                                                 | M1 Core surface   | P1       | M    | #39        |
| 42 | feature | ProjectService + project_list + project_get                                     | M1 Core surface   | P0       | M    | #34        |
| 43 | feature | project_create + project_update                                                 | M1 Core surface   | P0       | M    | #42        |
| 44 | feature | project_complete / drop / move                                                  | M1 Core surface   | P0       | S    | #42        |
| 45 | feature | Cache invalidation wiring for M1 mutations                                      | M1 Core surface   | P0       | S    | #21, #39   |
| 46 | test    | M1 unit suite against InMemoryAdapter                                           | M1 Core surface   | P0       | M    | #36–#44    |
| 47 | test    | M1 script-tier tests                                                            | M1 Core surface   | P0       | M    | #36–#44    |
| 48 | test    | M1 integration tests (gated)                                                    | M1 Core surface   | P0       | M    | #46, #32   |
| 49 | feature | Tag schema + tag_list + tag_get                                                 | M2 Metadata       | P1       | S    | #16        |
| 50 | feature | Tag CRUD + set_status + set_allows_next_action                                  | M2 Metadata       | P1       | M    | #49        |
| 51 | feature | tag_set_location + tag_get_location                                             | M2 Metadata       | P2       | S    | #49        |
| 52 | feature | Folder CRUD                                                                     | M2 Metadata       | P1       | M    | #16        |
| 53 | feature | Perspective schema + perspective_list (built-in + custom)                       | M2 Metadata       | P0       | S    | #16        |
| 54 | feature | perspective_evaluate for built-ins (JXA)                                        | M2 Metadata       | P0       | M    | #53        |
| 55 | feature | perspective_evaluate for custom perspectives (OmniJS)                           | M2 Metadata       | P0       | L    | #19, #53   |
| 56 | feature | forecast_get                                                                    | M2 Metadata       | P0       | M    | #16        |
| 57 | feature | search_query (with pagination)                                                  | M2 Metadata       | P1       | L    | #35        |
| 58 | feature | MCP resources (inbox, forecast/today, project, tag, perspective)                | M2 Metadata       | P1       | M    | #36, #42, #53 |
| 59 | test    | M2 script + integration tests incl. custom perspectives                         | M2 Metadata       | P0       | M    | #49–#58    |
| 60 | feature | RepetitionRule schema with cross-field validation                               | M3 Advanced       | P1       | M    | #34        |
| 61 | feature | task_set_repetition, task_clear_repetition; wire into task_update               | M3 Advanced       | P1       | M    | #60        |
| 62 | feature | note_get / set / append (plain)                                                 | M3 Advanced       | P1       | S    | #36        |
| 63 | feature | note_get_html / note_set_html (rich-text round-trip)                            | M3 Advanced       | P1       | M    | #62        |
| 64 | feature | Review suite (list_due, mark_reviewed, set_interval)                            | M3 Advanced       | P1       | M    | #42        |
| 65 | feature | Batch ops (create / update / complete) — best-effort, per-index errors          | M3 Advanced       | P1       | L    | #39        |
| 66 | feature | task_parse_transport_text                                                       | M3 Advanced       | P2       | M    | #38        |
| 67 | test    | Property tests (repetition, cursor, transport text)                             | M3 Advanced       | P1       | M    | #60, #35, #66 |
| 68 | feature | Attachment suite (list / add / remove / save_to_path)                           | M4 Long tail      | P2       | L    | #36        |
| 69 | feature | Attachment path-scope validator                                                 | M4 Long tail      | P2       | S    | —          |
| 70 | feature | Attachment size cap                                                             | M4 Long tail      | P2       | XS   | —          |
| 71 | feature | TaskPaper export + import                                                       | M4 Long tail      | P2       | M    | #36, #42   |
| 72 | feature | OPML export                                                                     | M4 Long tail      | P3       | S    | #42        |
| 73 | feature | sync_trigger + sync_status                                                      | M4 Long tail      | P2       | S    | #16        |
| 74 | feature | plugin_invoke (generic)                                                         | M4 Long tail      | P3       | M    | #19        |
| 75 | feature | run_jxa_script / run_omnijs_script (opt-in, audit-logged) 🔴                    | M4 Long tail      | P2       | M    | #19        |
| 76 | feature | Loop-detection middleware                                                       | M5 Polish         | P2       | M    | #27        |
| 77 | feature | internal_status tool                                                            | M5 Polish         | P2       | S    | #27        |
| 78 | test    | Tool-description lint test                                                      | M5 Polish         | P2       | S    | —          |
| 79 | test    | Snapshot tests on tool descriptions                                             | M5 Polish         | P2       | S    | #78        |
| 80 | test    | E2E harness (spawn server as MCP client)                                        | M5 Polish         | P1       | L    | —          |
| 81 | infra   | Integration CI workflow (manual + self-hosted runner optional)                  | M5 Polish         | P2       | M    | #7, #32    |
| 82 | infra   | Release workflow (tag push → npm publish)                                       | M5 Polish         | P1       | M    | #7         |
| 83 | infra   | Bundle-size budget check in CI                                                  | M5 Polish         | P2       | XS   | #7         |
| 84 | docs    | Full README (install, Claude Desktop/Code config, permission, troubleshooting)  | M5 Polish         | P1       | M    | —          |
| 85 | docs    | docs/tools.md generated reference                                               | M5 Polish         | P2       | M    | #78        |
| 86 | docs    | Client config snippets (Claude Desktop, Claude Code)                            | M5 Polish         | P1       | S    | —          |
| 87 | docs    | CHANGELOG + release notes v1.0.0                                                | M5 Polish         | P2       | S    | —          |
| 88 | docs    | Permission-prompt recovery runbook                                              | M5 Polish         | P2       | S    | —          |

**Before creating these as GitHub Issues, confirm:**

1. GitHub Issues vs stay in this file?
2. Any titles to rename, any tasks to merge/split?
3. Milestones confirmed: `M0 Foundation`, `M1 Core surface`, `M2 Metadata`, `M3 Advanced`, `M4 Long tail`, `M5 Polish`?
4. Labels: `feature`, `chore`, `spike`, `infra`, `docs`, `bug`, `P0 · critical`, `P1 · high`, `P2 · medium`, `P3 · low`, `XS`, `S`, `M`, `L`, `XL`, `blocked`, plus domain labels (`task`, `project`, `tag`, `folder`, `perspective`, `forecast`, `search`, `review`, `repetition`, `note`, `attachment`, `export`, `sync`, `transport`, `observability`, `lifecycle`, `security`)?
