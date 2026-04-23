# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

## [Unreleased]

_No unreleased changes._

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
