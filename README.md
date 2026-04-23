# omnifocus-mcp

[![Status: design-complete](https://img.shields.io/badge/status-design%20complete-blue)](./SPEC.md)
[![Phase: M0](https://img.shields.io/badge/phase-M0%20foundation-orange)](https://github.com/torsday/omnifocus-mcp/milestones)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Node: 20 LTS / 22 LTS](https://img.shields.io/badge/node-20%20%7C%2022-brightgreen)](./package.json)
[![Platform: macOS 13+](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey)](https://www.apple.com/macos/)
[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-yellow)](https://www.conventionalcommits.org)

> **An MCP server exposing the full OmniFocus surface to LLM agents.** Ask Claude or any MCP-compatible client to read, query, create, and modify your OmniFocus tasks, projects, tags, perspectives, and attachments — through 60+ typed tools, built to a "single-user local-first" standard with engineering excellence as a first-class goal.

---

## Table of contents

- [What it is](#what-it-is)
- [Quick start](#quick-start)
- [Example interactions](#example-interactions)
- [If you are an AI agent](#if-you-are-an-ai-agent)
- [Architecture at a glance](#architecture-at-a-glance)
- [Status and roadmap](#status-and-roadmap)
- [Install](#install)
- [Client setup guides](#client-setup-guides)
- [Design documents](#design-documents)
- [Project conventions](#project-conventions)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

1. **Install**
   ```bash
   npm install -g @torsday/omnifocus-mcp
   ```

2. **Connect Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "omnifocus": {
         "command": "omnifocus-mcp",
         "args": [],
         "env": { "OMNIFOCUS_LOG_LEVEL": "info" }
       }
     }
   }
   ```

3. **Connect Claude Code**:
   ```bash
   claude mcp add omnifocus omnifocus-mcp
   ```

4. **Grant macOS Automation permission** on first use — Claude will prompt to control OmniFocus; click **OK**. If denied by mistake: **System Settings → Privacy & Security → Automation → [app] → OmniFocus** ✓

5. **Verify** — ask Claude: *"Use the internal_status tool and tell me what it returns."*

Detailed per-client guides live in [`docs/clients/`](./docs/clients/).

---

## What it is

`omnifocus-mcp` is an MCP (Model Context Protocol) server that gives any MCP-compatible client — Claude Desktop, Claude Code, or any stdio-speaking agent — full, typed, audited access to OmniFocus on macOS.

- **Full coverage.** Tasks, projects, tags, folders, perspectives (built-in and custom), forecast, review, notes, attachments, batch operations, import/export, sync.
- **Two transports, one interface.** JXA via `osascript` for 85% of OmniFocus; OmniJS via the URL scheme for custom perspectives, plug-ins, and newer features. A `TransportRouter` picks per operation; services never see the transport.
- **Typed everything.** Zod at the API boundary, branded opaque IDs, ISO-8601 with offset dates, discriminated error hierarchy.
- **Agent-aware.** Every tool description follows the [`agent_systems.md`](https://github.com/torsday/llm_prompts/blob/main/agent_systems.md) "what / when not / returns / side effects" standard. Errors carry `{ code, message, suggestion, details }` so agents know what to do next.
- **Safe by default.** No network surface, no stdout writes (MCP uses stdio), opt-in escape hatches, circuit breakers, rate limits, write serialization.

## Example interactions

These show the kind of work you can ask Claude to do once omnifocus-mcp is connected.

---

**"What's in my inbox right now?"**

Claude calls `task_list` with `{ "available": true, "limit": 20 }` and returns a formatted list of actionable inbox tasks with their IDs, due dates, and flags.

---

**"Create a task to 'review Q2 budget' due Friday, flagged, in the Finance project."**

1. Claude calls `project_list` to find the Finance project ID.
2. Calls `task_create` with `{ "name": "review Q2 budget", "projectId": "<id>", "dueDate": "end-of-week", "flagged": true }`.
3. Returns the created task with its persistent ID and confirms the due date resolved to the correct Friday.

---

**"Mark all my overdue tasks as deferred to tomorrow."**

1. Claude calls `task_list` with `{ "dueBefore": "today", "available": true }` to find overdue items.
2. For each task, calls `task_update` with `{ "deferDate": "tomorrow" }`.
3. Reports a summary: *"Deferred 7 overdue tasks to tomorrow. Call sync_trigger if you want iCloud to update immediately."*

---

**"Show me what's due this week in the Work perspective."**

Claude calls `perspective_task_list` with `{ "perspectiveName": "Work" }` and `{ "dueWithin": "this-week" }`, then presents a structured view grouped by project.

---

## If you are an AI agent

This section is written for you. It covers the conventions you need to use this MCP effectively without trial and error.

### IDs, not names

Every OmniFocus resource — tasks, projects, tags, folders — is identified by a **persistent opaque ID** (e.g. `"hKx9vLmNp2"`). Names collide and change; IDs don't. Always resolve names to IDs with the corresponding `*_list` tool before calling any other tool.

### Error codes and what to do next

Every error carries a stable `code`, a human-readable `suggestion`, and a machine-readable `remediationClass`:

| `remediationClass` | Meaning | Your action |
|--------------------|---------|-------------|
| `environment` | OmniFocus is not running, permissions denied, or a Pro/version feature is missing | Stop. Surface `suggestion` to the user; do not retry automatically |
| `input` | Bad ID, invalid field value, or schema violation | Fix the input using `details` for specifics; retry |
| `transient` | Timeout, rate limit, queue full, or circuit open | Wait `details.retryAfterMs` ms, then retry once |
| `infrastructure` | JXA or OmniJS script failed | Retry once; if still failing, surface to user |
| `lifecycle` | Server is shutting down | Reconnect to a fresh server instance |

`RateLimited` and `CircuitOpen` always include `details.retryAfterMs` (default `60000` ms). Do not poll faster than that.

### Dates

All date inputs accept either **ISO-8601 with UTC offset** (`"2026-04-22T09:00:00-07:00"`) or a **relative shortcut**:

`today` · `tomorrow` · `yesterday` · `this-week` · `next-week` · `end-of-week` · `end-of-month`

Shortcuts resolve to midnight in the server's local timezone.

### Mutations and sync

Every write tool returns the full updated domain object, not just an acknowledgement. The response `meta.syncPending` is `true` immediately after a write — OmniFocus has saved locally but not yet synced to iCloud. Call `sync_trigger` if cross-device visibility matters; otherwise the sync happens automatically within a few minutes.

### Null consistency

All optional scalar fields are **always present** in responses, set to `null` when unset. You can safely destructure without null-checks on field presence.

### Idempotency — safe retries

Every mutation tool accepts an optional `idempotencyKey?: string`. If you supply one and the call succeeds, replaying the exact same key within 5 minutes returns the cached result with `meta.idempotencyReplay: true` and skips the OmniFocus call. Use a deterministic key scoped to your session and intent (e.g. `"session-abc/create-task-standup"`).

### Dry-run — validate before committing

Every mutation tool accepts `dryRun?: boolean`. When `true`, input is fully validated and the would-be result is returned, but nothing is written to OmniFocus. `meta.dryRun: true` is set on the response. Use this to confirm inputs before destructive operations.

### Additive tag edits — no read-modify-write needed

`task_update` accepts `addTags`, `removeTags`, and `setFlagged` patch fields alongside the existing full-replacement `tags` field. Prefer these for incremental edits — they apply a diff atomically inside the write queue with no race against concurrent user edits.

### Conflict detection — optimistic concurrency

Pass `expectedModifiedAt` with mutations. If the resource was modified since your read, the server returns `OF_CONFLICT` (`remediationClass: "input"`). Re-read with `*_get`, merge, and retry with the fresh `modifiedAt`.

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

### Incremental sync — `updatedSince`

`task_list` and `project_list` accept `updatedSince?: string` (ISO-8601 or relative shortcut). Use it to fetch only changed items after your initial load:

```jsonc
// First call: full load
{ "available": true, "limit": 200 }

// Subsequent calls: only changes
{ "available": true, "updatedSince": "2026-04-21T10:00:00-07:00", "limit": 200 }
```

Note: deleted items cannot be surfaced via `updatedSince` — compare `meta.snapshot` counts if you need to detect deletions.

### Navigation hints — follow `_links`

Every `Task` and `Project` response includes `_links` with resource URIs for related objects:

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

Pass `_links.project` directly to `resources/read` or use the ID fragment for `project_get`. You never need to construct a URI manually.

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
- **Finding things**: `task_search` with `search_query`; `tag_list` for available tags
- **Sync**: `sync_trigger` after bulk mutations; `internal_status` to check server health

---

## Architecture at a glance

```mermaid
flowchart LR
    Agent["LLM agent<br/>(Claude)"] --> SDK["MCP stdio<br/>transport"]
    SDK --> Tools["Tool &<br/>Resource handlers"]
    Tools --> Services["Service layer"]
    Services --> Cache[(30s LRU<br/>read cache)]
    Cache --> Adapter{OmniFocus<br/>Adapter}
    Adapter --> Router[Transport<br/>Router]
    Router -->|CRUD, forecast, search| Jxa[JxaTransport]
    Router -->|Custom perspectives,<br/>plug-ins| OmniJs[OmniJsTransport]
    Jxa --> OF[(OmniFocus)]
    OmniJs --> OF

    classDef boundary stroke-dasharray: 5 5
    class Adapter boundary
```

The full layered diagram with the in-memory test adapter, queues, and circuit breakers lives in [`DESIGN.md §6`](./DESIGN.md#6-architecture).

## Status and roadmap

Design is **complete** (SPEC + DESIGN + 13 ADRs + domain reference). Implementation proceeds across six milestones:

| Phase | Milestone                                           | Ships                                                                   |
| ----- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| M0    | **Foundation + both transports**                    | adapter seam, JXA + OmniJS, pool/queue, cache, errors, lifecycle        |
| M1    | **Core task & project surface + pagination**        | 25+ tools covering daily CRUD                                           |
| M2    | **Metadata + perspectives (OmniJS-enabled)**        | tags, folders, forecast, search, built-in and custom perspectives       |
| M3    | **Advanced**                                        | repetition rules, rich-text notes, review, batch, transport text        |
| M4    | **Long tail**                                       | attachments, taskpaper/opml, sync, plug-in invocation, opt-in raw scripts |
| M5    | **Polish & release**                                | loop detection, `internal_status`, E2E tests, CI, docs, `npx` distribution |

Track live progress on the [**GitHub Project board**](https://github.com/users/torsday/projects/4). The backlog, dependencies, and work order live entirely in [GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues) — pick anything with `Status = Ready`.

## Install

```bash
# Claude Desktop — add to ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp"],
      "env": { "OMNIFOCUS_LOG_LEVEL": "info" }
    }
  }
}

# Claude Code
claude mcp add omnifocus -- npx -y @torsday/omnifocus-mcp

# Or run standalone
npm install -g @torsday/omnifocus-mcp
omnifocus-mcp
```

On first run, macOS asks permission for Claude to automate OmniFocus. Click **OK**. If you denied it by mistake: **System Settings → Privacy & Security → Automation → [app] → OmniFocus** ✓. See the per-client guides in [`docs/clients/`](./docs/clients/) for full troubleshooting steps.

### Environment variables

| Variable                        | What                                                | Default |
| ------------------------------- | --------------------------------------------------- | ------- |
| `OMNIFOCUS_LOG_LEVEL`           | `trace`\|`debug`\|`info`\|`warn`\|`error`            | `info`  |
| `OMNIFOCUS_CACHE_TTL_MS`        | Read-cache TTL                                      | `30000` |
| `OMNIFOCUS_READ_POOL_SIZE`      | Concurrent `osascript` processes for reads          | `2`     |
| `OMNIFOCUS_WRITE_QUEUE_CAP`     | Max pending writes before `QueueFull`               | `50`    |
| `OMNIFOCUS_JXA_TIMEOUT_MS`      | Per-call JXA timeout                                | `30000` |
| `OMNIFOCUS_OMNIJS_TIMEOUT_MS`   | Per-call OmniJS timeout                             | `45000` |
| `OMNIFOCUS_ATTACHMENT_PATHS`    | `$HOME`-rooted allowlist, colon-separated           | `$HOME` |
| `OMNIFOCUS_MAX_ATTACHMENT_MB`   | Max attachment size                                 | `100`   |
| `OMNIFOCUS_TOOL_RATE_LIMIT`     | Per-tool rate limit `N/SECONDS`                     | `120/60`|
| `OMNIFOCUS_ALLOW_RAW_SCRIPT`    | Register `run_jxa_script` / `run_omnijs_script`     | `unset` |
| `OMNIFOCUS_INTEGRATION`         | Enable integration test suite                       | `unset` |

Full table with descriptions and override semantics: [`DESIGN.md §22`](./DESIGN.md#22-configuration--environment).

### Running integration tests

Integration tests run against a live OmniFocus install. Before running them, seed the fixture database:

```bash
# 1. Make sure OmniFocus is running and Automation permission is granted
# 2. Seed fixture data (idempotent — safe to re-run):
node scripts/seed-integration-db.js

# Optional: wipe and re-create all fixtures from scratch:
node scripts/seed-integration-db.js --clean

# 3. Run the integration suite:
OMNIFOCUS_INTEGRATION=1 pnpm test:integration
```

The seed script creates a set of tagged `mcp-fixture:` items (folders, projects, tasks, tags) that integration tests rely on. Re-running the script without `--clean` skips items that already exist.

## Client setup guides

Step-by-step setup, environment variable reference, macOS Automation permission walkthrough, and troubleshooting for each client target:

| Client | Guide |
|---|---|
| Claude Desktop | [`docs/clients/claude-desktop.md`](./docs/clients/claude-desktop.md) |
| Claude Code (CLI) | [`docs/clients/claude-code.md`](./docs/clients/claude-code.md) |
| Generic stdio client | [`docs/clients/generic-stdio.md`](./docs/clients/generic-stdio.md) |

## Design documents

- **[`SPEC.md`](./SPEC.md)** — functional scope and non-functional requirements; resolved v1 decisions
- **[`DESIGN.md`](./DESIGN.md)** — 28-section architecture; options evaluated; R/S/M assessment; example tool implementation
- **[GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues)** + **[Project #4](https://github.com/users/torsday/projects/4)** — live backlog, dependencies, and status across M0–M5 milestones
- **[`docs/domain-reference.md`](./docs/domain-reference.md)** — OmniFocus glossary, canonical schemas, lossiness matrix for export/import
- **[`docs/adr/`](./docs/adr/)** — 13 Architecture Decision Records covering every load-bearing choice:

| # | Decision |
|---|---|
| [0001](./docs/adr/0001-language-and-runtime.md) | TypeScript on Node.js 20 LTS |
| [0002](./docs/adr/0002-omnifocus-transport-dual.md) | JXA + OmniJS dual transport |
| [0003](./docs/adr/0003-tool-surface-namespaced.md) | `<noun>_<verb>` tool namespacing |
| [0004](./docs/adr/0004-raw-script-escape-hatch.md) | Opt-in raw-script tools |
| [0005](./docs/adr/0005-script-assets-as-files.md) | Scripts as first-class files |
| [0006](./docs/adr/0006-read-cache-strategy.md) | 30s LRU, invalidate-on-write |
| [0007](./docs/adr/0007-dates-iso8601-with-offset.md) | ISO-8601 with offset at the boundary |
| [0008](./docs/adr/0008-ids-branded-opaque-strings.md) | Branded opaque ID types |
| [0009](./docs/adr/0009-concurrency-pool-and-queue.md) | Read pool + write queue + OmniJS queue |
| [0010](./docs/adr/0010-mcp-transport-stdio.md) | stdio-only MCP transport (v1) |
| [0011](./docs/adr/0011-versioning-and-stability.md) | Semver with explicit contract |
| [0012](./docs/adr/0012-distribution-npx.md) | Distribution via `npx` / npm |
| [0013](./docs/adr/0013-tool-response-envelope.md) | Uniform response envelope |

## Project conventions

Project conventions (adapter seam, script-asset discipline, ID-only lookups, date contract, cache invalidation, attachments-by-path) live in [`CLAUDE.md`](./CLAUDE.md). Any contribution follows the standards from [`coding.md`](https://github.com/torsday/llm_prompts/blob/main/coding.md), [`systems_design.md`](https://github.com/torsday/llm_prompts/blob/main/systems_design.md), and [`agent_systems.md`](https://github.com/torsday/llm_prompts/blob/main/agent_systems.md).

## Contributing

This is a single-developer project; external contributions are not currently solicited. The design, ADRs, and task backlog are nevertheless public so the work is inspectable and forkable. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the patterns any contribution would need to follow.

## License

[MIT](./LICENSE) — see full text in `LICENSE`.
