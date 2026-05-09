# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.


## [1.3.0](https://github.com/torsday/omnifocus-mcp/compare/v1.2.2...v1.3.0) (2026-05-09)


### Added

* **observability:** per-tool response-size telemetry ([#778](https://github.com/torsday/omnifocus-mcp/issues/778)) ([79cace2](https://github.com/torsday/omnifocus-mcp/commit/79cace2f8050d26bb73181c6dcd4325fc8a02ad3))
* **tools:** default-truncate task notes in bulk reads ([#775](https://github.com/torsday/omnifocus-mcp/issues/775)) ([57dc1ba](https://github.com/torsday/omnifocus-mcp/commit/57dc1bae461e0630b00ca98fde98e06c377d9acb))


### Fixed

* **ci:** install shellcheck+actionlint via apt/script on ubuntu-latest ([508f7b2](https://github.com/torsday/omnifocus-mcp/commit/508f7b296ca21f4aaa13a4bf158bd01cc965b418))
* **in-memory:** skip project completedTaskCount bump when task state unchanged ([e5da6e4](https://github.com/torsday/omnifocus-mcp/commit/e5da6e41f15badc0e5b924203379806bc74b513a))
* **jxa:** route task tag mutations through OmniJS to defeat silent no-op ([c0304c5](https://github.com/torsday/omnifocus-mcp/commit/c0304c57a6eca2398fde7330d9eff2d163d79f4b))
* **jxa:** use container() not parent() for tag parent retrieval (OF 4.x) ([ba4abc5](https://github.com/torsday/omnifocus-mcp/commit/ba4abc53e327c31ac92342f0d79cc39dbc3daf84))
* **observability:** hash nested args correctly and survive null/undefined ([dcec35c](https://github.com/torsday/omnifocus-mcp/commit/dcec35c0f948ac5cc771cfcf8b570137097c092c))
* **pagination:** hashFilter must sort nested object keys for stable cursor filterHash ([f315a36](https://github.com/torsday/omnifocus-mcp/commit/f315a368a35880fedda3d88e79b90d4f8c33383d))
* **server:** register recursive zod schemas to unblock tools/list ([1e0a1d5](https://github.com/torsday/omnifocus-mcp/commit/1e0a1d5f39835416190d9899ce6c34d86d0d9fab))
* **webhooks:** register res.on('error') so dispatch never throws upward ([3f988e5](https://github.com/torsday/omnifocus-mcp/commit/3f988e5160fe1e093241288c2e4dd67ab730a3a5))


### Performance

* **jxa:** scope task_list tagId filter via tag.tasks() to avoid full scan ([a16fe77](https://github.com/torsday/omnifocus-mcp/commit/a16fe77895d5d0ceb93e3798ca7fb0d17fd92793))
* **tools:** elide default-valued fields from heavy read responses ([#774](https://github.com/torsday/omnifocus-mcp/issues/774)) ([7aecd56](https://github.com/torsday/omnifocus-mcp/commit/7aecd564a0efe69e3d9c9a385c1ebbded75ea0fa))


### Changed

* **jxa:** inline shared buildFolder helper via [@inline](https://github.com/inline) directive ([e8c7391](https://github.com/torsday/omnifocus-mcp/commit/e8c739140ae1047fa1f6c4bdb6c02e4e602be3d8))
* **jxa:** inline shared buildTag helper via [@inline](https://github.com/inline) directive ([57b0ab0](https://github.com/torsday/omnifocus-mcp/commit/57b0ab05c63ef9e6ed202198e90f33c68bbd9b14))


### Documentation

* **adr:** 0016 reactive automation runtime (proposed, deferred) ([ca91590](https://github.com/torsday/omnifocus-mcp/commit/ca915908a3785c53bab67c4c0bfbe1f0b404aa7f))
* **adr:** expand 0016 — option [#5](https://github.com/torsday/omnifocus-mcp/issues/5) (no, Claude itself can't listen) + sub-decision [#9](https://github.com/torsday/omnifocus-mcp/issues/9) (TypeScript) ([1a931d8](https://github.com/torsday/omnifocus-mcp/commit/1a931d86df9f9a03102bf7f00c927c537de5e53a))
* **adr:** expand 0016 — worked example, sandboxed js, failure modes, phased rollout ([42263cb](https://github.com/torsday/omnifocus-mcp/commit/42263cba1990abbcdfb78fcee2a729099ce3be43))
* **adr:** renumber reactive automation runtime to 0021 ([b18e075](https://github.com/torsday/omnifocus-mcp/commit/b18e07593234d52c3d340359005808874404ebcc))
* **agents:** add per-directory CLAUDE.md files for jxa, envelope, tools ([#809](https://github.com/torsday/omnifocus-mcp/issues/809)) ([39b6771](https://github.com/torsday/omnifocus-mcp/commit/39b6771bd09941076aff728f69461839928ce94a))
* **release:** align stale bundle-size budget mentions with current 800 KiB ([3e3e55f](https://github.com/torsday/omnifocus-mcp/commit/3e3e55faf76916079f3240be16c69f129c105a60))
* **spike:** [#800](https://github.com/torsday/omnifocus-mcp/issues/800) — osascript fanout — multiplexed scripts vs persistent daemon ([5e452a6](https://github.com/torsday/omnifocus-mcp/commit/5e452a6aea15ded5a7f3b70b1143da59bdf42d94))

## [1.2.2](https://github.com/torsday/omnifocus-mcp/compare/v1.2.1...v1.2.2) (2026-04-30)

**Summary** — Fixes a startup failure on Macs where OmniFocus runs in the macOS sandbox (App Store installs). The server now probes both the sandbox container path and the legacy Application Support path, preferring the sandbox location when both exist.

### Fixed

- **Sandboxed OmniFocus database path detected automatically ([#709](https://github.com/torsday/omnifocus-mcp/issues/709))** — On App Store installs of OmniFocus, the database lives under `~/Library/Containers/com.omnigroup.OmniFocus3/Data/Library/Application Support/OmniFocus/` rather than the legacy `~/Library/Application Support/OmniFocus/`. The server now probes both locations at startup and selects the correct one automatically — no configuration required. Previously the server would fail silently on sandboxed machines. ([ab4cc25](https://github.com/torsday/omnifocus-mcp/commit/ab4cc25e4c631f5321dbcb13ffc59e7e4a828a93))

## [1.2.1](https://github.com/torsday/omnifocus-mcp/compare/v1.2.0...v1.2.1) (2026-04-30)

**Summary** — A focused reliability patch for OmniFocus 4.x compatibility and cross-transport ID interoperability. Seven bug fixes address real failure modes surfaced since v1.2.0: JXA scripts now correctly handle OF 4.x's quirky `class()` exceptions on tag parents and containing projects; `byId` misses are mapped to typed `NotFound` errors instead of leaking the raw `-1728` osascript code; and four write-path operations (`task_create`, `task_duplicate`, `task_reorder`, `project_move`) are routed through OmniJS to guarantee ID interoperability across all transport paths per ADR-0019. The `parentId` subtask filter also works correctly again after a `tasks()` vs `flattenedTasks()` regression. No breaking changes; all v1.2.0 call shapes are unchanged.

### Fixed

- **JXA tag parent `class()` guard — OF 4.x exception safety** — `tag_list` and `tag_get` now guard the `parent.class()` call and per-element `tag.id()` calls against the `Can't convert types` exception that OmniFocus 4.x throws on certain specifier types. Previously these would surface as opaque JXA errors; they now degrade gracefully and return the tag without parent info rather than crashing the response. ([bcaefb9](https://github.com/torsday/omnifocus-mcp/commit/bcaefb9de9bdef4ce92876bf580eb2a48927c45f))

- **`byId` miss mapped to `NotFound` at the JXA boundary (closes [#674](https://github.com/torsday/omnifocus-mcp/issues/674))** — JXA's `flattenedTasks.byId()` returns a specifier with error code `-1728` ("Can't get object") when the ID doesn't exist, rather than `null`. This raw code was leaking through to callers. It is now intercepted at the transport boundary and converted to the typed `NotFoundError` the rest of the stack expects. ([ec53b88](https://github.com/torsday/omnifocus-mcp/commit/ec53b88e9733a3eaa24568da896d8a3da5ff377c))

- **`containingProject().class()` exception preserves `projectId`** — In OF 4.x, calling `.class()` on a real project specifier throws rather than returning a class name. A prior guard was catching the exception but resetting `projectId` to `null` as a side effect. Fixed: the exception path now correctly leaves `projectId` set to the project's ID. ([b40a4a0](https://github.com/torsday/omnifocus-mcp/commit/b40a4a0d77c0165c4d2ae6305ecfddf1efb49e18))

- **`parentId` subtask filter returns direct children only (closes [#695](https://github.com/torsday/omnifocus-mcp/issues/695))** — `task_list` with a `parentId` filter was calling `flattenedTasks()` on the parent, which recursively includes all descendants. Corrected to `tasks()` so only direct children are returned, matching the documented behavior. ([2796b30](https://github.com/torsday/omnifocus-mcp/commit/2796b30b9cf82090c67a4cbb0631f9e19712aaaf))

- **`task_create` routed through OmniJS for ID interoperability (closes [#680](https://github.com/torsday/omnifocus-mcp/issues/680))** — `task_create` previously used JXA, which assigns a different ID namespace than OmniJS. The returned task ID could not be reliably round-tripped through OmniJS write operations. Routed through OmniJS per ADR-0019 to guarantee ID interoperability across all transport paths. ([0c9959a](https://github.com/torsday/omnifocus-mcp/commit/0c9959abae2bb0e4afb0bdeb76bd60310ee141de))

- **`task_duplicate` routed through OmniJS for ID interoperability (closes [#692](https://github.com/torsday/omnifocus-mcp/issues/692))** — Same cross-transport ID issue as `task_create`. `task_duplicate` now runs via OmniJS and returns an ID that is valid for all subsequent operations regardless of transport. ([972ee8c](https://github.com/torsday/omnifocus-mcp/commit/972ee8c79154f523554e7e642a0262df1502dacb))

- **`project_move` and `project_create` routed through OmniJS + JXA folder readback fixed (closes [#681](https://github.com/torsday/omnifocus-mcp/issues/681))** — Both operations now run through OmniJS, fixing cross-transport ID interoperability failures. A secondary bug — JXA folder status/move setters silently no-oping — is also fixed. ([a1bf707](https://github.com/torsday/omnifocus-mcp/commit/a1bf70729738f3b1ec3534f0e82fdea7f72f5818), [509a6bd](https://github.com/torsday/omnifocus-mcp/commit/509a6bd4d4bdca71ae3d9b889f42ec44db55d195))

- **`task_reorder` validates parent before mutating (closes [#676](https://github.com/torsday/omnifocus-mcp/issues/676))** — `task_reorder` was applying the reorder even when the supplied `taskIds` belonged to different parent containers, producing silent data corruption. It now validates that all task IDs share the declared parent before any mutation. ([dc28308](https://github.com/torsday/omnifocus-mcp/commit/dc283086946d9418f7ea194136d5e91cb0e148a2))

## [1.2.0](https://github.com/torsday/omnifocus-mcp/compare/v1.1.0...v1.2.0) (2026-04-29)

**Summary** — The headline additions are **outbound webhooks** (a full HTTPS + HMAC delivery subsystem that fires when OmniFocus state changes), **macOS Calendar integration** via a Swift EventKit bridge (with new `omnifocus://calendar` and `omnifocus://agenda` resources that merge calendar events with the OF Forecast view), **decision-journal** support (record user judgment on tasks/projects so agent-driven scans stop re-litigating the same anomaly), **natural-language perspective authoring** (a new MCP prompt + `perspective_create`/`update`/`delete`/`evaluate_dry_run` tools), **`task_defer_smart`** (intent-bearing defer-date grammar so agents stop landing tasks on weekends or 11 pm), and **mutation testing** wired in as a release-time hard gate (Stryker, calibrated baseline, fails publish on regression). Several existing surfaces were tightened — `task_extract_from_image` moved its post-parse validation rules into the Zod schema for cleaner error envelopes, several batch tools gained `.describe()` coverage on inner fields, and a handful of read-side responses now pair human-readable names with opaque IDs for the same reason v1.1.0 introduced the convention. Two new ADRs lock the architectures (ADR-0016 webhook delivery, ADR-0018 calendar bridge). No breaking changes; all v1.0.x / v1.1.x call shapes are unchanged.

### Added

- **Outbound webhooks — `webhook_register`, `webhook_list`, `webhook_delete`, `webhook_test` (closes [#483](https://github.com/torsday/omnifocus-mcp/issues/483))** — first-class agent-observable event subsystem per [ADR-0016](./docs/adr/0016-webhook-delivery.md). Triggers cover **task-completed**, **task-created**, and **project-status-changed**, with optional per-trigger filters on `projectId` / `tagId`. Delivery is HTTPS-only at registration (http:// rejected), payload is JSON, optional HMAC-SHA256 signing via `X-OmniFocus-Signature: sha256=<hex>` (GitHub's header convention) when a secret is registered. Retry policy is **1s/5s/30s exponential backoff** (~36s total) on transport failure or non-2xx response, with a **per-webhook circuit breaker** that auto-disables a hook for **1 hour** after **10 consecutive failed deliveries**. Persistence lives at `~/Library/Application Support/omnifocus-mcp/webhooks.json` (mode 0600, schema-versioned, atomic tmp+rename writes). The whole subsystem is **off by default** behind `OMNIFOCUS_WEBHOOKS_ENABLED=1`, mirroring `OMNIFOCUS_ALLOW_RAW_SCRIPT`. URLs and HMAC secrets are stored on disk only — never echoed back through any tool response or surfaced on `omnifocus://capabilities` (which gains a `webhooks: { enabled, count, names }` field for visibility without leakage). `webhook_test` fires a synthetic event through the same HTTPS + HMAC + retry + circuit-breaker path as a real delivery — if the receiver doesn't see the synthetic, real events won't reach it either. Real-event firing rides the existing `DatabaseWatcher` chain: every detected OF state change feeds a fresh full snapshot to the orchestrator's diff/dispatch loop, with a `shouldObserve()` fast path so the snapshot fetch is skipped entirely when no webhook is registered (zero overhead for the default case). Failure-mode discipline (ADR-0016 §4e): every failure path is caught internally and logged to stderr, never propagates into the OF read path. The `node:https` import is allowlisted via the repo's network-import lint rule for `src/webhooks/` only.

- **macOS Calendar bridge + `omnifocus://calendar` and `omnifocus://agenda` resources (closes [#484](https://github.com/torsday/omnifocus-mcp/issues/484))** — read-only EventKit access via a tiny Swift subprocess bundled in `dist/`, per [ADR-0018](./docs/adr/0018-calendar-bridge.md). The Node-side `CalendarBridge` wrapper (`src/bridge/calendarBridge.ts`) exposes `ping()`, `getPermission()`, `requestAccess()`, and `readEvents(from, to, sources?)`. New typed errors: `CalendarPermissionDenied` (suggests granting Calendar access in System Settings) and `CalendarBridgeUnavailable` (suggests `pnpm build:calendar-bridge`). The `omnifocus://calendar{?from,to}` resource returns `{ events: CalendarEvent[] }` carrying `id, title, startsAt, endsAt, allDay, calendarName, calendarSource, location?, status, isAttendee?` — defaults span the current local-zone day, cached 60s on the `(from, to, sourcesEnv)` tuple. Calendar source filter via `OMNIFOCUS_CALENDAR_SOURCES` (read at request time so operators can change it without restarting). The `omnifocus://agenda{?date}` resource is the user-facing payoff — a sorted timeline of `{ items, floating }` where `items[]` interleaves calendar events and timed OF tasks by `startsAt` and `floating[]` is the bucket of OF tasks with no `dueDate`. The `omnifocus://capabilities` resource and `internal_status` tool both gain a `calendarAccess: { available, permission }` block: `available` is `true` when the bridge binary is callable, `permission` mirrors `EKEventStore.authorizationStatus(for: .event)` mapped to `granted | denied | restricted | not-determined`. Probes are read-only — they never trigger the macOS Calendar TCC prompt. ([#484](https://github.com/torsday/omnifocus-mcp/issues/484), [#637](https://github.com/torsday/omnifocus-mcp/issues/637))

- **Decision journal — `decision_record`, `decision_clear`, and project-health honor (closes [#485](https://github.com/torsday/omnifocus-mcp/issues/485))** — agent-memory of user judgment via a `decision-journal` fenced YAML block on a task or project note. `Decision` carries a `kind` from a closed set (`stall-is-intentional`, `deferred-by-choice`, `blocked-on-external`, `awaiting-decision`, `acknowledged-zombie`), a human-readable `reason`, an automatically-set `recordedAt`, and an optional `until` ISO-8601 auto-expiry (`isDecisionActive` returns false when `until` is in the past). The fence reuses the shared `noteFences` helper from #482 so `waiting-on` and `decision-journal` blocks coexist without conflict. Read-side integration: `task_get`, `task_get_many`, `project_get`, and `project_get_many` now surface a `decision` field whenever a fence is present (or a `decisions` map keyed by id on the `*_many` variants). The `omnifocus://project-health` resource partitions flagged projects into a new `acknowledged: ProjectHealthEntry[]` array when an active decision-journal fence is present, so callers can surface the user's recorded judgment ("Strategic pause until Q3 budget cycle") inline instead of re-litigating it. When `until` passes, the project re-emerges in `projects` automatically — the fence is preserved as audit history, never deleted. Malformed fences degrade silently. DESIGN.md §31 documents the fenced-metadata convention. ([#485](https://github.com/torsday/omnifocus-mcp/issues/485), [#589](https://github.com/torsday/omnifocus-mcp/issues/589))

- **Natural-language perspective authoring — `perspective-author` MCP prompt + `perspective_create` / `perspective_update` / `perspective_evaluate_dry_run` (closes [#476](https://github.com/torsday/omnifocus-mcp/issues/476), [#577](https://github.com/torsday/omnifocus-mcp/issues/577), [#659](https://github.com/torsday/omnifocus-mcp/issues/659))** — full authoring loop for OmniFocus custom perspectives. The new `perspective-author` MCP prompt turns a free-text description ("everything I could do at home, on a phone, with under 15 minutes") into a saved perspective via a three-step flow: (1) propose a `PerspectiveRule[]` tree from the prose, (2) preview matched tasks via `perspective_evaluate_dry_run`, (3) save via `perspective_create` only after user confirmation. The prompt embeds a reference card of every rule-tree atom (`actionAvailability`, `actionStatus`, `actionHasAllOfTags`, `actionHasAnyOfTags`, `actionHasNoProject`, `actionHasDueDate`, `actionHasDeferDate`, `actionIsLeaf`, `actionIsProject`, `actionMatchingSearch`, `actionWithinFocus`) with three worked examples, so agents have the full vocabulary without web access. `perspective_create` lands a custom perspective via OmniJS with atomic rollback (a partial create is undone if any step fails), `perspective_update` patches name/aggregation/rules/iconColor without rebuilding from scratch. `perspective_evaluate_dry_run` previews a proposed rule tree without persisting it — implementation creates a temporary perspective with a sentinel name, evaluates it, and **always** deletes the temp inside one OmniJS execution so a transport-level retry between hops can't leave an orphan. Inputs flow through a strict `PerspectiveRuleInputSchema` with disjointness + strict-shape refinements at the boundary. Custom perspectives require OmniFocus Pro; built-in perspective IDs are rejected with a typed error. ([#476](https://github.com/torsday/omnifocus-mcp/issues/476), [#577](https://github.com/torsday/omnifocus-mcp/issues/577), [#617](https://github.com/torsday/omnifocus-mcp/issues/617), [#618](https://github.com/torsday/omnifocus-mcp/issues/618), [#619](https://github.com/torsday/omnifocus-mcp/issues/619), [#659](https://github.com/torsday/omnifocus-mcp/issues/659))

- **`task_defer_smart` + `task_batch_defer_smart` — intent-bearing defer-date grammar (closes [#479](https://github.com/torsday/omnifocus-mcp/issues/479))** — two new tools that wrap `task_update`'s defer path with a high-level intent so agents stop landing tasks on weekends or 11 pm. `DeferIntent` is a discriminated union with six variants: `next-work-day` (Mon if today is Fri/Sat/Sun, else tomorrow; at the configured morning or afternoon hour), `next-weekday: { weekday: 0..6 }` (next *strict* occurrence — today→full week away if the day matches), `in-business-days: { days: N }` (skips weekends; returns morning hour), `next-month-start` (first of next month, midnight), `explicit-with-skip-weekends: { date: ISO }` (snaps forward to Monday if the input lands on Sat/Sun), and `after-event: { eventId }` (gated on calendar bridge — currently throws a typed `CalendarBridgeUnavailable` for follow-up). Morning/afternoon defaults via env: `OMNIFOCUS_MORNING_HOUR` (default 9), `OMNIFOCUS_AFTERNOON_HOUR` (default 14). Resolution is pure (no I/O); tests inject `now` deterministically. The tool composes with `dry_run`, `idempotency_key`, and `expectedModifiedAt` like the rest of the write surface. Returns `{ taskId, resolvedDeferDate, reason }` so the agent can echo `"deferred to Mon 27 Apr 09:00 (next work morning)"` verbatim. The batch variant accepts `entries: [{ taskId, intent }]` and surfaces per-entry success/error rows so one malformed intent does not abort siblings. ([#479](https://github.com/torsday/omnifocus-mcp/issues/479))

- **`clarification-needed` response kind — third response variant for negotiation rather than guess-and-fail ([#493](https://github.com/torsday/omnifocus-mcp/issues/493))** — one of the five children of the NL-excellence epic (#491) lands as a new envelope variant. When a tool can't proceed without user-supplied disambiguation but the underlying request is structurally valid, it returns `{ kind: "clarification-needed", question, choices?, replayToken }` instead of throwing a validation error. The agent re-prompts the user, then replays the original call with the user's selection plus the `replayToken` so the server can correlate the second attempt with the first. Lets agents treat ambiguity as a conversation rather than an immediate failure, without losing the original input shape across the round-trip.

- **`project_template_delete` ([#588](https://github.com/torsday/omnifocus-mcp/issues/588))** — companion to v1.1.0's `project_template_save` / `_list` / `_instantiate`. Removes a saved template by name from the configured Templates folder, reporting `noChange:true` when the template was already absent so the call is idempotent across retries.

- **Mutation-score surface on `internal_status` (slice 1D of [#502](https://github.com/torsday/omnifocus-mcp/issues/502))** — the `internal_status` response gains `mutation: { score, lastRunAt } | null`. `score` is the live mutation score computed from `<package-root>/reports/mutation/mutation.json` using Stryker's standard formula `(killed + timeout) / (killed + survived + timeout + noCoverage)`; `lastRunAt` is the report file's mtime as ISO-8601. Returns `null` when no report is present — the published npm tarball ships without `reports/`, so end-user installs degrade cleanly while dev / CI clones surface live calibration freshness. Probe is read-only and synchronous; injectable via `InternalStatusContext.probeMutationScore` for tests.

- **NL-quality follow-ups — name-paired responses across remaining batch and review surfaces ([#571](https://github.com/torsday/omnifocus-mcp/issues/571), [#607](https://github.com/torsday/omnifocus-mcp/issues/607), [#608](https://github.com/torsday/omnifocus-mcp/issues/608), [#609](https://github.com/torsday/omnifocus-mcp/issues/609))** — extends v1.1.0's "pair human-readable name with opaque ID" convention to the remaining surfaces that hadn't yet been covered: every batch tool's inner `.describe()` lines, `task_find_similar` candidate rows, the `review_*` family + `project_mark_reviewed` + `project_set_next_review_date`, and `import_opml` / `import_taskpaper` owner names on the import-result rows. Same payoff as v1.1.0: agents echo the human-readable identifier without a follow-up `*_get` call. Closes [#601](https://github.com/torsday/omnifocus-mcp/issues/601).

### Changed

- **`task_extract_from_image` — schema-discipline refactor (closes [#574](https://github.com/torsday/omnifocus-mcp/issues/574))** — closes the Class-5 finding from the NL-quality audit. The image-extension validity check (previously a runtime `ValidationError` thrown after Zod parse) and the `attachment-mode source requires attachSourceTo='none'` rule (likewise post-parse) are now expressed as Zod refinements at the input boundary, so violations surface as structured `ActionableValidation` failures keyed on the offending field rather than as opaque error throws partway through the handler. Inner fields on the `source` discriminated-union members (`attachmentId`, `ownerTaskId`, `ownerProjectId`) and the top-level `targetProjectId` gained `.describe()` lines per the rubric. No behavior change for valid inputs; tighter rejection (with structured errors) for invalid ones. The single-tool shape was kept — splitting into propose-then-commit tools was considered but rejected since #479's `task_defer_smart` and `repetition_from_prose` already model the `*_from_prose` pattern as single-tool.

### Fixed

- **README — `omnifocus://intents` row no longer claims a tool count ([#645](https://github.com/torsday/omnifocus-mcp/issues/645))** — the README's intents-row mentioned a numeric tool count, which the repo's `no-tool-counts` lint gate prohibits (counts drift the moment new tools land). Restored gate compliance ([#646](https://github.com/torsday/omnifocus-mcp/issues/646)).

### Documentation

- **ADR-0016 — Webhook delivery for OmniFocus state changes (closes [#662](https://github.com/torsday/omnifocus-mcp/issues/662))** — locks the architecture for [#483](https://github.com/torsday/omnifocus-mcp/issues/483)'s outbound webhook subsystem. Four decisions: (1) **trigger source** — polling-on-cache-refresh, riding the existing 30-second LRU cache (ADR-0006) rather than undocumented OmniJS observers or a new timer; lag bound by cache TTL is documented as a known property; (2) **persistence** — JSON config file at `~/Library/Application Support/omnifocus-mcp/webhooks.json`, mode 0600, schema-versioned, hot-reloaded via `fs.watch`; (3) **retry policy** — exponential 1s/5s/30s with a per-webhook circuit breaker (10 consecutive failures → auto-disable for 1h); best-effort delivery, no dead-letter queue; (4) **security model** — off by default behind `OMNIFOCUS_WEBHOOKS_ENABLED=1` (mirroring ADR-0004's escape-hatch discipline), HTTPS-only at registration, optional HMAC-SHA256 signatures using GitHub's header convention, capability resource exposes counts + names but never URLs or secrets, delivery failures log to stderr and never propagate into the OF read path. Status: Accepted.

- **ADR-0018 — Calendar bridge: EventKit only, Swift-binary subprocess** — formalises the architecture that unblocks [#484](https://github.com/torsday/omnifocus-mcp/issues/484) (calendar + agenda resources). Decisions: EventKit is the sole calendar substrate (third-party APIs handled by separate MCP servers, composed at the agent layer); access via a tiny Swift binary subprocess bundled in `dist/` (rejecting JXA/Calendar.app shim and direct Node FFI for documented reasons); read-only; permission UX mirrors the existing OF Automation prompt. Status: Accepted. ([#603](https://github.com/torsday/omnifocus-mcp/issues/603))

- **README — agent-native value-add lead (closes [#477](https://github.com/torsday/omnifocus-mcp/issues/477))** — new top-of-README section "Agent-native OmniFocus — beyond the app surface" frames the agent-unique capabilities (project-health triage, semantic dedupe, taxonomy audit, NL perspective authoring, time-budget reconciliation, retrospective, project templates, inbox-triage, calendar + agenda) ahead of the existing tool-list content. Honest split between mechanical aggregations the app could have shipped and capabilities only valuable with an LLM in the call path; closes the long-standing narrative gap that the README led with "wrapper" framing rather than the actual value-add.

- **README — Resources table refreshed for 24 URIs (closes [#643](https://github.com/torsday/omnifocus-mcp/issues/643))** — the README's MCP resources table had drifted to ten entries while the resource surface grew to twenty-four. Refreshed to the current set so users browsing the README see the actual capability surface.

- **DESIGN.md §31 — fenced note metadata convention ([#589](https://github.com/torsday/omnifocus-mcp/issues/589))** — formalises the fenced-YAML pattern that `waiting-on`, `decision-journal`, and `project-template` all share. New conventions filed under §31 so agents and contributors have one place to look for "how do we encode structured metadata in a free-text note without forcing the user to see it."

- **Stryker mutation-testing docs (slice 1E of [#502](https://github.com/torsday/omnifocus-mcp/issues/502))** — adds a `mutation-tested: stryker` badge to the README badge row (links to ADR-0017) and a "Mutation testing (release-time hard gate)" section to `CONTRIBUTING.md` covering local run command (`pnpm mutation`, ~6–7 min wall-clock), report locations, the equivalent-mutant policy per ADR §5 (default response to a survivor is to write the test; only observably equivalent mutations belong in `stryker-equivalents.json`, with a one-line rationale), the release-time gate placement, and how to query live calibration freshness via `internal_status`.

### Build

- **Stryker mutation testing — installation, calibration, and release-time hard gate (slices 1A/1B/1C of [#502](https://github.com/torsday/omnifocus-mcp/issues/502))** — three slices land Stryker as a release-time quality gate per [ADR-0017](./docs/adr/0017-mutation-testing.md). Slice 1A added the dependencies (`@stryker-mutator/core`, `typescript-checker`, `vitest-runner`), `stryker.conf.json` with the ADR §2 mutator allowlist (`src/domain`, `src/errors`, `src/middleware`, `src/server`, tool input-validation schemas), the `pnpm mutation` script, and the `stryker-equivalents.json` scaffold with the §5 header convention. Slice 1B captured the calibration baseline — 2740 mutants instrumented across 35 source files, 6m42s wall-clock, mutation score **62.74%** — and set `thresholds.break = baseline − 5 = 57.74` per ADR §3. Three slice-1A defects were fixed during calibration: removed nonexistent `ignorers` plugin references, dropped two empty allowlist globs, and added an explicit `plugins:` array because pnpm's strict node_modules layout breaks Stryker's auto-discovery in spawned children. Slice 1C wired `pnpm mutation` into `release.yml` between `pnpm test` and `pnpm build`; the gate fails the release on any drop below `thresholds.break`, and the HTML + JSON reports upload as a `mutation-report-<tag>` workflow artifact (90-day retention, `if: always()` so a failed run still uploads). Runs once per release tag, not per PR.

- **Calendar bridge — Swift scaffold + build pipeline (slices 1–5 of [#484](https://github.com/torsday/omnifocus-mcp/issues/484))** — five slices land the Swift `calendar-bridge` subprocess and Node-side wrapper that the calendar/agenda resources ride on. Adds `tools/calendar-bridge/calendar-bridge.swift` and `scripts/build-calendar-bridge.sh` (mirroring `build-watcher.sh`: single-arch / `--all` for fat universal binary / `--verify` for typecheck-only). Build hooks: `pnpm build:calendar-bridge` and `pnpm build:calendar-bridge:all`. Binaries gitignored. Subcommands lay down progressively: `ping`, `permission` (read-only `EKEventStore.authorizationStatus(for: .event)` — does NOT trigger TCC prompt), `request-access` (calls `requestFullAccessToEvents` on macOS 14+, falls back to `requestAccess(to:completion:)` for older macOS — first invocation triggers the TCC prompt), and finally `calendar FROM TO` (event read via `predicateForEvents(withStart:end:calendars:)` + `events(matching:)` with hand-rolled JSON output). The Node-side `CalendarBridge` wrapper spawns the binary as a one-shot subprocess and parses one JSON line of stdout. Constructor accepts `{ binaryPath, spawn, existsSync }` overrides for tests, so the wrapper has full coverage on Linux CI without a built binary or TCC grant.

- **Bundle budget bumps for new subsystems** — bundle-size budget raised in step with new code: 610 → 625 KiB for the perspective-write tools (#577), then to 680 KiB through the webhooks subsystem (#483). Each bump landed with the slice that consumed it; the budget remains enforced in `release.yml` via `scripts/check-bundle-size.sh`.

- **Lint allowlist — `src/webhooks/` may import `node:https`** — the repo's `customRules.ts` `no-network-import` rule and `biome.json` `noRestrictedImports` were extended with a `src/webhooks/` allowlist so the dispatcher can call `node:https.request`. Per ADR-0016, outbound HTTPS is permitted only there.

- **CI — required-status-checks documentation ([#648](https://github.com/torsday/omnifocus-mcp/issues/648))** — documents which CI checks `main` branch protection requires, so contributors don't get blocked merging when an advisory check fails. No behavior change.


## [1.1.0](https://github.com/torsday/omnifocus-mcp/compare/v1.0.2...v1.1.0) (2026-04-28)

**Summary** — The headline additions are project templates, waiting-on tracking, and several new analytics resources. Alongside new tools, the entire tool surface went through a focused NL-quality pass: every description now carries a worked `Example:` line, every mutation response pairs a human-readable name alongside the opaque ID, and enum inputs accept common aliases so loosely-worded agent inputs succeed rather than bounce. Agents calling this server cold will be able to compose correct calls with substantially less trial-and-error. No breaking changes; all v1.0.x call shapes are unchanged.

### Added

- **Project templates — `project_template_save`, `project_template_list`, `project_template_instantiate`** — capture a project's task tree as TaskPaper into a `Templates` folder (folder name configurable via `OMNIFOCUS_TEMPLATES_FOLDER_NAME`), then spawn a new project from any saved template with `{{placeholder}}` substitution and automatic `@due`/`@defer` date-shifting anchored to the template's earliest due date. Parameters are validated on instantiation — every declared `{{name}}` must have a supplied value, and all missing names are reported in a single typed `MissingTemplateParameter` error. Convention documented in DESIGN.md §30. ([#472](https://github.com/torsday/omnifocus-mcp/issues/472), [#587](https://github.com/torsday/omnifocus-mcp/issues/587))

- **Waiting-on tracking** — `task_set_waiting_on` and `task_clear_waiting_on` write/strip a fenced YAML block at the top of a task's note recording `whom`, `what`, `since`, and `followUpAfter`. The configured `@waiting` tag is added/removed automatically. `task_get` and `task_get_many` surface a structured `waitingOn` field on affected tasks. New `omnifocus://waiting-on` resource lists every open waiting-on task sorted by days overdue. ([#482](https://github.com/torsday/omnifocus-mcp/issues/482))

- **`perspective_get` and `perspective_delete`** — `perspective_get` returns the full rule tree for a custom perspective so agents can inspect what it filters without evaluating it. `perspective_delete` removes it and invalidates the perspective cache. Both reject built-in perspective IDs with a typed error; both require OmniFocus Pro. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))

- **`*_describe` preview tools for every write operation** — a companion `task_create_describe`, `project_create_describe`, etc. returns a human-readable summary of what the live call would do, without touching OmniFocus. Lets agents confirm intent before firing a mutation. ([#494](https://github.com/torsday/omnifocus-mcp/issues/494))

- **`database_undo` and `database_redo`** — exposes OmniFocus's undo/redo stack so agents can recover from mistakes without manual user intervention. ([#544](https://github.com/torsday/omnifocus-mcp/issues/544))

- **`task_extract_from_image`** — vision tool that accepts a base64-encoded image and returns structured task proposals extracted from handwritten notes, whiteboard photos, or screenshots. ([#486](https://github.com/torsday/omnifocus-mcp/issues/486))

- **`task_extract_from_note`** — parses free-form prose (meeting notes, bullet lists, brain dumps) into structured `task_batch_create` candidates with optional project and tag assignments. ([#536](https://github.com/torsday/omnifocus-mcp/issues/536))

- **`task_reclassify`** — moves a task between inbox, project, or parent with a mandatory dry-run first pass showing the proposed change before committing. ([#545](https://github.com/torsday/omnifocus-mcp/issues/545))

- **`task_find_similar`** — lexical-similarity search across task names to detect near-duplicates before creating new tasks. ([#543](https://github.com/torsday/omnifocus-mcp/issues/543))

- **`task_convert_to_project`** — promotes a task to a first-class project via `Database.convertTasksToProjects`, preserving subtasks and metadata.

- **`task_set_alarms` and `task_clear_alarms`** — add or remove OmniFocus notification alarms on a task; supports absolute-date, relative-to-due, and relative-to-defer alarm types. ([#461](https://github.com/torsday/omnifocus-mcp/issues/461))

- **`repetition_from_prose`** — deterministic converter from natural-language repetition strings ("every weekday", "every 2 weeks on Monday") to a validated `RepetitionRule` ready for `task_create` or `task_update`. ([#535](https://github.com/torsday/omnifocus-mcp/issues/535))

- **`forecast_pack`** — time-budget reconciliation: given a target date and a daily minute budget, assigns tasks from the Forecast view into day buckets and surfaces overloaded days. ([#473](https://github.com/torsday/omnifocus-mcp/issues/473))

- **Forecast tag preference (`forecast_get_tag`, `forecast_set_tag`)** — read and write the OmniFocus Forecast tag preference (the tag whose tasks appear in the Forecast view). ([#465](https://github.com/torsday/omnifocus-mcp/issues/465))

- **`project_set_next_review_date`** — set the next scheduled review date on a project without waiting for the review cycle to elapse naturally. ([#467](https://github.com/torsday/omnifocus-mcp/issues/467))

- **`app_window_new` and `app_window_new_tab`** — open a new OmniFocus window or a new tab on the frontmost window for guided-review flows. ([#558](https://github.com/torsday/omnifocus-mcp/issues/558))

- **`window_set_focus` and `window_set_perspective`** — set the focus context and switch the active perspective on the front window, enabling agent-driven guided workflows. ([#466](https://github.com/torsday/omnifocus-mcp/issues/466))

- **`task_batch_assign` + inbox-triage prompt** — bulk-assign tags, projects, and dates to a list of task IDs in one round trip; paired with a built-in `inbox-triage` MCP prompt that sequences the tool calls for a full GTD-style processing sweep. ([#539](https://github.com/torsday/omnifocus-mcp/issues/539))

- **`deferDateFloating` and `dueDateFloating` on all date-bearing tools** — mark a date as "floating" (timezone-independent) at the field level, matching OmniFocus's own semantics for travel-friendly tasks. ([#462](https://github.com/torsday/omnifocus-mcp/issues/462))

- **Seven new read resources:**
  - `omnifocus://intents` — index of every tool grouped by the eight core verb intents, for agent orientation ([#530](https://github.com/torsday/omnifocus-mcp/issues/530))
  - `omnifocus://project-health` — stalled-project triage: projects with no incomplete tasks, overdue reviews, or no activity in 30+ days ([#534](https://github.com/torsday/omnifocus-mcp/issues/534))
  - `omnifocus://retrospective` — completed-task summary over a caller-specified date range ([#474](https://github.com/torsday/omnifocus-mcp/issues/474))
  - `omnifocus://stats` — database statistics (task counts by status, project counts, tag usage) ([#533](https://github.com/torsday/omnifocus-mcp/issues/533))
  - `omnifocus://velocity` and `omnifocus://burndown` — completion-rate and open-task-trend analytics over rolling windows ([#513](https://github.com/torsday/omnifocus-mcp/issues/513))
  - `omnifocus://taxonomy-audit` — detects tag and project name collisions before a batch import causes duplicates ([#509](https://github.com/torsday/omnifocus-mcp/issues/509))
  - `omnifocus://recent-activity` — session-priming snapshot of tasks touched in the last N hours, useful for resuming context at the start of a session ([#505](https://github.com/torsday/omnifocus-mcp/issues/505))

- **Response envelope improvements** — every `ok` response now carries a `hints[]` array (agent-readable suggestions about next steps) and a `humanReadableSummary` string (one-line confirmation of what was just done). Both fields are defined in ADR-0015. ([#524](https://github.com/torsday/omnifocus-mcp/issues/524))

### Improved

- **NL-quality: `Example:` on every tool description** — all ~95 `*_DESCRIPTION` constants now end with at least one `Example: tool_name({ … })` line; multi-mode tools include 2–3 representative examples. Agents can construct a first call from the description alone. ([#570](https://github.com/torsday/omnifocus-mcp/issues/570))

- **NL-quality: name paired with id in all mutation responses** — tools that previously returned a bare `{ id }` now return `{ id, name }`. Agents can confirm what was just created or modified without a follow-up `*_get` call. Covers task verbs, project verbs, batch operations, attachments, notes, and forecast-tag operations. ([#572](https://github.com/torsday/omnifocus-mcp/issues/572), [#585](https://github.com/torsday/omnifocus-mcp/issues/585), [#590](https://github.com/torsday/omnifocus-mcp/issues/590), [#592](https://github.com/torsday/omnifocus-mcp/issues/592), [#597](https://github.com/torsday/omnifocus-mcp/issues/597), [#606](https://github.com/torsday/omnifocus-mcp/issues/606))

- **NL-quality: forgiving enum aliases** — status, completion-criterion, and related fields now accept common synonyms (`"done"`, `"dropped"`, `"active"`, etc.) alongside the canonical values. Mis-typed or loosely-worded agent inputs are accepted rather than rejected. ([#573](https://github.com/torsday/omnifocus-mcp/issues/573))

- **NL-quality: `zodToActionable` input-error rewriting** — Zod validation failures at the tool boundary are translated into structured, agent-actionable messages naming the failing field and stating the accepted value set, instead of surfacing raw Zod issue arrays. ([#575](https://github.com/torsday/omnifocus-mcp/issues/575))

### Fixed

- **Repeating-task IDs accepted everywhere** — OmniFocus appends a `.N` suffix to IDs of repeating-task instances (e.g. `abc123.1`). These were previously rejected by the ID validator, causing lookups on the second and later occurrences of a repeating task to fail. ([#497](https://github.com/torsday/omnifocus-mcp/issues/497))

- **`export_taskpaper` includes project-level tasks** — tasks attached directly to the project node were silently dropped from TaskPaper exports. ([#499](https://github.com/torsday/omnifocus-mcp/issues/499))

- **JXA date metadata no longer throws on inaccessible objects** — certain completed tasks returned a `can't get object` AppleScript error when `creationDate`/`modificationDate` were read. The JXA layer now guards these reads and returns `null` instead. ([#498](https://github.com/torsday/omnifocus-mcp/issues/498))

- **`tag_list`/`folder_list` null filters treated as no-filter** — passing `null` for an optional filter (e.g. `parentId: null`) was misinterpreted as an active filter and returned empty results. ([#515](https://github.com/torsday/omnifocus-mcp/issues/515))

### Performance

- **`forecast_get` ~50× faster** — bucket filters are pushed into the JXA `whose()` clause so OmniFocus evaluates them database-side rather than returning all tasks and filtering in JavaScript. Cold fetches on large databases drop from 4–8 s to under 200 ms. ([#500](https://github.com/torsday/omnifocus-mcp/issues/500))

### Documentation

- **Setup guides for OpenCode and Pi** — `docs/clients/opencode.md` covers OpenCode's `opencode.json` MCP config format. `docs/clients/pi.md` documents that Pi (pi.ai) has no MCP client support as of mid-2025. ([#559](https://github.com/torsday/omnifocus-mcp/issues/559))
- **Homebrew tap** — `torsday/homebrew-tap` now carries a formula; the release workflow patches it automatically after each npm publish. Non-Node users can install via `brew install torsday/tap/omnifocus-mcp`.
- **ADR-0015** — NL-excellence response envelope (hints, humanReadableSummary). ([#524](https://github.com/torsday/omnifocus-mcp/issues/524))
- **ADR-0017** — mutation testing as release gate. ([#528](https://github.com/torsday/omnifocus-mcp/issues/528))
- **ADR-0018** — calendar bridge architecture: EventKit only, Swift-binary subprocess.

## [1.0.2](https://github.com/torsday/omnifocus-mcp/compare/v1.0.1...v1.0.2) (2026-04-26)

**Summary** — One contributor-facing fix and one architectural-decision spike note; otherwise an internal-infrastructure release validating the post-v1.0.1 release flow under the new release-please + OIDC + PAT identity. **Bytes on the wire are identical to v1.0.1**: the published bundle, tool surface, tool descriptions, and runtime behaviour are unchanged. Consumers running `npx -y @torsday/omnifocus-mcp` see no difference. Internal-only commits (CI hygiene, release-please workflow tuning, comment-block cleanups) are intentionally hidden from this CHANGELOG by `release-please-config.json` and are not enumerated below.

### Fixed

- **`scripts/seed-integration-db.js` runs under ESM** — `package.json` declares `"type": "module"`, so every `.js` file is interpreted as ESM by Node. The seed script was the lone holdout still using CommonJS `require()` and threw `ReferenceError: require is not defined in ES module scope` at the first line of execution. One-line conversion: `const { spawnSync } = require("node:child_process")` → `import { spawnSync } from "node:child_process"`. Affects only contributors running `pnpm test:integration` locally or the `integration.yml` workflow on `mac-local`; the published package's runtime is unchanged. ([#448](https://github.com/torsday/omnifocus-mcp/issues/448))


### Documentation

- **Tier-3 CHANGELOG-action spike resolved — don't automate** — `docs/spikes/2026-04-tier-3-changelog-action.md` records the decision: stick with the existing manual `/release-notes` polish flow rather than building a GitHub Action that auto-polishes the Release PR via the Anthropic API. Three structural reasons in the note: ~10 min/release × ~6 releases/year is roughly 1 hour/year of polish work — automation that adds operational surface (new repo secret, rotation burden, API outage as a release-block failure mode) to save 1 hour/year is the wrong trade; the skip-the-polish decision (chore-only releases need no polish) requires maintainer judgment that an action can't make; and with a Closed contributing stance there are no future maintainers to onboard. Empirical anchor: v1.0.1's polish — the first release under release-please — showed substantial quality delta from auto-draft to polished prose at acceptable manual cost. ([#432](https://github.com/torsday/omnifocus-mcp/issues/432))

## [1.0.1](https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...v1.0.1) (2026-04-26)

**Summary** — Documentation polish pass. The README, SPEC, DESIGN, and `docs/project-views.md` are now aligned with the post-v1.0.0 reality of the project (public, shipped, npm-published) rather than the pre-1.0 framing they carried at v1.0.0's tag. Quick Start is restructured so every supported MCP client — not only Claude Desktop — gets equal-footing setup instructions; a new agent-readable Security & trust section surfaces the existing threat-model guarantees with file-level enforcement references. No behavioural or API changes: bytes on the wire, tool surface, and tool descriptions are identical to v1.0.0.

### Fixed

- **PR-title lint allows periods inside the subject** — the bash port of [`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request)'s `subjectPattern` in `pr-title.yml` was stricter than the original. `[^.]*` in the middle banned every period, so release-please's auto-PRs with version numbers in the title (e.g. `chore(main): release 1.0.1`) failed lint. The middle is now `.*`; only the trailing character is constrained to non-period and non-space. Behaviour matches the original action. ([6170320](https://github.com/torsday/omnifocus-mcp/commit/6170320ea72bfb0e71444d1685e29a02d47eec3d))

### Documentation

- **README — agent-agnostic Quick Start with per-client matrix** — Quick Start step 2 leads with the universal `command + args + env` shape, then surfaces a per-client matrix as expandable `<details>` blocks (alphabetical: Claude Code, Claude Desktop, Cline, Codex, Cursor, Windsurf, Generic). Each block names the file path and serialization (JSON vs TOML). Previous flow led with Claude Desktop and treated other clients as a "any MCP client uses the same shape" footnote — the new flow makes finding your client a one-line scan of the `<summary>` headers. New `docs/clients/codex.md` mirrors the structure of the existing `claude-code.md` / `claude-desktop.md` / `generic-stdio.md` guides (prerequisites, install, config snippet, verification, Automation permission, env vars, troubleshooting). The setup-guide table at the bottom of the README now includes Codex and is alphabetised. ([#433](https://github.com/torsday/omnifocus-mcp/issues/433))

- **README — Security & trust section** — new top-level section between Quick Start and Example interactions (~70 lines, well inside the 60–100-line target). Every guarantee links to enforcement code or file evidence: the no-network-import lint rule (`src/linting/customRules.ts` Rule 4), the `installStdoutGuard()` contract test (`src/server/stdoutGuard.test.ts`), the prod dependency list (`package.json` — six packages, no analytics SDK, no `postinstall`/`preinstall` lifecycle scripts), `redactConfig` (`src/config/env.ts`), and `assertAttachmentPath` (`src/attachment/assertAttachmentPath.ts`). Three "verify it yourself" recipes — source audit, Sigstore attestation via `npm view dist.attestations`, and tarball file-count via `npm view dist.tarball | tar -tzvf -`; the recipe's expected file count was verified against the actually-published v1.0.0 artifact (5 files: `LICENSE`, `dist/index.js`, `package.json`, `CHANGELOG.md`, `README.md`). The opt-in `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` escape hatch is enumerated by name with audit-log behaviour and ADR-0004 cited. ([#422](https://github.com/torsday/omnifocus-mcp/issues/422))

- **README + SPEC + DESIGN — refreshed post-1.0 framing** — README "Status and roadmap" lead replaced "v1.0.0 is in preparation for npm release" with shipped-state framing that links the [npm package](https://www.npmjs.com/package/@torsday/omnifocus-mcp), the [Project board](https://github.com/users/torsday/projects/4), and the `[Unreleased]` CHANGELOG section. SPEC.md front-matter changed from `Status: Draft — assumptions flagged for review` to `Status: v1.0 — locked` with the explicit note that future scope changes route through ADRs, not edits to that file. DESIGN.md front-matter from `Status: v1 Draft — design-complete, implementation-ready` to `Status: v1.0 — implemented and shipped 2026-04-25`. `docs/project-views.md` status enum updated from the old six-state list (`Ready · Todo · In Progress · In Review · Blocked · Done`) to the canonical current six (`Backlog · Up Next · In Progress · In Review · On Hold · Done`); the frozen pre-1.0 issue count was removed. ([#425](https://github.com/torsday/omnifocus-mcp/issues/425))

- **README — CI status badge** — adds a status badge for the `main` branch's CI workflow at the top of the README. A glance at the repo's GitHub page now shows whether `main`'s last run is green without clicking through to the Actions tab. ([#438](https://github.com/torsday/omnifocus-mcp/pull/438))

- **`docs/runner-setup-macos-omnifocus.md` — new self-hosted runner setup guide** — step-by-step setup for the `macos-omnifocus` runner that hosts the integration test workflow, including how to launch OmniFocus on user-session start (LaunchAgent) so tag-pushed integration runs don't fail with the "OmniFocus is not running" preflight error. Pairs with the integration-fixture seed step landed in #426. ([#443](https://github.com/torsday/omnifocus-mcp/pull/443))

## [Unreleased]

### Fixed

- **`moveProject` routes through OmniJS + JXA folder-readback survives OF 4.x quirk (closes #681)** — fourth fix in the [ADR-0019](./docs/adr/0019-cross-transport-id-interoperability.md) series. The first slice of #681 routed `createProject` through OmniJS but left `moveProject` on JXA, where `target.move({ to: folder.projects.end })` fails with "Attempted to move data objects to a nil container" on OmniJS-created project specifiers. New `src/scripts/omnijs/project_move.js` uses `moveSections([proj], destination)` and resolves the destination via `flattenedFolders.filter(...)` (or `library` for the root). Routing flips `moveProject: "jxa"` → `"omnijs"`. Separately, the JXA folder-readback path on every project script (`project_get.js`, `project_get_many.js`, `project_list.js`, `project_create.js`, `project_update.js`) carried the same broken `f.class() !== "document"` guard that #673 already fixed for tasks: `f.class()` throws "Can't convert types" on a real Folder specifier in OmniFocus 4.x JXA, so the readback was silently returning `folderId: null` for every project in a folder. Replaced with the nested-try-catch pattern from #673 — treat the throw as "real folder", treat a successful return of `"document"` as the only skip path. The moveProject integration test now passes; project reads through JXA correctly surface `folderId` again.
- **`duplicateTask` routes through OmniJS for cross-transport ID interoperability (closes #692)** — third sibling fix in the [ADR-0019](./docs/adr/0019-cross-transport-id-interoperability.md) series after [#680](https://github.com/torsday/omnifocus-mcp/issues/680) (createTask) and [#681](https://github.com/torsday/omnifocus-mcp/issues/681) (createProject). JXA's `task.duplicate()` and `container.make({...})` produce transient specifier IDs that downstream OmniJS reads can't resolve. OmniJS's `duplicateTasks([source], position)` and `new Task(name, position)` produce clones whose `id.primaryKey` is interoperable with both transports. New `src/scripts/omnijs/task_duplicate.js` mirrors the JXA props-copy surface (name, note, flagged, defer/due dates, estimatedMinutes, sequential, tags) and resets completion state on the clone (matching the JXA contract). Recursive clones use `duplicateTasks` and walk the resulting subtree to clear inherited `completed` flags; non-recursive clones build a single fresh task via `new Task(...)` — naturally produces an uncompleted childless result. Routing flips `duplicateTask: "jxa"` → `duplicateTask: "omnijs"`. Three of four duplicateTask integration tests now pass (was 1 of 4). The recursive case partially passes — `descendantCount` correct, but its downstream `listTasks({ parentId })` assertion still trips on a separate pre-existing JXA filter bug where parentId returns grandchildren too. Will file a follow-up for that.
- **`createTask` routes through OmniJS for cross-transport ID interoperability (closes #680)** — sibling fix to [#681](https://github.com/torsday/omnifocus-mcp/issues/681). Per [ADR-0019](./docs/adr/0019-cross-transport-id-interoperability.md), JXA's `Task(props) + push()` returned a transient specifier ID that didn't match OmniFocus's persistent `id.primaryKey`, breaking subsequent OmniJS-routed downstream operations (`moveTask`, `reorderTask`, `duplicateTask`) which use the persistent key. New `src/scripts/omnijs/task_create.js` mirrors the JXA props-set surface (parent-task / project / inbox positions, note, flagged, defer/due dates, estimatedMinutes, tagIds, sequential, completedByChildren) and produces a task whose ID round-trips correctly across both transports. Routing-table flip: `createTask: "jxa"` → `createTask: "omnijs"`. Five of the seven named integration tests in #680 now pass: `createTask with projectId places the task in that project`, `moveTask into a project updates projectId`, and four `reorderTask` variants. The three `duplicateTask` failures and the `reorderTask validation when reference has different parent` failure trace to separate root causes (filed as follow-ups). Caller wrappers, OmniJsTransport contract, router exclusivity allowlist, and the routing-domain unit tests all updated to reflect the move; concurrent-test JXA-write fixtures now demonstrate via `updateTask` (still JXA-routed) since `createTask` is no longer the canonical example.

---

## [1.0.0] — 2026-04-25

**Summary** — First public release of `@torsday/omnifocus-mcp`. Ships the full MCP surface for OmniFocus on macOS: 80 typed tools, 10 read-only resources, and 4 workflow prompts. Every tool returns the uniform `{ data, meta } | { error, meta }` envelope per ADR-0013, with typed errors carrying `suggestion` and `remediationClass`. Mutation tools support optimistic concurrency (`expectedModifiedAt`), dry-run preview, and idempotency keys. A live database watcher drives targeted cache invalidation.

**Install**

```jsonc
// Claude Desktop or Claude Code MCP config
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp@1.0.0"]
    }
  }
}
```

Verify with `npx -y @torsday/omnifocus-mcp@1.0.0 --version`.

**Compatibility** — Node 24+ • macOS 12+ (Monterey, Ventura, Sonoma, Sequoia) • OmniFocus 4.x • MCP protocol 2024-11-05

### Tool surface (80 tools)

Full catalog with parameter tables and example responses: [`docs/tools.md`](./docs/tools.md).

- **Tasks** — list, get, get-many, search (cursor-paginated; optional keyword plus `available` / `dueBefore` / `dueAfter` / tag / project filters), create, update, complete, uncomplete, drop, undrop, delete (requires `confirm: true`), move, reorder, duplicate, batch create / update / complete / delete / drop
- **Projects** — list, get, get-many, create, update, delete, move, set-status, review-set
- **Tags** — list, get, get-many, create, update, delete
- **Folders** — list, get, create, update, delete
- **Perspectives** — list, evaluate (seven built-ins; OmniFocus Pro custom perspectives via OmniJS)
- **Forecast** — get (`date` + `days` ergonomic interface, or raw `from`/`to` range; multi-day responses include `byDate[]`)
- **Review** — list-due, mark-reviewed
- **Notes** — get, set, append
- **Attachments** — list, add, get, remove (path-validated against `OMNIFOCUS_ATTACHMENT_PATHS`)
- **Sync** — status, force-sync
- **OPML / TaskPaper** — `import_opml`, `export_opml`, `import_taskpaper`, `export_taskpaper`
- **Internal** — status, set-config
- **Escape hatch (opt-in via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`)** — `run_jxa_script`, `run_omnijs_script`; every invocation audit-logged

### Resources & prompts

- **10 read-only MCP resources** at `omnifocus://snapshot`, `omnifocus://inbox`, `omnifocus://project/{id}`, `omnifocus://tag/{id}`, … — agents can pass `_links` URIs from any tool response directly to `resources/read`. The snapshot payload includes `lastSyncAt` and `inFlight` so agents can detect stale data without a separate `sync_status` round-trip.
- **4 workflow prompts** — `daily-review`, `weekly-review`, `capture-meeting`, `project-planning`

### Mutation safety

- **`idempotency_key`** on every mutation — first call executes and caches the full envelope; retries within TTL replay verbatim with `meta.idempotentReplay = true`; concurrent calls coalesce onto a single in-flight promise. LRU+TTL store with env-tunable capacity (`OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES`, default 1024) and TTL (`OMNIFOCUS_IDEMPOTENCY_TTL_MS`, default 600 000).
- **`expectedModifiedAt`** — ISO-8601 optimistic concurrency guard. Rejects stale writes with `OF_CONFLICT` before touching OmniFocus.
- **`dry_run`** — returns a preview envelope with `meta.dryRun = true`; performs no mutation and no cache invalidation.
- **`confirm: true` on `task_delete` / `task_batch_delete`** — schemas require explicit confirmation before any adapter call runs, closing a class of accidental-permanent-deletion bugs.

### Performance & reliability

- **30s LRU read cache** invalidated on every mutation (ADR-0006) with thundering-herd coalescing on concurrent reads of the same key
- **Live database watcher** — native Swift `FSEventStream` binary streams change events for every `.ofocus` write; targeted `cache.invalidate` per changed object plus per-object `omnifocus://` resource notifications instead of a blanket clear
- **Per-tool sliding-window rate limiter** — default 120 calls / 60s, surfaced via `meta.rateLimit` on every response
- **Dual-threshold loop detector** — warns with `WARN_LOOP_DETECTED` at ≥5 identical calls / 60s; errors with `OF_LOOP_DETECTED` at ≥10
- **Circuit breaker** around the JXA and OmniJS transports — sustained failures fast-fail with `OF_CIRCUIT_OPEN`; closes again on a successful half-open probe
- **`ReadPool` + `WriteQueue`** concurrency primitives per ADR-0009 — bounded-concurrency reads (`OMNIFOCUS_READ_POOL_SIZE`, default 2); single-slot serial writes with soft-cap backpressure (`OMNIFOCUS_WRITE_QUEUE_CAP`, default 50) that throws `OF_QUEUE_FULL` when saturated
- **OmniFocus version gate** — lazy single-flight detection caches `{ version, edition }` on first probe; tools requiring Pro or a minimum version throw a typed `FeatureRequires*` error before any adapter call

### Type system & contracts

- **Branded ID types** (`TaskId`, `ProjectId`, `FolderId`, `TagId`) prevent cross-kind ID confusion (ADR-0008)
- **ISO-8601 with offset** date strings at all adapter boundaries (ADR-0007)
- **Uniform response envelope** — `{ data, meta }` on success, `{ error, meta }` on failure (ADR-0013)
- **`ResponseMeta`** carries `correlationId`, `durationMs`, `cacheHit`, `transport`, `ofVersion`, `syncPending`, `warnings`, `rateLimit`; plus optional `dryRun` and `idempotentReplay`
- **Typed error hierarchy** — `NotFound`, `ValidationError`, `PermissionDenied`, `OmniFocusNotRunning`, `Timeout`, `RateLimited`, `CircuitOpen`, `LoopDetected`, `Conflict`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`, `QueueFull`, `TransportUnavailable` — each with `code`, `suggestion`, and `remediationClass`
- **Structured warning codes** — `WARN_IDS_NOT_FOUND`, `WARN_RESULT_TRUNCATED`, `WARN_SYNC_PENDING`, `WARN_DEPRECATED_FIELD`, `WARN_DRY_RUN`, `WARN_LOOP_DETECTED`
- **Cursor pagination** with `filterHash` validation — swapping filters mid-sequence fails loud
- **`_links` navigation hints** on `Task` and `Project` — `omnifocus://noun/id` URIs for self, related project, parent, tags, and folder

### Security

- **Attachment path validator** — allowlist via `OMNIFOCUS_ATTACHMENT_PATHS` (default `$HOME`), symlink-escape protection, hard-deny on `/System`, `/Library`, `/private/System`, `/private/Library`
- **Raw-script tools opt-in only** — `run_jxa_script` and `run_omnijs_script` register only when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; every invocation emits an audit log event with the full script body (ADR-0004)
- **No network I/O** — enforced by a lint rule that forbids `http`, `https`, `node-fetch`, `axios`, `undici` imports
- **Stdout guard** — stray writes to stdout raise an error (MCP uses stdio; any byte corrupts the protocol)
- **No-metadata-interpolation custom lint rule** — user content (task names, notes, tag names) cannot appear in protocol metadata fields (`suggestion`, `error.message`, `meta.warnings`)
- **Config secrets redacted** from the `server.started` structured log event

See [`SECURITY.md`](./SECURITY.md) for the full security policy and reporting channel.

### Developer experience

- Generated tool catalog at [`docs/tools.md`](./docs/tools.md) — parameter tables, example calls, example responses; kept in sync via the `pnpm docs:check` CI gate
- Permission Denied troubleshooting runbook at [`docs/troubleshooting.md`](./docs/troubleshooting.md) covering macOS 12–15
- Property-based tests (fast-check) for cursor codec, `RepetitionRule` schema, transport-text parser
- Snapshot tests lock every tool description; a custom lint rule enforces the four-section description shape (what / when-not / returns / side-effects)
- E2E harness spawns the bundled server and speaks MCP over stdio
- Adapter contract test harness — every `OmniFocusAdapter` implementation must satisfy a parameterised suite (CRUD + filter semantics + typed errors)
- Transport chaos harness covers every DESIGN §19 failure mode (OmniFocus not running, automation permission denied, hard timeout, malformed JSON, `osascript` ENOENT, empty stdout, unclassified script error)

### Breaking changes

None. This is the initial release.

---

[Unreleased]: https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/torsday/omnifocus-mcp/releases/tag/v1.0.0
