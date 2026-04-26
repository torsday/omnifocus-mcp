# omnifocus-mcp

[![npm version](https://img.shields.io/npm/v/@torsday/omnifocus-mcp.svg?label=npm)](https://www.npmjs.com/package/@torsday/omnifocus-mcp)
[![CI](https://github.com/torsday/omnifocus-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/torsday/omnifocus-mcp/actions/workflows/ci.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Node: 24+](https://img.shields.io/badge/node-24%2B-brightgreen)](./package.json)
[![Platform: macOS 13+](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey)](https://www.apple.com/macos/)

> **Give any MCP-compatible AI assistant full, typed access to your OmniFocus.** Read your inbox, create tasks, close projects, batch-update dozens of items, evaluate perspectives, trigger sync — all through natural language. `omnifocus-mcp` wires an 80-tool MCP server directly to OmniFocus on macOS via JXA and OmniJS, with circuit breakers, rate limits, and an agent-aware error hierarchy so the assistant knows exactly what to do next when something goes wrong.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Quick start](#quick-start)
- [Example interactions](#example-interactions)
- [Prompts](#prompts)
- [If you are an AI agent](#if-you-are-an-ai-agent)
- [Tools](#tools)
- [Resources](#resources)
- [Transport text DSL](#transport-text-dsl)
- [Architecture at a glance](#architecture-at-a-glance)
- [Status and roadmap](#status-and-roadmap)
- [Install](#install)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Client setup guides](#client-setup-guides)
- [Design documents](#design-documents)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

OmniFocus is a powerful GTD tool, but it's an island. Your tasks sit there while you context-switch between your AI assistant and your task manager, manually copy-pasting notes, updating projects, and trying to keep everything in sync with your actual work.

`omnifocus-mcp` removes that friction. With it connected, your AI assistant can:

- **Capture** — turn a conversation into tasks directly in OmniFocus, with the right project, tags, due dates, and notes, without you touching the app
- **Review** — pull today's overdue items, this week's forecast, or a full project breakdown into context so the assistant can reason about your workload alongside your work
- **Maintain** — batch-defer a pile of overdue tasks, complete a sprint's worth of items, reorganize projects after a meeting debrief
- **Reflect** — ask "what's in my inbox right now?" or "what projects haven't been reviewed in a month?" and get structured, actionable answers

The server is built to a single-user local-first standard: no network surface, no cloud sync, typed errors with agent-readable remediation hints, safe by default.

---

## Quick start

1. **Install**
   ```bash
   npm install -g @torsday/omnifocus-mcp
   ```

2. **Connect your MCP client** — the server speaks the standard MCP stdio protocol. For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
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
   Any MCP client that supports stdio transport (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) uses the same `command` / `args` / `env` shape.

3. **Grant macOS Automation permission** on first use — the app running the MCP server will prompt to control OmniFocus; click **OK**. If denied by mistake: **System Settings → Privacy & Security → Automation → [app] → OmniFocus** ✓

4. **Verify** — ask your assistant: *"Use the internal_status tool and tell me what it returns."*

Detailed per-client guides: [`docs/clients/`](./docs/clients/)

---

## Example interactions

**"What's in my inbox right now?"**

The assistant calls `task_list` with `{ "available": true, "limit": 20 }` and returns a formatted list of actionable inbox tasks with their IDs, due dates, and flags.

---

**"Create a task to 'review Q2 budget' due Friday, flagged, in the Finance project."**

1. Calls `project_list` to find the Finance project ID.
2. Calls `task_create` with `{ "name": "review Q2 budget", "projectId": "<id>", "dueDate": "end-of-week", "flagged": true }`.
3. Returns the created task with its persistent ID and confirms the due date resolved to the correct Friday.

---

**"Mark all my overdue tasks as deferred to tomorrow."**

1. Calls `task_list` with `{ "dueBefore": "today", "available": true }` to find overdue items.
2. Calls `task_batch_update` with `{ "deferDate": "tomorrow" }` for all of them in one atomic call.
3. Reports: *"Deferred 7 overdue tasks to tomorrow. Call sync_trigger if you want iCloud to update immediately."*

---

**"Show me what's due this week in the Work perspective."**

1. Calls `perspective_list` to find the "Work" perspective ID.
2. Calls `perspective_evaluate` with `{ "perspectiveId": "<id>" }` to get tasks in that perspective.
3. Filters and presents items with due dates within the current week.

---

**"I just finished the sprint — complete all tasks in the Mobile App project."**

1. Calls `project_get` to retrieve the project and its tasks.
2. Calls `task_batch_complete` with the full list of task IDs in one call.
3. Confirms the count and suggests calling `sync_trigger` for cross-device visibility.

---

## Prompts

`omnifocus-mcp` ships four **MCP prompt templates** — structured workflows you can invoke by name from any MCP client that supports prompts (e.g. Claude Desktop's prompt picker, or any client that surfaces `prompts/list`).

### `daily-review` — triage your day

Loads your snapshot, overdue tasks, and today's forecast; reschedules or drops overdue items; confirms due-today tasks; processes the inbox. No parameters needed.

```
Use the daily-review prompt
```

### `weekly-review` — walk your projects

Loads every project whose review date has arrived; checks each one for stale tasks; marks it reviewed or completes/drops it. No parameters needed.

```
Use the weekly-review prompt
```

### `capture-meeting` — extract action items

Takes raw meeting notes and creates OmniFocus tasks for every commitment, follow-up, and decision point. Pass the notes as text and optionally a project ID.

```
Use the capture-meeting prompt with notes="Sync with Alice: she'll send the report by Thursday.
Bob to review the contract. Need to schedule follow-up call."
```

Results in two inbox tasks: "Send report to [person]" and "Review contract" with the source sentences as notes.

### `project-planning` — decompose a brief

Creates a new project and populates it with a set of concrete, ordered, one-day tasks derived from a free-text brief.

```
Use the project-planning prompt with name="Q3 Marketing Site" brief="Redesign the marketing
site landing page and pricing page. New brand colors, updated copy, responsive mobile layout.
Launch by end of July."
```

Results in a new OmniFocus project with 8–12 tasks covering design, copy, development, and review phases, ready to schedule and assign.

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

---

## Tools

80 tools are registered, organized by domain. See [`docs/tools.md`](./docs/tools.md) for the full auto-generated reference with input schemas, example calls, and example responses.

### App lifecycle
| Tool | Description |
|---|---|
| `app_launch` | Explicitly launch OmniFocus (idempotent) |

### Tasks
| Tool | Description |
|---|---|
| `task_list` | List tasks with filters (available, flagged, due, project, tag, updatedSince) |
| `task_get` | Get a single task by ID |
| `task_get_many` | Get multiple tasks by ID in one call |
| `task_create` | Create a task (project, tags, due, defer, flag, note, repeat) |
| `task_update` | Update a task (addTags/removeTags, dry_run, expectedModifiedAt) |
| `task_complete` | Mark a task complete |
| `task_uncomplete` | Unmark a completed task |
| `task_delete` | Delete a task |
| `task_drop` | Drop (defer indefinitely) a task |
| `task_undrop` | Restore a dropped task |
| `task_move` | Reparent a task to a different project or parent task |
| `task_reorder` | Reorder a task among its siblings |
| `task_duplicate` | Duplicate a task (optionally recursive) |
| `task_find_by_name` | Find tasks by exact or fuzzy name match |
| `task_search` | Full-text search across task names and notes, with optional tag/project/date/availability filters |
| `task_set_repetition` | Set a repeat rule on a task |
| `task_clear_repetition` | Remove a repeat rule from a task |
| `task_parse_transport_text` | Parse transport text DSL → structured tasks (no side effects) |
| `task_batch_create` | Create up to 50 tasks atomically |
| `task_batch_update` | Update up to 50 tasks atomically |
| `task_batch_complete` | Complete up to 50 tasks atomically |

### Projects
| Tool | Description |
|---|---|
| `project_list` | List projects with filters (folder, status) |
| `project_get` | Get a single project by ID |
| `project_create` | Create a project (idempotency_key supported) |
| `project_update` | Update a project (dry_run, idempotency_key, expectedModifiedAt) |
| `project_complete` | Mark a project complete |
| `project_delete` | Delete a project (idempotency_key supported) |
| `project_drop` | Drop (defer indefinitely) a project |
| `project_move` | Move a project to a different folder |
| `project_mark_reviewed` | Mark a project as reviewed (alias for review_mark_reviewed) |

### Folders
| Tool | Description |
|---|---|
| `folder_list` | List folders |
| `folder_get` | Get a single folder by ID |
| `folder_create` | Create a folder |
| `folder_update` | Rename a folder |
| `folder_delete` | Delete a folder |
| `folder_move` | Move a folder to a parent folder |

### Tags
| Tool | Description |
|---|---|
| `tag_list` | List tags |
| `tag_get` | Get a single tag by ID |
| `tag_create` | Create a tag |
| `tag_update` | Rename a tag |
| `tag_delete` | Delete a tag |
| `tag_move` | Move a tag under a parent tag |
| `tag_set_status` | Set tag status (active/on-hold/dropped) |
| `tag_set_allows_next_action` | Toggle "allows next action" on a tag |
| `tag_get_location` | Get a tag's location in the hierarchy |
| `tag_set_location` | Set a tag's location in the hierarchy |

### Notes
| Tool | Description |
|---|---|
| `note_get` | Get a task or project note (plain text) |
| `note_get_html` | Get a task or project note (HTML) |
| `note_set` | Set a task or project note (plain text, replaces) |
| `note_set_html` | Set a task or project note (HTML, replaces) |
| `note_append` | Append text to a task or project note |

### Attachments
| Tool | Description |
|---|---|
| `attachment_list` | List attachments on a task or project |
| `attachment_add` | Embed a local file as an attachment |
| `attachment_remove` | Remove an attachment by ID |
| `attachment_save_to_path` | Save an attachment's bytes to a local file |

### Perspectives
| Tool | Description |
|---|---|
| `perspective_list` | List all perspectives (built-in and custom) |
| `perspective_evaluate` | Evaluate a perspective and return its tasks |

### Forecast & search
| Tool | Description |
|---|---|
| `forecast_get` | Get today's forecast grouped by overdue / due today / due later / inbox |
| `search_query` | Full-text search across tasks and projects |

### Review
| Tool | Description |
|---|---|
| `review_list_due` | List projects whose next review date is today or past |
| `review_mark_reviewed` | Mark a project as reviewed and set the next review date |
| `review_set_interval` | Set the review interval (days) for a project |

### Sync & app
| Tool | Description |
|---|---|
| `sync_trigger` | Trigger an OmniFocus iCloud sync |
| `sync_status` | Get the last sync timestamp and status |

### Plug-ins
| Tool | Description |
|---|---|
| `plugin_invoke` | Invoke an installed Omni Automation plug-in by bundle identifier |

### Export & import
| Tool | Description |
|---|---|
| `export_opml` | Export a project (or all projects) as OPML |
| `export_taskpaper` | Export a project (or all projects) as TaskPaper |
| `import_opml` | Import tasks from an OPML string into OmniFocus |
| `import_taskpaper` | Import tasks from a TaskPaper string into OmniFocus |

### Observability
| Tool | Description |
|---|---|
| `internal_status` | Server health: transport status, queue depths, cache stats, rate limits |

### Raw scripts _(opt-in, off by default)_
| Tool | Description |
|---|---|
| `run_jxa_script` | Execute arbitrary JXA — requires `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` |
| `run_omnijs_script` | Execute arbitrary OmniJS — requires `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` |

---

## Resources

Ten MCP resources are registered under the `omnifocus://` scheme. Resources are read-only, URI-addressable, and enumerable via `resources/list`.

| URI | Returns |
|---|---|
| `omnifocus://capabilities` | Server capabilities: OF version, edition, transport status, feature flags |
| `omnifocus://snapshot` | Five-count orientation object: inbox, flagged, overdue, dueToday, projectsDueForReview |
| `omnifocus://inbox` | Inbox tasks as `Task[]` |
| `omnifocus://forecast/today` | Today's forecast grouped by overdue / due today / due later / inbox |
| `omnifocus://overdue` | All overdue tasks sorted by dueDate ASC |
| `omnifocus://flagged` | All flagged available tasks |
| `omnifocus://review-due` | Projects with nextReviewDate ≤ today |
| `omnifocus://project/{id}` | Single project + full task tree |
| `omnifocus://tag/{id}` | Single tag + its tasks |
| `omnifocus://perspective/{id}` | Perspective evaluation result (same shape as `perspective_evaluate`) |

---

## Transport text DSL

`task_parse_transport_text` parses a lightweight DSL inspired by OmniFocus Mail Drop into structured task objects. **No tasks are created** — pass the returned `tasks[]` to `task_create` or `task_batch_create` separately.

### Token syntax

| Token | Example | Meaning |
|---|---|---|
| `@tag` | `@work` | Assign a tag by name |
| `#date` | `#2026-05-01` or `#today` | Due date |
| `::date` | `::tomorrow` | Defer date |
| `!!` | `!!` | Flag the task |
| `//text` | `//Call back before noon` | Append as task note |
| `Project: Name` | `Project: Finance` | Set project context for subsequent tasks |

### Date shortcuts

`today` · `tomorrow` · `yesterday` — resolved to midnight local time.

Full ISO-8601 dates (`YYYY-MM-DD`) are also accepted. Unparseable dates emit a `warnings[]` entry.

### Example

```
Project: Work
Prepare Q2 report @work #end-of-week !!
Send draft to Alice @work @email #tomorrow //attach spreadsheet
Follow up with Bob ::next-week

Project: Personal
Buy groceries @errands #today
Call dentist @phone ::tomorrow !! //ask about X-ray appointment
```

Tag names and project names are raw strings — resolve to IDs with `tag_list` and `project_list` before passing to `task_create`.

---

## Architecture at a glance

```mermaid
flowchart LR
    Agent["LLM agent<br/>(any MCP client)"] --> SDK["MCP stdio<br/>transport"]
    SDK --> Tools["Tool &<br/>Resource handlers"]
    Tools --> Services["Service layer"]
    Services --> Cache[(30s LRU<br/>read cache)]
    Cache --> Adapter{OmniFocus<br/>Adapter}
    Adapter --> Router[Transport<br/>Router]
    Router -->|CRUD, forecast, search| Jxa[JxaTransport]
    Router -->|Perspectives, plug-ins,<br/>reorder, reparent| OmniJs[OmniJsTransport]
    Jxa --> OF[(OmniFocus)]
    OmniJs --> OF

    classDef boundary stroke-dasharray: 5 5
    class Adapter boundary
```

**Key design points:**

- **Adapter seam** — services never see `osascript` or URL schemes; `OmniFocusAdapter` is the only OS boundary. Tests swap in an `InMemoryAdapter`.
- **Dual transport** — JXA via `osascript` for CRUD; OmniJS via `evaluateJavascript()` for custom perspectives, plug-ins, reorder, and reparent. A `TransportRouter` picks per operation.
- **Read pool + write queue** — concurrent JXA reads from a configurable pool; mutations serialized through a write queue; OmniJS operations through a separate queue.
- **30s LRU read cache** — invalidated on every write. Mutations are never served stale.
- **Middleware stack** — every registered tool runs through: `assertNotShuttingDown` → `circuitBreaker` → `rateLimitMeta` → `loopDetection`.

The full layered diagram with queues, circuit breakers, and the test adapter lives in [`DESIGN.md §6`](./DESIGN.md#6-architecture).

---

## Status and roadmap

All six milestones shipped. v1.0.0 is in preparation for npm release — see the [unreleased section of the CHANGELOG](./CHANGELOG.md#unreleased) for what's queued.

| Phase | Milestone | Status |
|---|---|---|
| M0 | Foundation + both transports | ✅ Done |
| M1 | Core task & project surface | ✅ Done |
| M2 | Metadata + perspectives (OmniJS) | ✅ Done |
| M3 | Advanced (repeat, notes, review, batch, DSL) | ✅ Done |
| M4 | Long tail (attachments, OPML, sync, plug-ins, raw scripts) | ✅ Done |
| M5 | Polish & release (observability, E2E, CI, docs, npm) | ✅ Done |

Track open issues and future enhancements on the [**GitHub Project board**](https://github.com/users/torsday/projects/4).

---

## Install

```bash
# Global install
npm install -g @torsday/omnifocus-mcp

# Or run without installing (npx)
npx -y @torsday/omnifocus-mcp
```

**Any stdio MCP client** — add to your client's MCP server config (exact key name varies by client):
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

**npx (no global install)**:
```json
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp"],
      "env": { "OMNIFOCUS_LOG_LEVEL": "info" }
    }
  }
}
```

On first run, macOS asks the app running the server for permission to automate OmniFocus. Click **OK**. If you denied it by mistake: **System Settings → Privacy & Security → Automation → [app] → OmniFocus** ✓

See the [troubleshooting guide](./docs/troubleshooting.md) and per-client guides in [`docs/clients/`](./docs/clients/) for detailed setup.

---

## Environment variables

| Variable | What | Default |
|---|---|---|
| `OMNIFOCUS_LOG_LEVEL` | `trace`\|`debug`\|`info`\|`warn`\|`error` — logs go to stderr | `info` |
| `OMNIFOCUS_CACHE_TTL_MS` | Read-cache TTL in milliseconds | `30000` |
| `OMNIFOCUS_READ_POOL_SIZE` | Concurrent `osascript` processes for reads | `2` |
| `OMNIFOCUS_WRITE_QUEUE_CAP` | Max pending writes before `QueueFull` error | `50` |
| `OMNIFOCUS_JXA_TIMEOUT_MS` | Per-call JXA hard timeout in milliseconds | `30000` |
| `OMNIFOCUS_OMNIJS_TIMEOUT_MS` | Per-call OmniJS hard timeout in milliseconds | `45000` |
| `OMNIFOCUS_ATTACHMENT_PATHS` | Colon-separated allowlist of absolute path prefixes for attachment ops | `$HOME` |
| `OMNIFOCUS_MAX_ATTACHMENT_MB` | Maximum attachment file size in MB (0 = no cap) | `100` |
| `OMNIFOCUS_TOOL_RATE_LIMIT` | Per-tool rate limit in `N/SECONDS` format | `120/60` |
| `OMNIFOCUS_ALLOW_RAW_SCRIPT` | Set to `1` to register `run_jxa_script` / `run_omnijs_script` | unset |
| `OMNIFOCUS_INTEGRATION` | Set to `1` to enable the integration test suite | unset |

Full table with override semantics: [`DESIGN.md §22`](./DESIGN.md#22-configuration--environment).

### Running integration tests

Integration tests run against a live OmniFocus install:

```bash
# 1. Make sure OmniFocus is running and Automation permission is granted
# 2. Seed fixture data (idempotent — safe to re-run):
node scripts/seed-integration-db.js

# Optional: wipe and re-create all fixtures from scratch:
node scripts/seed-integration-db.js --clean

# 3. Run the integration suite:
OMNIFOCUS_INTEGRATION=1 pnpm test:integration
```

The seed script creates `mcp-fixture:` prefixed items (folders, projects, tasks, tags) that integration tests rely on.

---

## Troubleshooting

### OmniFocus is not running

**Error:** `OF_NOT_RUNNING` — OmniFocus must be open for most operations.

**Fix:** Launch OmniFocus manually, or call `app_launch` to open it via MCP.

---

### macOS Automation permission denied

**Symptom:** Every tool call returns `OF_PERMISSION_DENIED`.

**Fix:**
1. Open **System Settings → Privacy & Security → Automation**.
2. Find the app running the MCP server (Terminal, your AI client app, or your CI runner's shell).
3. Enable the **OmniFocus** checkbox.
4. Restart omnifocus-mcp.

```bash
bash scripts/check-automation-permission.sh
```

---

### First-call timeout / slow startup

JXA starts an `osascript` subprocess on each call. The first call after a system sleep or a fresh OmniFocus launch can take 5–15 seconds while the database loads. This is normal.

If calls consistently time out:
```bash
OMNIFOCUS_JXA_TIMEOUT_MS=60000 omnifocus-mcp
```

---

### `run_jxa_script` / `run_omnijs_script` not available

**Error:** `ValidationError: run_jxa_script is not available in this adapter configuration`

**Fix:** The raw-script tools are opt-in. Start the server with:
```bash
OMNIFOCUS_ALLOW_RAW_SCRIPT=1 omnifocus-mcp
```

See [`docs/adr/0004-raw-script-escape-hatch.md`](./docs/adr/0004-raw-script-escape-hatch.md) for the security rationale.

---

### Stale data after a write

Writes are saved locally and show up immediately in subsequent tool calls. Changes don't reach other devices until iCloud sync runs. Call `sync_trigger` after bulk mutations or when cross-device visibility matters.

---

### More help

- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — expanded troubleshooting guide
- [`docs/clients/`](./docs/clients/) — per-client setup guides

---

## Client setup guides

| Client | Guide |
|---|---|
| Claude Desktop | [`docs/clients/claude-desktop.md`](./docs/clients/claude-desktop.md) |
| Claude Code (CLI) | [`docs/clients/claude-code.md`](./docs/clients/claude-code.md) |
| Generic stdio client | [`docs/clients/generic-stdio.md`](./docs/clients/generic-stdio.md) |

---

## Design documents

- **[`SPEC.md`](./SPEC.md)** — functional scope and non-functional requirements; resolved v1 decisions
- **[`DESIGN.md`](./DESIGN.md)** — 28-section architecture; options evaluated; R/S/M assessment; example tool implementation
- **[`docs/security.md`](./docs/security.md)** — attack surface, mitigations, and test coverage
- **[`docs/domain-reference.md`](./docs/domain-reference.md)** — OmniFocus glossary, canonical schemas, lossiness matrix for export/import
- **[`docs/adr/`](./docs/adr/)** — Architecture Decision Records covering every load-bearing choice:

| # | Decision |
|---|---|
| [0001](./docs/adr/0001-language-and-runtime.md) | TypeScript on Node.js 24 |
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

---

## Contributing

This is a single-developer project; external contributions are not currently solicited. The design, ADRs, and task backlog are public so the work is inspectable and forkable. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the patterns any contribution would need to follow.

---

## License

[MIT](./LICENSE) — see full text in `LICENSE`.
