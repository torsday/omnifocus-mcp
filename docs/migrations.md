# Migration and Compatibility Matrix

This document records breaking changes per release, with migration guidance for downstream consumers.
It is complementary to `CHANGELOG.md` (release-please-managed): the changelog records *what* changed;
this document records *how to migrate* and which client versions are affected.

**Maintenance rule:** any PR labelled `breaking-change` **must** update this document as part of the
same commit. CI enforces this via `scripts/verify-migrations-doc.sh`.

---

## Upcoming (unreleased — target v2.0.0)

The following breaking changes are implemented or planned for the next major release as part of the
token-efficiency epic (#770). All changes reduce default response payload size; callers who need the
old shape can opt back in via new flags.

### `content[].text` becomes a fixed placeholder (#883, ADR-0022)

| | |
|---|---|
| **What changed** | `toolResponse()` no longer duplicates the envelope JSON into `content[].text`. The text block is now the literal string `"see structuredContent"`. `structuredContent` is unchanged in shape and content. |
| **Why** | v1 wire format paid the envelope bytes twice — once in `content[].text` (a JSON-stringified copy) and once in `structuredContent` (the typed object). Empirical measurement on canonical workflows showed ≈ 2× byte savings from removing the duplication. Full rationale: [ADR-0022](./adr/0022-envelope-text-content-duplication.md), spike notes in `docs/spikes/2026-05-envelope-text-duplication.md`. |
| **Migration** | Clients should read `result.structuredContent` (the typed envelope) — they should have been doing this all along; the JSON in `content[].text` was always a duplicate. Detect a v1-vs-v2 server with `if (!result.structuredContent) throw new Error("server doesn't return structured envelope")`. |
| **Escape hatch** | Set `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` in the server environment to restore v1 behavior (full JSON in `content[].text`). Read once at module load — server restart required to change. Intended as a temporary bridge while clients migrate; no plan to remove the flag. |
| **Deprecation** | The v1 duplicated-text shape is the *default* removed; the opt-in flag is supported indefinitely. The exact placeholder string `"see structuredContent"` is itself part of the wire contract — renaming it would be another breaking change. |

### `attachment_add` / `attachment_remove` renamed to `attachment_create` / `attachment_delete` (#1051)

| | |
|---|---|
| **What changed** | The canonical attachment-mutation tools are now `attachment_create` and `attachment_delete`, matching the CRUD verb vocabulary used by every other resource (`docs/design/tool-vocabulary.md`, #837). The old names `attachment_add` / `attachment_remove` are retained as **deprecated aliases**. |
| **Why** | `add`/`remove` were the only tools deviating from the universal `create`/`delete` CRUD verbs; the inconsistency hurt agent tool-selection. |
| **Migration** | Call `attachment_create` / `attachment_delete` — identical input and output shapes to the old names. |
| **Deprecation** | `attachment_add` / `attachment_remove` still work for one minor version and emit a `tool.deprecated` log event (`{ tool, replacement }`) on each call. They will be removed in the next major. |

### noteHtml removed from default task/project responses (#791)

| | |
|---|---|
| **What changed** | `noteHtml` no longer appears in default `task_list`, `task_get`, `task_get_many`, `project_list`, `project_get`, `project_get_many`, `task_search`, `forecast_get`, `perspective_evaluate` responses. |
| **Why** | HTML is 3–10× the plaintext byte size. A dedicated `note_get_html` tool already exists. |
| **Migration** | Call `note_get_html({ targetKind: "task", id })` when you need the HTML. Or pass `includeNoteHtml: true` to the listing tool (opt-in flag added alongside this change). |
| **Deprecation** | `noteHtml` is removed from the default shape. `includeNoteHtml: true` opt-in is supported indefinitely. |

### `_links` opt-in via `includeLinks` flag (#792)

| | |
|---|---|
| **What changed** | `_links` HATEOAS blocks are no longer included by default in task/project responses. |
| **Why** | `_links` re-encodes `id`/`projectId`/`tagIds` as `omnifocus://` URIs — ~78–100 bytes of pure duplication per task. LLM agents don't follow URLs. |
| **Migration** | Pass `includeLinks: true` to any listing/get tool to restore the previous behaviour. |
| **Deprecation** | `_links` remains available indefinitely via the opt-in flag. |

### `forecast_get` `byDate` returns `taskIds` not full task objects (#794)

| | |
|---|---|
| **What changed** | `byDate[]` now has shape `{ date: string, taskIds: TaskId[] }` instead of `{ date: string, tasks: Task[] }`. |
| **Why** | The same Task objects already appear in `dueToday`/`overdue`/`flagged` arrays — `byDate` was pure duplication. |
| **Migration** | Build a map of `id → task` from the top-level arrays, then dereference `byDate[i].taskIds`. Example: `const byId = Object.fromEntries([...dueToday, ...overdue].map(t => [t.id, t])); byDate.forEach(b => b.taskIds.map(id => byId[id]))` |
| **Deprecation** | `byDate[].tasks` shape is removed; `byDate[].taskIds` is the stable form going forward. |

### `task_get` defaults `includeSubtasks` to `false` (#796)

| | |
|---|---|
| **What changed** | `task_get` now returns `subtaskIds: TaskId[]` and `subtaskCount: number` by default instead of full subtask bodies. |
| **Why** | A parent task with 30 subtasks was returning ~16 KB of bodies the agent rarely needed. |
| **Migration** | Pass `includeSubtasks: true` to restore the old shape, or follow up with `task_get_many({ ids: task.subtaskIds })` to fetch only the subtasks you need. |
| **Deprecation** | `includeSubtasks: true` is supported indefinitely. |

### Default page size lowered to 50 for `task_list`, `project_list`, `search_query` (#797)

| | |
|---|---|
| **What changed** | The default `limit` for these tools dropped from 200 (or 100 for `search_query`) to **50**. |
| **Why** | 200-task pages at current response shape exceed the response stats threshold and put unnecessary token pressure on every list turn. |
| **Migration** | Pass `limit: 200` (max 1000) to restore the previous default page size. Cursor pagination is unchanged — existing cursor tokens remain valid. |
| **Deprecation** | The `limit` parameter has no deprecation; pass it explicitly for predictable page sizes. |

### Cursor blob format change — truncated filterHash and unix-millis timestamps (#802)

| | |
|---|---|
| **What changed** | Pagination cursor tokens are re-encoded: `filterHash` truncated to ≤16 chars, `lastSortValue` for date fields is now unix-millis (number) instead of an ISO-8601 string. |
| **Why** | Reduces cursor size by ~130 bytes per response. |
| **Migration** | Cursors are opaque — callers must not parse or persist them across server versions. Any in-flight cursor from a previous server version returns a `ValidationError`; simply retry the page without the cursor. |
| **Deprecation** | Old-format cursors are not supported after this release. Never parse cursor tokens. |

### `changes_since` returns field-level deltas instead of full records (#819)

| | |
|---|---|
| **What changed** | Response shape: `{ added: Task[], modified: TaskDelta[], removed: TaskId[] }` where `TaskDelta = { id: TaskId, changes: Partial<Task> }`. Previously, `modified` contained full Task records. |
| **Why** | Sync-style consumers only need changed fields — full records were 5–10× wasteful. |
| **Migration** | Merge `delta.changes` into your local cache entry: `cache[delta.id] = { ...cache[delta.id], ...delta.changes }`. Callers that need a full record after a delta can call `task_get({ id: delta.id })`. |
| **Deprecation** | The full-record shape for `modified` is removed; the delta shape is the stable form. |

---

## Compatibility Matrix

| Change | v1.3 | v1.4 (planned) |
|---|---|---|
| `noteHtml` in default response | ✅ included | ❌ removed (opt-in via `includeNoteHtml: true`) |
| `_links` in default response | ✅ included | ❌ removed (opt-in via `includeLinks: true`) |
| `forecast_get` `byDate[].tasks` | ✅ full objects | ❌ changed to `taskIds: TaskId[]` |
| `task_get` default `includeSubtasks` | ✅ `true` | ❌ `false` (override with `includeSubtasks: true`) |
| Default list page size | ✅ 200 / 100 | ❌ 50 for all (override with `limit: N`) |
| Cursor token format | v1 (SHA-256 + ISO dates) | v2 (truncated hash + unix-millis) |
| `changes_since` modified shape | full `Task` records | `TaskDelta` (field-level diff) |
| Length caps on user input (#825) | none | enforced (name ≤ 1 KB, note ≤ 1 MB, etc.) |

**Key:** ✅ unchanged / supported · ❌ breaking change with migration path

---

## Versioning policy

omnifocus-mcp follows [semver](https://semver.org):

- **Patch** (`1.x.y → 1.x.z`): bug fixes, no behaviour change.
- **Minor** (`1.x → 1.y`): new tools/fields, behavioural changes with opt-in migration window, default changes.
- **Major** (`1 → 2`): removals with no opt-in escape hatch.

All changes in the v1.4 table above are **minor** (defaults change; old behaviour accessible via flags or workarounds) except cursor format (opaque token — always minor because callers must not parse cursors).
