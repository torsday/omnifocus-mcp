# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

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

- **`perspective_get` — read a custom perspective's full configuration** — returns `{ id, name, aggregation, rules, iconColor }` for a custom perspective by identifier. Surfaces the structured rule tree (`archivedFilterRules`) so agents can introspect what a perspective filters on without evaluating it. Routes via OmniJS — JXA exposes only `id`/`name`/`class` on perspective specifiers. Built-in perspective ids are rejected with a typed validation error since they have no rule tree. Custom perspectives require OmniFocus Pro. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **`perspective_delete` — delete a custom perspective by id** — removes a custom perspective via OmniJS `deleteObject` (JXA cannot delete custom perspectives). Built-in perspectives are rejected with a typed validation error. The tool invalidates the `perspective:*` cache scope so subsequent `perspective_list` reads return fresh state. ([#523](https://github.com/torsday/omnifocus-mcp/issues/523))
- **Waiting-on tracking — synthetic dependencies via note fence** — new `task_set_waiting_on` and `task_clear_waiting_on` tools tag a task with the configured `@waiting` tag (created if absent; name configurable via `OMNIFOCUS_WAITING_TAG_NAME`, default `waiting`) and write/strip a fenced YAML metadata block (` ```waiting-on … ``` `) at the top of the task note. The fence preserves any existing user prose. `task_get` and `task_get_many` parse the fence and surface a structured `waitingOn: { whom, what?, since, followUpAfter? }` field on the response. New `omnifocus://waiting-on` resource aggregates every active task with a fence, sorted by `daysOverdue` descending (whole days past `followUpAfter`; `null` when unset or still in the future). Designed to systematize follow-ups OmniFocus has refused to model for a decade. ([#482](https://github.com/torsday/omnifocus-mcp/issues/482))
- **Project templates — first slice (`save` + `list`)** — new `project_template_save` captures a project's task tree as TaskPaper into a new project under the configured `Templates` folder (env `OMNIFOCUS_TEMPLATES_FOLDER_NAME`, default `Templates`). Metadata (template name, parameter names, capturedAt) sits in a fenced `project-template` YAML block at the top of the template-project's note; the TaskPaper body sits below. The Templates folder is created lazily on first save. `project_template_list` enumerates every parseable template under that folder (sorted by capturedAt desc, name tiebreak). Duplicate template names within the folder are rejected with a typed `TemplateExists` error. Convention documented in DESIGN.md §30. `project_template_instantiate` (parameter substitution + relative-date shifting) and `project_template_delete` are intentionally out of scope this cycle and filed as follow-ups. ([#472](https://github.com/torsday/omnifocus-mcp/issues/472))
- **`project_template_instantiate` — spawn a project from a saved template** — resolves a template by name within the configured Templates folder, validates that every recorded parameter has a value supplied (reports every missing name in one `MissingTemplateParameter` error), substitutes `{{name}}` placeholders, and shifts every `@due`/`@defer` date by the delta between the template's earliest `@due` and the supplied `dueDate`. Pre-creates the target project (optional `targetFolderId`, default library root) and hands the modified TaskPaper to the existing `importTaskPaper` flow. Returns `{ projectId, taskCount, importWarnings }`. Templates without an `@due` to anchor on instantiate as-is when `dueDate` is supplied (no error — there's nothing to shift). DESIGN §30 expanded with the substitution + anchor rules. ([#587](https://github.com/torsday/omnifocus-mcp/issues/587))

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
