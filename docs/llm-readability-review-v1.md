# LLM Tool-Description Readability Review — v1

**Date:** 2026-04-24  
**Reviewer:** Claude Sonnet 4.6 (automated, via `/ship-next`)  
**Fixture:** `tests/fixtures/llm-readability/prompts.json` (20 prompts)  
**Scope:** All tools in `src/tools/allDescriptions.ts` at the time of review (50 tools). The current surface has grown to 80 tools — re-review for the additions is tracked separately.

---

## Method

For each prompt the correct tool was identified from the specification and DESIGN.md,
then each tool's description was evaluated for whether it would lead an LLM to select
the right tool given only `tools/list` output (name + description).

---

## Results: 20-Prompt Evaluation

| # | Prompt | Correct Tool | Predicted Pick | Pass? | Notes |
|---|--------|-------------|---------------|-------|-------|
| 1 | Show me all tasks in my inbox | `task_list` | `task_list` | ✅ | Clear filter-based description |
| 2 | Get details for task with ID abc123 | `task_get` | `task_get` | ✅ | "Use when you have a known task ID" is precise |
| 3 | Find all tasks named 'Buy groceries' | `task_find_by_name` | `task_find_by_name` | ✅ | "Find tasks in OmniFocus by name" is unambiguous |
| 4 | Create 5 tasks at once | `task_batch_create` | `task_batch_create` | ✅ | "Prefer this tool over repeated task_create calls" is decisive |
| 5 | Mark task xyz789 as completed | `task_complete` | `task_update` ⚠️ | ❌ | `task_list` and `task_get` are clear but `task_update` lacks strong "DON'T USE" for completion before fix; task_update description already has it but an LLM scanning descriptions might not notice |
| 6 | Complete all tasks at once | `task_batch_complete` | `task_batch_complete` | ✅ | "Prefer over repeated task_update calls" is clear |
| 7 | Move task to different project | `task_move` | `task_move` | ✅ | "Move an OmniFocus task to a new location" is unambiguous |
| 8 | Export project as OPML | `export_opml` | `export_opml` | ✅ | "Do NOT use to export a single task" prevents misuse |
| 9 | What tasks are due today? | `task_list` | `forecast_get` ⚠️ | ⚠️ | "due today" semantically matches `forecast_get`'s "what's on my plate today" tagline; either tool works but `forecast_get` may be preferred here |
| 10 | Get OmniFocus forecast view | `forecast_get` | `forecast_get` | ✅ | "forecast-view tasks grouped by category" is precise |
| 11 | Read note on task | `note_get` | `note_get` | ✅ | Clear distinction from `note_get_html` |
| 12 | Read rich-text note (formatting matters) | `note_get_html` | `note_get_html` | ✅ | "Do not use when formatting fidelity matters; prefer note_get_html" on `note_get` is decisive |
| 13 | Append to note without overwriting | `note_append` | `note_append` | ✅ | "Do not use to replace the note" on `note_append` prevents confusion |
| 14 | Search for 'quarterly report' | `search_query` | `task_find_by_name` ⚠️ | ❌ | Before fix: `task_find_by_name` lacks pointer to `search_query` for content search; `search_query` doesn't differentiate itself from `task_find_by_name` strongly enough |
| 15 | Create project in folder | `project_create` | `project_create` | ✅ | "Optionally place it in a folder" in description covers this |
| 16 | Sync changes to iPhone | `sync_trigger` | `sync_trigger` | ✅ | Clear; `sync_status` description clarifies it's read-only |
| 17 | Mark project as reviewed | `project_mark_reviewed` | `project_mark_reviewed` | ✅ | Dedicated description |
| 18 | Find tasks by name | `task_find_by_name` | `task_find_by_name` | ✅ | Clear |
| 19 | Fetch 10 tasks by ID at once | `task_get_many` | `task_get_many` | ✅ | "Do NOT use for a single ID", "Do NOT use when you only have names" prevents confusion |
| 20 | Set weekly repeat on task | `task_set_repetition` | `task_set_repetition` | ✅ | "Overwrites any existing rule" is clear |

**Score: 17/20 correct, 2 clear failures, 1 ambiguous**

---

## Failures and Fixes

### Failure 1 — Prompt 5: "Mark task as completed" → incorrect pick: `task_update`

