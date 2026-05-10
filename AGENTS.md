# omnifocus-mcp

MCP server exposing the full OmniFocus surface to LLM agents via `@modelcontextprotocol/sdk`. TypeScript + Node.js. Talks to OmniFocus via **JXA** (primary) and **OmniJS** (fallback for features JXA can't reach).

## Always-on engineering context

Follow the standards in, in priority order:

1. `/coding` — SOLID, pure functions, typed errors, Goldilocks testing
2. `/adr` — options-first architecture, R/S/M eval, ADR discipline
3. MCP tool design: atomic, composable, rich responses, actionable errors, idempotency, circuit breakers
4. Interaction style: direct, precise, no filler

### Per-directory `CLAUDE.md` files

Three subtrees ship a directory-scoped `CLAUDE.md` — agents that respect Claude Code's auto-load convention pick these up automatically when working under the matching path. Read them before editing files in those areas; they capture invariants the source files don't restate.

- `src/scripts/jxa/CLAUDE.md` — `osascript` runtime distinction, OF 4.x quirks (`container()` not `parent()`, `containingProject().class()` exception handling), the two test harnesses (bridge mock vs sandboxed JS-eval).
- `src/envelope/CLAUDE.md` — response-envelope pipeline (project → elide → truncate → cap), defaults registry, the per-tool `verbose` contract.
- `src/tools/CLAUDE.md` — adding a tool (4 touch points), descriptionShape lint, common pitfalls.

**Finding tools:** Read `src/tools/INDEX.md` for a one-line-per-tool index grouped by domain. Much cheaper than grepping across the tool source tree.

## Project-specific conventions

- **Adapter seam is sacred.** Services never see `osascript` or URL schemes. The `OmniFocusAdapter` interface is the only boundary between domain logic and the OS. Tests swap in `InMemoryAdapter`.
- **Scripts are first-class source files.** Every JXA/OmniJS script lives in `src/scripts/{jxa,omnijs}/*.js`, parameterized via `JSON.parse` of a single argument. No inline script strings in service code.
- **Tool naming:** `<noun>_<verb>` snake_case — `task_list`, `task_create`, `project_mark_reviewed`. Consistent verbs across nouns.
- **IDs only, never names.** OmniFocus names collide and change. All references use OF's persistent IDs at the API boundary.
- **Dates are ISO-8601 with offset** at the adapter boundary. OF's local-time strings stay inside the adapter.
- **Mutations invalidate the 30s LRU read cache.** Never bypass the cache layer directly.
- **Rich notes round-trip.** Task notes expose both `note` (plain) and `noteHtml` (fidelity). Prefer plain on read unless explicitly requested.
- **Attachments by path, never bytes.** Binary payloads don't belong in MCP text responses.

## Commands

```bash
pnpm install              # install deps
pnpm build                # tsup bundle → dist/
pnpm dev                  # tsx watch mode
pnpm test                 # vitest (unit only; mocked adapter)
pnpm test:integration     # requires OMNIFOCUS_INTEGRATION=1 and a live OF
pnpm lint                 # biome check
pnpm format               # biome format --write
pnpm typecheck            # tsc --noEmit
```

## Environment variables

- `OMNIFOCUS_INTEGRATION` — set to `1` to run integration tests against live OF
- `OMNIFOCUS_ALLOW_RAW_SCRIPT` — set to `1` to enable the `run_jxa_script` / `run_omnijs_script` escape-hatch tools (off by default)
- `OMNIFOCUS_LOG_LEVEL` — `trace` | `debug` | `info` | `warn` | `error` (default `info`); logs go to **stderr** — never stdout (stdout is MCP transport)
- `OMNIFOCUS_CACHE_TTL_MS` — override read-cache TTL (default 30000)

## Gotchas

- First `osascript` invocation triggers macOS Automation permission prompt. Surface a typed `PermissionDenied` error with instructions if it's denied.
- OmniFocus must be running for most operations. Adapter detects and raises `OmniFocusNotRunning` — don't auto-launch without a user-facing tool for it.
- Mutations don't propagate across devices until `sync_trigger` runs — document on every write tool.
- JXA is single-threaded relative to OF's main thread. Serialize mutations; never parallelize writes.
- Never log to stdout. MCP uses stdio transport and any stray stdout byte corrupts the protocol.

## Model split

Every open issue carries a `model: opus` or `model: sonnet` label. `/next` filters candidates by the label matching the current model.

**Use Opus** for: concurrency primitives, async/callback races, integration seams that cross ≥3 primitives, batch atomicity, subtle correctness. Issues currently tagged: adapter/transport work (#16, #17, #18, #19, #20, #22), lifecycle (#25), test harnesses (#30, #31), first-service-integration and update-surface (#36, #39, #41), custom perspective evaluate (#55), repetition schema (#60), batch ops (#65), raw-script escape hatch (#75), E2E harness (#80).

**Use Sonnet** for everything else: well-specified primitives, schema helpers, standalone docs and config, most CRUD surface, test scaffolding.

Expected split: ~20% Opus, ~80% Sonnet. Re-label if an issue's complexity profile shifts during implementation.

## Branch and PR conventions

- Work on whatever branch the user is on; never branch without being asked
- Never commit, stage, unstage, or push without explicit instruction
- Conventional Commits via `/commit` when asked
- PR review via `/review-pr`

## Workflow slash commands

Project-local (in `.claude/commands/`) override global skills when in this repo.

| Command         | Scope         | Does                                                                                                |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `/next`         | project-local | Pick highest-priority Ready issue, implement end-to-end, keep board honest                          |
| `/adr`          | project-local | Write ADR with correct numbering, cross-refs to DESIGN/CLAUDE/README                                |
| `/issue`        | project-local | Create GitHub issue with project labels, milestone, project-board add, field population             |
| `/release`      | project-local | Cut release — version, CHANGELOG, tag, npm publish, GitHub release                                  |
| `/commit`       | global        | Atomic Conventional Commits from staged changes                                                     |
| `/review-pr`    | global        | PR review across correctness, reliability, design, tests, security                                  |
| `/coding`       | global        | Engineering standards — always-on via AGENTS.md but invokable on demand                             |
| `/debug`        | global        | Reproduce → isolate → hypothesize → verify → fix                                                    |
| `/refactor`     | global        | Refactor for engineering excellence                                                                 |
| `/refactor-changes` | global    | Pre-commit quality gate on current diff                                                             |
| `/security-review` | global     | Severity-graded security audit                                                                      |
| `/unit-tests`   | global        | Goldilocks unit tests                                                                               |
| `/integration-tests` | global   | Contract-verified integration tests                                                                 |
| `/spec`         | global        | Interview → write SPEC.md                                                                           |
| `/tasking`      | global        | Decompose spec → sequenced task list                                                                |
| `/tracker`      | global        | Setup/refactor issue tracker                                                                        |
| `/release-notes` | global       | CHANGELOG + release notes                                                                           |
| `/observability` | global       | Logging, metrics, tracing, alerting                                                                 |

## Loop cadence

For `/loop` dynamic mode (no interval specified) in this project, default `ScheduleWakeup` to **60 seconds** — back-to-back iterations, not the skill's 1200–1800s idle default. Ship-refactor cycles are long and self-contained; the next cycle should start as soon as the current one finishes close-out.

## CI status — current known issues

- **Runner policy — two tiers:**
  - `ci.yml` and `integration.yml` run on `[self-hosted, macos]` (labels: `self-hosted, macOS, ARM64, macos-omnifocus`). OS parity matters for `ci.yml` (Node behaviour on macOS); `integration.yml` requires a live OmniFocus install. These must never move to a hosted runner without an explicit decision.
  - Admin workflows (`release-please.yml`, `meta-lint.yml`, `board-sync.yml`, `pr-link.yml`, `pr-title.yml`, `issue-lint.yml`, `verify-constants.yml`, `post-merge-close.yml`) and `release.yml` run on `ubuntu-latest`. They perform pure `gh` CLI / Node / shell admin work with no macOS or OmniFocus dependency. The public-repo unlimited-minutes budget means no billing concern.
  - `meta-lint.yml`'s `no-hosted-runners` job enforces this policy — `scripts/verify-no-hosted-runners.sh` fails the build if any non-allowlisted workflow uses a GitHub-hosted runner. The allowlist in that script is the canonical record of exceptions.
- **Integration CI requires macOS Automation permission.** `integration.yml` runs JXA scripts against a live OmniFocus on `mac-local`. The runner's shell process must have Automation access to OmniFocus (System Settings → Privacy & Security → Automation) or all tests fail with `"JXA script returned empty stdout"`.
- **Optional `RELEASE_PLEASE_TOKEN` repo secret** (#447) — when set, `release-please.yml` uses it instead of `GITHUB_TOKEN`. Reason: `GITHUB_TOKEN`-authored events don't trigger downstream workflows (GitHub's recursive-runs safety), so release-please's auto-PR doesn't fire CI and its merged tag doesn't fire `release.yml` — both have to be re-triggered manually. A PAT (or, preferred, a fine-scoped GitHub App token) bypasses that. The workflow falls back to `GITHUB_TOKEN` when the secret is absent, so today's behaviour is unchanged; create the secret to remove the manual re-triggers from the release flow.
- **Branch protection is unavailable** on this plan (private repo, free tier) — nothing gates merge on CI. `gh pr merge --auto` behaves like immediate merge. Prefer explicit `gh pr merge <N> --rebase --delete-branch` after local verification.

## Files agents should not Read directly

These files are large, generated, or both. Reading them directly wastes token budget without adding insight — the canonical source is cheaper and more accurate.

| File | Size | Why to skip | Use instead |
|---|---|---|---|
| `src/tools/__snapshots__/descriptions.snapshot.test.ts.snap` | ~207 KB | Snapshot of every tool description; grep hits are broad and noisy | Tool source files in `src/tools/<domain>/<verb>.ts` |
| `docs/tools.md` | ~180 KB | Auto-generated by `scripts/generate-tool-docs.ts`; header says "do not edit manually" | Tool source files, or `src/tools/INDEX.md` for one-line summaries |
| `pnpm-lock.yaml` | ~134 KB | Lockfile — content is machine-managed | `pnpm list <pkg>` or `pnpm why <pkg>` to query a pinned version |
| `src/prompts/__snapshots__/omnifocus.test.ts.snap` | ~19 KB | Snapshot of prompt content | Source files in `src/prompts/` |

These files are marked `linguist-generated` in `.gitattributes` so GitHub collapses them in PR diffs and excludes them from language statistics.

## Calling this MCP from an agent

The conventions below cover the runtime contract for an agent **using** the deployed MCP server (as distinct from the contributor-facing material above). They were previously embedded in `README.md`; the canonical home is here so an agent reads them once.

### IDs, not names

Every OmniFocus resource — tasks, projects, tags, folders — is identified by a **persistent opaque ID** (e.g. `"hKx9vLmNp2"`). Names collide and change; IDs don't. Always resolve names to IDs with the corresponding `*_list` tool before calling any other tool.

### Error codes and what to do next

Every error carries a stable `code`, a human-readable `suggestion`, and a machine-readable `remediationClass`:

| `remediationClass` | Meaning | Your action |
|--------------------|---------|-------------|
| `environment` | OmniFocus is not running, permissions denied, or a Pro/version feature is missing | Stop. Surface `suggestion` to the user; do not retry automatically |
| `input` | Bad ID, invalid field value, schema violation, or loop detected | Fix the input using `details` for specifics; retry |
| `transient` | Timeout, rate limit, queue full, or circuit open | Wait `details.retryAfterMs` ms, then retry once |
| `infrastructure` | JXA or OmniJS script failed | Retry once; if still failing, surface to user |
| `lifecycle` | Server is shutting down | Reconnect to a fresh server instance |

`RateLimited` and `CircuitOpen` always include `details.retryAfterMs` (default `60000` ms). Do not poll faster than that.

### Dates

All date inputs accept either **ISO-8601 with UTC offset** (`"2026-04-22T09:00:00-07:00"`) or a **relative shortcut**:

`today` · `tomorrow` · `yesterday` · `this-week` · `next-week` · `end-of-week` · `end-of-month`

Shortcuts resolve to midnight in the server's local timezone.

### Mutations and sync

Every write tool returns the full updated domain object, not just an acknowledgement. The response `meta.syncPending` is `true` immediately after a write — OmniFocus has saved locally but not yet synced to iCloud. Call `sync_trigger` if cross-device visibility matters; otherwise sync happens automatically within a few minutes.

### Null consistency

All optional scalar fields are **always present** in responses, set to `null` when unset. You can safely destructure without null-checks on field presence.

### Idempotency — safe retries

`project_create`, `project_update`, and `project_delete` accept an optional `idempotency_key?: string`. If you supply one and the call succeeds, replaying the exact same key within 5 minutes returns the cached result with `meta.idempotentReplay: true` and skips the OmniFocus call. Use a deterministic key scoped to your session and intent (e.g. `"session-abc/create-project-finance"`).

### Dry-run — validate before committing

`task_update` and `project_update` accept `dry_run?: boolean`. When `true`, input is fully validated and the would-be result is returned, but nothing is written to OmniFocus. `meta.dryRun: true` is set on the response.

### Additive tag edits — no read-modify-write needed

`task_update` accepts `addTags`, `removeTags`, and `setFlagged` patch fields alongside the existing full-replacement `tagIds` field. Prefer these for incremental edits — they apply a diff atomically inside the write queue with no race against concurrent user edits.

### Conflict detection — optimistic concurrency

`task_update` accepts `expectedModifiedAt`. If the task was modified since your read, the server returns `OF_CONFLICT` (`remediationClass: "input"`). Re-read with `task_get`, merge your changes, and retry with the fresh `modifiedAt`.

### Loop detection — don't get stuck

If you call the same tool with identical arguments 5+ times in a 60-second window, the server appends `WARN_LOOP_DETECTED` to `meta.warnings`. At 10 repetitions it throws `OF_LOOP_DETECTED` (`remediationClass: "input"`). Act on the result of your previous call rather than repeating it.

### Capabilities pre-flight

Read `omnifocus://capabilities` once at session start. It returns OF version, edition (Standard/Pro), transport availability, and feature flags (`customPerspectives`, `forecastTag`, `rawScriptTools`). Use it to skip Pro-gated tools rather than discovering unavailability via error.

### Rate limit state — self-throttle before hitting the wall

Every response includes `meta.rateLimit?: { remaining: number; resetAt: string }`. Check this after each call. If `remaining < 10`, slow down. If `remaining === 0`, do not call before `meta.rateLimit.resetAt`. The default limit is 120 calls/min per tool.

### Structured warnings — act on `meta.warnings[].code`

Non-fatal issues appear in `meta.warnings` as `{ code, message, suggestion?, details? }`. Switch on `code`, not `message`:

| `code` | Means | Action |
|---|---|---|
| `WARN_IDS_NOT_FOUND` | Some IDs in a bulk call were not found | Check `details.missing` |
| `WARN_RESULT_TRUNCATED` | Response hit size limit; more items exist | Follow pagination cursor |
| `WARN_SYNC_PENDING` | Write saved locally; iCloud sync not yet triggered | Call `sync_trigger` if needed |
| `WARN_LOOP_DETECTED` | Same tool+args called ≥5 times in 60s | Act on previous result before repeating |

### Incremental sync — `updatedSince`

`task_list` accepts `updatedSince?: string` (ISO-8601 or relative shortcut). Use it to fetch only changed items after your initial load:

```jsonc
// First call: full load
{ "available": true, "limit": 200 }

// Subsequent calls: only changes
{ "available": true, "updatedSince": "2026-04-21T10:00:00-07:00", "limit": 200 }
```

Note: deleted items cannot be surfaced via `updatedSince` — compare `meta.snapshot` counts if you need to detect deletions.

### Navigation hints — follow `_links`

Every `Task` response includes `_links` with resource URIs for related objects:

```jsonc
{
  "id": "hKx9vLmNp2",
  "_links": {
    "self": "omnifocus://task/hKx9vLmNp2",
    "project": "omnifocus://project/pXY3",
    "tags": ["omnifocus://tag/tABC"]
  }
}
```

Pass the ID fragment to `task_get`, `project_get`, etc. You never need to construct a URI manually.

### Response envelope

All responses have this shape:

```jsonc
// success
{ "data": { … }, "meta": { "correlationId": "…", "durationMs": 12, "cacheHit": false, "transport": "jxa", "syncPending": false } }

// error
{ "error": { "code": "OF_NOT_FOUND", "remediationClass": "input", "message": "…", "suggestion": "…", "details": { … } }, "meta": { … } }
```

### Where to start

- **Daily work**: `task_list` (inbox or today filter) → `task_create` / `task_update` / `task_complete`
- **Projects**: `project_list` → `project_create` / `project_update`
- **Finding things**: `task_search` (keyword + optional tag/project/date filters); `tag_list` for available tags
- **Bulk ops**: `task_batch_create` / `task_batch_update` / `task_batch_complete` for up to 50 items atomically
- **Sync**: `sync_trigger` after bulk mutations; `internal_status` to check server health

## Reference docs

- `README.md` — project overview with architecture at a glance
- `SPEC.md` — functional scope and resolved decisions
- `DESIGN.md` — architecture and options evaluated (28 sections covering envelope, IDs, dates, pagination, concurrency, lifecycle, security, testing, CI, observability, config, distribution, versioning, deps, example tool, i18n, resources)
- `docs/clients/README.md` — index of the 6 client integration guides (Claude Code, Claude Desktop, Codex, OpenCode, Pi, generic stdio); read this for any client-specific routing question
- `docs/domain-reference.md` — canonical OmniFocus schemas and glossary
- `docs/project-views.md` — recommended GitHub Project board views
- `CONTRIBUTING.md` — patterns, conventions, PR template
- GitHub Issues — live backlog at [github.com/torsday/omnifocus-mcp/issues](https://github.com/torsday/omnifocus-mcp/issues)
- GitHub Project — live board at [github.com/users/torsday/projects/4](https://github.com/users/torsday/projects/4)
- `docs/adr/` — load-bearing decisions:
  - 0001 TypeScript + Node 24 runtime
  - 0002 JXA + OmniJS dual transport
  - 0003 `<noun>_<verb>` tool namespacing
  - 0004 opt-in raw-script tools
  - 0005 scripts as first-class files
  - 0006 30s LRU invalidate-on-write cache
  - 0007 ISO-8601 with offset on all dates
  - 0008 branded opaque ID types
  - 0009 read pool + write queue + OmniJS queue
  - 0010 stdio as sole MCP transport
  - 0011 semver + public contract definition
  - 0012 distribution via npx/npm
  - 0013 uniform tool response envelope
  - 0014 E2E harness uses an in-memory adapter switch
