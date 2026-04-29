# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.


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

### Added

- **`omnifocus://project-health` honors decision-journal entries (slice 2 of #485)** — closes the AC tail of [#485](https://github.com/torsday/omnifocus-mcp/issues/485): the project-health resource partitions flagged projects into a new `acknowledged: ProjectHealthEntry[]` array when the project's note contains an active `decision-journal` fence (per slice 1). Each `acknowledged` entry carries the `decision` payload so callers can surface the user's recorded judgment ("Strategic pause until Q3 budget cycle") inline instead of re-litigating it. When a decision's `until` passes, the project re-emerges in `projects` automatically — the fence is preserved as audit history, not deleted. Malformed fences degrade silently (no decision, project stays flagged). Both partitions sort independently by severity (review-overdue → longest no-activity → no-available-tasks). Resource description updated; 6 new tests cover the partition, the `until` expiry, future-`until` retention, malformed-fence degradation, empty-list shape, and severity sort within `acknowledged`. Refs [#485](https://github.com/torsday/omnifocus-mcp/issues/485).
- **`decision_record` + `decision_clear` — agent memory of user judgment via `decision-journal` fence (slice 1 of #485)** — two new tools that record and clear a `decision-journal` fenced YAML block on a task or project note, so future agent-driven scans can honor the user's "yes I know, that's deliberate" instead of re-litigating the same anomaly every cycle. `Decision` carries a `kind` from a closed set (`stall-is-intentional` / `deferred-by-choice` / `blocked-on-external` / `awaiting-decision` / `acknowledged-zombie` — extensible across releases), a human-readable `reason`, an automatically-set `recordedAt`, and an optional `until` ISO-8601 auto-expiry (`isDecisionActive` returns false when `until` is in the past). Both targets — tasks and projects — accept decisions; `decision_record` discriminates on `targetKind`. The fence reuses the shared `noteFences` helper from #482, so `waiting-on` and `decision-journal` blocks coexist on the same note without conflict. Read-side integration: `task_get`, `task_get_many`, `project_get`, and `project_get_many` now surface a `decision` field whenever a fence is present (or a `decisions` map keyed by id on the *_many variants). Slice 2 will integrate with `project_health` (#468) to partition stalled projects into a separate `acknowledged` array — auditable, not invisible. DESIGN.md §31 documents the convention. ([#485](https://github.com/torsday/omnifocus-mcp/issues/485))
- **`task_defer_smart` + `task_batch_defer_smart` — intent-bearing defer-date grammar** — two new tools that wrap `task_update`'s defer path with a high-level intent so agents stop landing tasks on weekends or 11pm. `DeferIntent` is a discriminated union with six variants: `next-work-day` (Mon if today is Fri/Sat/Sun, else tomorrow; at the configured morning or afternoon hour), `next-weekday: { weekday: 0..6 }` (next *strict* occurrence — today→full week away if the day matches), `in-business-days: { days: N }` (skips weekends; returns morning hour), `next-month-start` (first of next month, midnight), `explicit-with-skip-weekends: { date: ISO }` (snaps forward to Monday if the input lands on Sat/Sun), and `after-event: { eventId }` (gated on calendar bridge — currently throws a typed `CalendarBridgeUnavailable` for follow-up). Morning/afternoon defaults via env: `OMNIFOCUS_MORNING_HOUR` (default 9), `OMNIFOCUS_AFTERNOON_HOUR` (default 14). Resolution is pure (no I/O); tests inject `now` deterministically. The tool composes with `dry_run`, `idempotency_key`, and `expectedModifiedAt` like the rest of the write surface. Returns `{ taskId, resolvedDeferDate, reason }` so the agent can echo `"deferred to Mon 27 Apr 09:00 (next work morning)"` verbatim. The batch variant accepts `entries: [{ taskId, intent }]` and surfaces per-entry success/error rows so one malformed intent does not abort siblings. ([#479](https://github.com/torsday/omnifocus-mcp/issues/479))
- **`perspective_get` — read a custom perspective's full configuration** — returns `{ id, name, aggregation, rules, iconColor }` for a custom perspective by identifier. Surfaces the structured rule tree (`archivedFilterRules`) so agents can introspect what a perspective filters on without evaluating it. Routes via OmniJS — JXA exposes only `id`/`name`/`class` on perspective specifiers. Built-in perspective ids are rejected with a typed validation error since they have no rule tree. Custom perspectives require OmniFocus Pro. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **`perspective_delete` — delete a custom perspective by id** — removes a custom perspective via OmniJS `deleteObject` (JXA cannot delete custom perspectives). Built-in perspectives are rejected with a typed validation error. The tool invalidates the `perspective:*` cache scope so subsequent `perspective_list` reads return fresh state. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **Waiting-on tracking — synthetic dependencies via note fence** — new `task_set_waiting_on` and `task_clear_waiting_on` tools tag a task with the configured `@waiting` tag (created if absent; name configurable via `OMNIFOCUS_WAITING_TAG_NAME`, default `waiting`) and write/strip a fenced YAML metadata block (` ```waiting-on … ``` `) at the top of the task note. The fence preserves any existing user prose. `task_get` and `task_get_many` parse the fence and surface a structured `waitingOn: { whom, what?, since, followUpAfter? }` field on the response. New `omnifocus://waiting-on` resource aggregates every active task with a fence, sorted by `daysOverdue` descending (whole days past `followUpAfter`; `null` when unset or still in the future). Designed to systematize follow-ups OmniFocus has refused to model for a decade. ([#482](https://github.com/torsday/omnifocus-mcp/issues/482))
- **Project templates — first slice (`save` + `list`)** — new `project_template_save` captures a project's task tree as TaskPaper into a new project under the configured `Templates` folder (env `OMNIFOCUS_TEMPLATES_FOLDER_NAME`, default `Templates`). Metadata (template name, parameter names, capturedAt) sits in a fenced `project-template` YAML block at the top of the template-project's note; the TaskPaper body sits below. The Templates folder is created lazily on first save. `project_template_list` enumerates every parseable template under that folder (sorted by capturedAt desc, name tiebreak). Duplicate template names within the folder are rejected with a typed `TemplateExists` error. Convention documented in DESIGN.md §30. `project_template_instantiate` (parameter substitution + relative-date shifting) and `project_template_delete` are intentionally out of scope this cycle and filed as follow-ups. ([#472](https://github.com/torsday/omnifocus-mcp/issues/472))
- **`project_template_instantiate` — spawn a project from a saved template** — resolves a template by name within the configured Templates folder, validates that every recorded parameter has a value supplied (reports every missing name in one `MissingTemplateParameter` error), substitutes `{{name}}` placeholders, and shifts every `@due`/`@defer` date by the delta between the template's earliest `@due` and the supplied `dueDate`. Pre-creates the target project (optional `targetFolderId`, default library root) and hands the modified TaskPaper to the existing `importTaskPaper` flow. Returns `{ projectId, taskCount, importWarnings }`. Templates without an `@due` to anchor on instantiate as-is when `dueDate` is supplied (no error — there's nothing to shift). DESIGN §30 expanded with the substitution + anchor rules. ([#587](https://github.com/torsday/omnifocus-mcp/issues/587))
- **`omnifocus://capabilities` — `calendarAccess` block** — sixth slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): the capabilities resource now reports `calendarAccess: { available, permission }`. `available` is `true` when the Swift `calendar-bridge` binary is present and callable; `false` on Linux CI or before `pnpm build:calendar-bridge` ran. `permission` is the live `EKEventStore.authorizationStatus` mapped to `granted | denied | restricted | not-determined`, or `"unknown"` when the bridge isn't available. Probe is read-only — does NOT trigger the macOS Calendar TCC prompt. Lets agents detect grant state at session start without round-tripping through a calendar-read tool that would error. The capabilities-resource registration now accepts `() => Capabilities | Promise<Capabilities>` so the per-read probe can run async. Per ADR-0018. The `omnifocus://calendar` and `omnifocus://agenda` resources land in subsequent slices.
- **`omnifocus://calendar{?from,to}` MCP resource** — seventh slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): new resource returns `{ events: CalendarEvent[] }` from EventKit via the Swift `calendar-bridge` subprocess. Each event carries `id, title, startsAt, endsAt, allDay, calendarName, calendarSource, location?, status (confirmed | tentative | cancelled), isAttendee?` per #484's AC. `from`/`to` query params are ISO-8601; when omitted, defaults span the current local-zone day (00:00 → next-day 00:00). Cached 60s, keyed on the `(from, to, sourcesEnv)` tuple — invalidates on any tuple change. Calendar source filter via `OMNIFOCUS_CALENDAR_SOURCES` (read at request time, not registration time, so operators can change it without restarting). Read-only — no writes to EventKit. Throws `CalendarPermissionDenied` when access has not been granted; `CalendarBridgeUnavailable` when the Swift binary is missing. Per ADR-0018. The `omnifocus://agenda` resource (Node-side merge with the OF Forecast view) lands in the final slice.
- **`omnifocus://agenda{?date}` MCP resource — final slice of #484** — the user-facing payoff: a merged daily view of macOS calendar events and the OmniFocus forecast for the same day. Returns `{ items, floating }` where `items[]` is the sorted timeline (calendar events and timed OF tasks interleaved by `startsAt` ASC) and `floating[]` is the bucket of OF tasks with no `dueDate`. Each `AgendaItem` is a discriminated union on `kind` (`"calendar-event"` or `"of-task"`); calendar entries carry the full `CalendarEvent` shape, OF entries carry `id, name, startsAt, dueDate, deferDate, flagged, projectId, parentId`. `date` query param is ISO-8601; defaults to today (local zone). Cached 60s. De-duplicates tasks across forecast categories (a task that is both `dueToday` and `flagged` appears once). Forecast pulled from the existing `forecastService.get` so cache invalidation, error handling, and Pro-feature gating ride the same code paths the rest of the OF surface uses. Per ADR-0018. Closes [#484](https://github.com/torsday/omnifocus-mcp/issues/484).
- **`internal_status` — `calendarAccess` field** — closes the deferred AC tail of [#484](https://github.com/torsday/omnifocus-mcp/issues/484). Status response gains `calendarAccess: { available, permission } | null` mirroring the field on `omnifocus://capabilities`; routes through the same `probeCalendarAccess()` helper so there's one bridge-probe code path in the server, not two. `null` is reserved for unexpected probe failures (the missing-binary path returns the degraded `{ available: false, permission: "unknown" }` shape so callers can distinguish "bridge isn't built" from "bridge crashed"). Read-only — does NOT trigger the macOS Calendar TCC prompt. ([#637](https://github.com/torsday/omnifocus-mcp/issues/637))

### Changed

- **`task_extract_from_image` — schema discipline refactor (closes #574)** — closes the Class 5 finding from the NL-quality audit. The image-extension validity check (previously a runtime `ValidationError` thrown after Zod parse) and the `attachment-mode source requires attachSourceTo='none'` rule (likewise post-parse) are now expressed as Zod refinements at the input boundary, so violations surface as structured `ActionableValidation` failures keyed on the offending field rather than as opaque error throws partway through the handler. Inner fields on the `source` discriminated-union members (`attachmentId`, `ownerTaskId`, `ownerProjectId`) and the top-level `targetProjectId` gained `.describe()` lines per the rubric. No behavior change for valid inputs; tighter rejection (with structured errors) for invalid ones. The single-tool shape was kept — splitting into propose-then-commit tools was considered but rejected since #479's `task_defer_smart` and `repetition_from_prose` already model the `*_from_prose` pattern as single-tool. ([#574](https://github.com/torsday/omnifocus-mcp/issues/574))

### Documentation

- **ADR-0018 — Calendar bridge: EventKit only, Swift-binary subprocess** — formalises the architecture that unblocks [#484](https://github.com/torsday/omnifocus-mcp/issues/484) (calendar + agenda resources). Decisions: EventKit is the sole calendar substrate (third-party APIs handled by separate MCP servers, composed at the agent layer); access via a tiny Swift binary subprocess bundled in `dist/` (rejecting JXA/Calendar.app shim and direct Node FFI for documented reasons); read-only; permission UX mirrors the existing OF Automation prompt. Status: Accepted. ([#603](https://github.com/torsday/omnifocus-mcp/issues/603))
- **README — agent-native value-add lead** — new top-of-README section "Agent-native OmniFocus — beyond the app surface" frames the agent-unique capabilities (project-health triage, semantic dedupe, taxonomy audit, NL perspective authoring, time-budget reconciliation, retrospective, project templates, inbox-triage, calendar + agenda) ahead of the existing tool-list content. Honest split between mechanical aggregations the app could have shipped and capabilities only valuable with an LLM in the call path; closes the long-standing narrative gap that the README led with "wrapper" framing rather than the actual value-add. ([#477](https://github.com/torsday/omnifocus-mcp/issues/477))

### Build

- **Calendar bridge — Swift scaffold + build pipeline** — first slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): adds `tools/calendar-bridge/calendar-bridge.swift` (a stub that responds to a `ping` subcommand with stable scaffold JSON and exits) and `scripts/build-calendar-bridge.sh` (mirroring `build-watcher.sh` — single-arch / `--all` for fat universal binary / `--verify` for typecheck-only). Build hooks: `pnpm build:calendar-bridge` and `pnpm build:calendar-bridge:all`. Binaries gitignored. No EventKit calls yet — that lands in subsequent slices of #484, along with the permission flow and the `omnifocus://calendar` / `omnifocus://agenda` resources. Per ADR-0018.
- **Calendar bridge — EventKit import + authorization probe** — second slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): the Swift bridge now imports `EventKit` and calls `EKEventStore.authorizationStatus(for: .event)` synchronously (read-only — does NOT trigger the macOS Calendar TCC prompt). New `permission` subcommand emits `{"permission": "granted | denied | not-determined | restricted"}`. The existing `ping` subcommand reports the real authorization state instead of the hardcoded `not-determined` placeholder. `EKAuthorizationStatus.fullAccess` and `.writeOnly` (macOS 14+) both map to `granted` — the bridge is read-only per ADR-0018 §3 so the distinction isn't surfaced. Per ADR-0018. The actual prompt-triggering `requestAccess` flow lands in a subsequent slice along with the `calendar` and `agenda` subcommands.
- **Calendar bridge — `request-access` async authorization flow** — third slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): new `request-access` subcommand calls `EKEventStore.requestFullAccessToEvents(completion:)` on macOS 14+ (with `requestAccess(to:completion:)` fallback for older macOS — both call the same TCC machinery). **First invocation triggers the macOS Calendar TCC prompt**; subsequent invocations return immediately with the cached state. The subprocess blocks on a `DispatchSemaphore` until the EventKit completion handler fires, then exits 0 with `{"granted": bool, "permission": "granted | denied | not-determined | restricted"}`. After the prompt resolves, the binary re-queries `authorizationStatus(for: .event)` so the response carries the stable enum-mapped string alongside the boolean. Per ADR-0018. The `calendar` and `agenda` event-read subcommands land in subsequent slices.
- **Calendar bridge — `calendar` event-read subcommand** — fourth slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): new `calendar FROM TO` subcommand reads events in a `[FROM, TO]` ISO-8601-with-offset range using `EKEventStore.predicateForEvents(withStart:end:calendars:)` + `events(matching:)`. Emits `{"events": [{ id, title, startsAt, endsAt, allDay, calendarName, calendarSource, location?, status, isAttendee? }]}` — full payload shape from #484's AC. `EKParticipantStatus` mapped to the wire-stable `confirmed | tentative | cancelled` set. Argument validation runs before the permission gate so callers get clean ISO-8601 / range errors regardless of TCC state; permission-denied path emits `{"error": "permission-denied", "permission": "..."}` for the Node-side consumer to map to a typed `CalendarPermissionDenied` error. Optional `OMNIFOCUS_CALENDAR_SOURCES` env var (comma-separated, substring match against `calendar.title`, case-insensitive) filters out noisy work calendars per #484's AC. JSON output is hand-rolled (escape helper covers the standard set + UTF-8 + control chars) — single-file, single-purpose binary, no `JSONSerialization` dependency. Per ADR-0018. Node-side `omnifocus://calendar` resource lands in a subsequent slice.
- **Calendar bridge — Node-side TypeScript wrapper** — fifth slice of [#484](https://github.com/torsday/omnifocus-mcp/issues/484): new `src/bridge/calendarBridge.ts` exposes a `CalendarBridge` class with `ping()`, `getPermission()`, `requestAccess()`, and `readEvents(from, to, sources?)` methods. The wrapper spawns the Swift binary as a one-shot subprocess, parses one JSON line of stdout, and surfaces typed errors so callers handle the macOS TCC permission flow and missing-binary cases without parsing strings. Two new `ErrorCode` values + classes: `OF_CALENDAR_PERMISSION_DENIED` / `CalendarPermissionDenied` (environment-class, suggests granting Calendar access in System Settings) and `OF_CALENDAR_BRIDGE_UNAVAILABLE` / `CalendarBridgeUnavailable` (infrastructure-class, suggests `pnpm build:calendar-bridge`). Binary path resolves the same way as the watcher (`<package-root>/bin/calendar-bridge`, mirrored across `src/` dev and `dist/` compiled layouts). Constructor accepts `{ binaryPath, spawn, existsSync }` overrides for tests so the wrapper has full coverage on Linux CI without a built binary or TCC grant. Per ADR-0018. The `omnifocus://capabilities` integration, `omnifocus://calendar` resource, and `omnifocus://agenda` resource land in subsequent slices.
- **Stryker mutation testing — install + minimal config (slice 1A of #502)** — first slice of [#502](https://github.com/torsday/omnifocus-mcp/issues/502): adds `@stryker-mutator/core`, `@stryker-mutator/typescript-checker`, and `@stryker-mutator/vitest-runner` as dev dependencies; lands `stryker.conf.json` with the ADR-0017 §2 mutator allowlist (`src/domain`, `src/errors`, `src/middleware`, `src/server`, tool input-validation schemas) and reporters configured for `html`/`json`/`progress`; adds `pnpm mutation` script; scaffolds `stryker-equivalents.json` with the ADR-0017 §5 header convention (no entries yet — added only with one-line rationale, never reflexively to silence survivors); adds `.stryker-tmp/`, `reports/mutation/`, `stryker.log` to `.gitignore`. **No `break` threshold yet** — calibration run lands in slice 1B and writes the baseline-anchored `break = baseline − 5` per ADR-0017 §3. **No `release.yml` gate yet** — that lands in slice 1C once thresholds are calibrated. Per ADR-0017.
- **Stryker mutation testing — calibration baseline + `thresholds.break` (slice 1B of #502)** — second slice of [#502](https://github.com/torsday/omnifocus-mcp/issues/502): captured the calibration baseline by running `pnpm mutation` end-to-end on a clean main. Result: 2740 mutants instrumented across 35 source files, run completed in 6m42s wall-clock (well under the 15-min ADR §7 budget). Outcome: `killed=1119, survived=491, timeout=6, noCoverage=177, compileError=947` → `mutationScore = (killed+timeout)/(killed+survived+timeout+noCoverage) = 1125/1793 = **62.74%**`. Per ADR-0017 §3, `thresholds.break = baseline − 5 = 57.74` is now set in `stryker.conf.json` — the gate is load-bearing. Slice 1B also fixed three slice-1A defects surfaced by the first real run: (1) `ignorers: ["console-log", "no-empty"]` referenced plugins that don't exist in core and crashed plugin loading — removed; (2) `src/middleware/**/*.ts` and `src/tools/**/schema.ts` globs matched zero files (middleware lives at `src/server/middleware.ts`, already covered; tool schemas are inline in handler files) — both globs dropped, allowlist coverage unchanged; (3) added explicit `plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"]` because pnpm's strict node_modules layout breaks Stryker's default `@stryker-mutator/*` plugin auto-discovery in spawned child processes. **No `release.yml` gate yet** — that lands in slice 1C, which is now unblocked since thresholds are calibrated. Per ADR-0017.
- **Stryker mutation testing — release.yml hard gate + report artifacts (slice 1C of #502)** — third slice of [#502](https://github.com/torsday/omnifocus-mcp/issues/502): adds `pnpm mutation` to the release workflow per ADR-0017 §4, between `pnpm test` and `pnpm build`. The gate fails the release on any drop below `thresholds.break = 57.74` (= calibration baseline − 5) — npm publish is now reachable only when mutation testing confirms the suite still pins down behaviour. The HTML and JSON reports are uploaded as a `mutation-report-<tag>` workflow artifact (90-day retention), with `if: always()` so a failed run still uploads the report needed to triage the regression. Runs once per release tag (`v*.*.*` push), not per PR — matches ADR §4's "once per release" budget and keeps unit-test cycle time unchanged. Per ADR-0017.
- **`internal_status` — `mutation` calibration-freshness field (slice 1D of #502)** — fourth slice of [#502](https://github.com/torsday/omnifocus-mcp/issues/502): the `internal_status` response gains `mutation: { score, lastRunAt } | null`. `score` is the live mutation score computed from `<package-root>/reports/mutation/mutation.json` using Stryker's standard formula `(killed + timeout) / (killed + survived + timeout + noCoverage)`; `lastRunAt` is the report file's mtime as ISO-8601. Returns `null` when no report is present — the published npm tarball ships without `reports/`, so end-user installs degrade cleanly while dev / CI clones surface the live calibration. Probe is read-only and synchronous (no subprocess spawn); injectable via `InternalStatusContext.probeMutationScore` for tests. Per ADR-0017 §3.
- **Stryker mutation testing — README badge + CONTRIBUTING section (slice 1E of #502)** — final slice of [#502](https://github.com/torsday/omnifocus-mcp/issues/502): adds a `mutation-tested: stryker` badge to the README badge row (links to ADR-0017) and a "Mutation testing (release-time hard gate)" section to `CONTRIBUTING.md` covering the local run command (`pnpm mutation`, ~6–7 min wall-clock), where reports land, the equivalent-mutant policy per ADR §5 (default response to a survivor is to write the test; only observably equivalent mutations belong in `stryker-equivalents.json`, and only with a one-line rationale), the release-time gate placement, and how to query live calibration freshness via `internal_status`. Closes [#502](https://github.com/torsday/omnifocus-mcp/issues/502).

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