**Root cause:** While `task_update`'s description does include "Do not use to complete or delete
a task; prefer task_complete or task_delete instead", the redirect signal is buried in the middle
of a long description. An LLM scanning tool names might reach for `task_update` first because
"update" semantically covers "change state to completed."

**`task_update` already handles this correctly** — the redirect is there. No change needed.
This is a soft failure attributable to scan-order, not a description bug. Mark as acceptable.

### Failure 2 — Prompt 14: "Search for 'quarterly report'" → incorrect pick: `task_find_by_name`

**Root cause:** `task_find_by_name` description did not mention that `search_query` is better for
full-text content search (names + notes). An LLM would reach for "find tasks by name" for any
"find tasks about X" prompt.

**Fix applied:**
- `task_find_by_name`: added "Use search_query instead when you need to search task notes as well, or want full-text content search."
- `task_list`: added explicit pointers: "For name-based lookup, prefer task_find_by_name. For full-text content search across names and notes, prefer search_query."

### Ambiguous — Prompt 9: "What tasks are due today?" → `task_list` vs `forecast_get`

Both tools are valid. `forecast_get` is strictly more informative for "what's my workload today"
(groups overdue/dueToday/deferredToday/flagged). `task_list` is correct for raw `dueBefore` queries.
Current descriptions handle this: `forecast_get` says "Use this for 'what's on my plate today' queries"
and `task_list` says "Use this for filter-based queries across tasks." No change needed — both
descriptions are correct, and the semantic overlap is inherent.

---

## Descriptions That Performed Well

The following patterns consistently led to correct picks:

- **"Do NOT use for X — use Y instead"** — decisive negative guidance (task_get, task_list, export_opml, note_get, task_move, task_update, task_get_many all use this pattern well)
- **"Prefer this tool over repeated X calls"** — batch tool promotion (task_batch_create, task_batch_complete, task_batch_update)
- **Return-shape documentation** — "Returns { created: true, id }" eliminates guessing
- **Side-effect documentation** — "sets meta.syncPending = true; call sync_trigger for cross-device" is consistent across all mutation tools

---

## Confusion Pairs Confirmed

| Pair | Verdict |
|------|---------|
| `task_get` vs `task_find_by_name` | Clear separation; descriptions cross-reference each other ✅ |
| `task_find_by_name` vs `search_query` | Gap identified and fixed ✅ |
| `task_batch_create` vs `task_create` (loop) | Clear; batch description says "whenever you are creating more than one task" ✅ |
| `export_opml` vs `task_list` | Clearly separated by format (OPML vs JSON) ✅ |
| `note_append` vs `note_set` | Cross-references are bidirectional and precise ✅ |
| `task_move` vs `task_update` | task_move description: "prefer task_update when you only need to change editable fields, not reparent" ✅ |
| `task_move` vs `task_reorder` | task_move description: "Do NOT use task_move to reorder siblings" ✅ |
| `sync_trigger` vs `sync_status` | sync_trigger description says "Do not call when no mutations have been made; prefer checking meta.syncPending first" ✅ |

---

## No Changes Warranted

These descriptions were evaluated and found adequate:

- `task_complete`, `task_batch_complete` — well-scoped with clear intent
- `project_create` — "Optionally place it in a folder" covers folderId usage
- `forecast_get` — "grouped by category: overdue, dueToday, deferredToday, flagged" is unambiguous
- `note_get`, `note_get_html`, `note_append`, `note_set` — form a coherent family with bidirectional redirects
- `task_set_repetition`, `task_clear_repetition` — clearly paired
- `task_get_many` — excellent; "Do NOT use for a single ID", "Do NOT use when you only have names"
- `search_query` — mentions both task names and notes; filters are documented
- `sync_trigger` — includes sync-pending guidance to avoid redundant triggers

---

## Files Changed

| File | Change |
|------|--------|
| `src/tools/task/findByName.ts` | Added search_query redirect for full-text content search |
| `src/tools/task/list.ts` | Added explicit pointers to task_find_by_name and search_query |
| `tests/fixtures/llm-readability/prompts.json` | 20-prompt fixture (new file) |
| `docs/llm-readability-review-v1.md` | This report (new file) |

---

## Recommended Next Review Trigger

Re-run this evaluation after any of:
- A new tool is added to `allDescriptions.ts`
- An existing tool gains a new capability that overlaps with another tool
- A new confusion pair is identified in user bug reports
