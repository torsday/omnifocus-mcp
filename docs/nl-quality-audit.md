# NL-quality audit — tool surface scorecard

**Issue:** [#563](https://github.com/torsday/omnifocus-mcp/issues/563)
**Rubric:** [`docs/nl-quality-standards.md`](./nl-quality-standards.md)
**Audited:** 96 tools across `src/tools/**`
**Audit date:** 2026-04-27 (cycle 2 of `/loop /ship-next` after #489 foundation merged)

This document captures the state of every shipped tool against the five-lever
rubric at the moment of audit. It exists as a frozen-in-time snapshot — future
remediation cycles work against the gap classes documented below, and a
follow-up audit reruns this template after the bulk fixes land.

> **What this is not.** Not a rolling tracker. Not a TODO list. Each gap class
> has a dedicated follow-up issue (linked below); resolution lives there. The
> doc itself is updated only when re-audited after meaningful remediation.

---

## Distribution

| Grade | Count | Meaning |
|-------|-------|---------|
| **A** | 0 | All five levers pass |
| **B** | 50 | Mechanical gaps only — missing `Example:` line, occasional missing inner `.describe()` |
| **C** | 43 | Moderate gaps requiring some judgment — alias opportunity, response-shape miss, ID-without-name |
| **D** | 1 | Significant gaps requiring per-tool design — flagged for `*_from_prose` rewrite |
| **F** | 0 | Fundamental rework needed |

**No tool grades A** because Lever 2 (`Example:` line in the description) is
universally missing — the rubric is brand new (PR #566 merged minutes before
this audit) and no tool has been remediated yet. The grade ceiling will rise
to A as the dominant gap classes close.

---

## Dominant gap classes

The 96 rows collapse to five gap classes, each tracked in its own follow-up.
Working against the *class* (not per-tool) is how the remediation stays
manageable: one PR per class, ~10–96 tools touched per PR, mechanical changes
where possible.

### Class 1 — Missing `Example:` line (universal)

**Lever 2.** No `*_DESCRIPTION` constant currently ends with an `Example:`
line. Easiest single sweep — one representative call per tool, appended to
the existing description string.

**Affects:** all 96 tools.
**Severity:** Mechanical. No semantic change; one literal-string append per
tool. Risk is bounded by `descriptions.snapshot.test.ts` (regenerates) and
`descriptionShape.test.ts` (still passes — adding text doesn't break the
4-section shape).
**Tracked in:** [#570](https://github.com/torsday/omnifocus-mcp/issues/570) — `feat(nl-quality): bulk Example: sweep across the tool surface`.

### Class 2 — Inner `.describe()` missing on batch / refined-object schemas

**Lever 1.** Four batch tools — `task_batch_assign`, `task_batch_create`,
`task_batch_update`, plus deep fields in `task_extract_from_image` — define
inner item schemas (`assignments[]`, `items[]`, `items[].patch`,
`proposed[]`) where the inner fields lack `.describe(...)` even when the
top-level schema is well-described. The agent has to infer the meaning of
`assignments[].deferDate` from the outer description rather than reading it
on the field itself.

**Affects:** ~30 fields across 4 tools.
**Severity:** Mechanical. Add `.describe(...)` calls; no behavior change.
**Tracked in:** [#571](https://github.com/torsday/omnifocus-mcp/issues/571) — `feat(nl-quality): describe() coverage for batch-tool inner fields`.

### Class 3 — Response shape lacks ID-name pairing

**Lever 4.** Many write tools return `{ verb: true, id }` (or `{ verb, id }`)
without a paired name. The agent gets the ID back but has to do a follow-up
read to describe the change to the user. Examples: `task_complete` returns
`{ done, id }` without the task name; `project_drop` returns `{ dropped, id }`
without the project name; batch tools return per-item `value: taskId` with no
name context for summarizing the outcome.

**Affects:** ~25 tools (mostly write tools and batch verbs).
**Severity:** Mild design call per tool — should the response include the
full domain entity (matches `task_update`'s pattern), or the minimum
`{ id, name }` pair, or rely on `humanReadableSummary` in `meta` (ADR-0015)
to carry the human-readable form? The repo's mutation-response contract
(CONTRIBUTING.md non-negotiable: "return the full updated domain entity in
`data`") suggests the first option is the right one; verifying that against
the JXA round-trip cost per tool is the per-tool judgment.
**Tracked in:** [#572](https://github.com/torsday/omnifocus-mcp/issues/572) — `feat(nl-quality): pair IDs with names in write-tool responses`.

### Class 4 — Forgiving-alias opportunities on status / completion-criterion enums

**Lever 3.** Several tools accept enum values (`"on-hold"`, `"sequential"`,
`"parallel"`) where common natural-language phrasings (`"paused"`, `"in
order"`, `"any order"`) would be unambiguous. The mapping is stable and
documented, so the alias has no semantic risk. Tools surfacing this gap:
`project_create`, `project_update`, `project_list`, `tag_create`,
`tag_set_status`, `tag_update`, `tag_list`.

**Affects:** ~7 tools.
**Severity:** Mild — adds a `preprocess` step before the enum constraint;
documented in the field's `.describe(...)`.
**Tracked in:** [#573](https://github.com/torsday/omnifocus-mcp/issues/573) — `feat(nl-quality): forgiving aliases for status / completion-criterion enums`.

### Class 5 — `task_extract_from_image` schema discipline + `*_from_prose` redesign

**Lever 1 + Lever 5.** The only D-grade tool. Multiple inner fields inside
discriminated-union members lack `.describe(...)`; the tool's two-phase
shape (propose → user-confirms → commit) is intrinsically NL-heavy and
warrants a `*_from_prose` family redesign rather than mechanical
remediation.

**Affects:** 1 tool.
**Severity:** Per-tool design call.
**Tracked in:** [#574](https://github.com/torsday/omnifocus-mcp/issues/574) — `refactor(task): redesign task_extract_from_image as a *_from_prose helper`.

---

## Lever 5 — `zodToActionable` adoption

The helper landed in PR #566. No tool currently wires it; that's expected.
Adoption pattern lives in [`docs/nl-quality-standards.md`][nl-rubric] §5.
Wiring is straightforward — handlers that today use `inputSchema.parse(input)`
or pass raw input to a service swap in a `safeParse + zodToActionable`
pre-check. The MCP SDK validates Zod schemas before the handler runs, so for
the majority of tools the failure path is "Zod via SDK" — those tools see no
behavior change until the SDK's error rewriting is augmented or until
handlers parse manually for cross-field refinement (e.g. `task_create`'s
"projectId XOR parentTaskId" check).

**Tracked in:** [#575](https://github.com/torsday/omnifocus-mcp/issues/575) — `feat(nl-quality): wire zodToActionable at handler boundaries that parse manually`.

[nl-rubric]: ./nl-quality-standards.md

---

## Per-tool grades

The full per-tool table follows. Columns:

- **Tool** — namespace and verb
- **Grade** — A/B/C/D/F per the distribution above
- **Levers** — pass (`✓`) or fail (`✗`) for each of the five levers, in order. Lever 5 (`zodToActionable`) is `–` on tools that delegate to the SDK's Zod path (which is most of them).
- **Notes** — pithy gap summary

| Tool | Grade | 1·describe | 2·example | 3·alias | 4·roundtrip | 5·zodToActionable | Notes |
|------|-------|:----------:|:---------:|:-------:|:-----------:|:----------------:|-------|
| `app_launch` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input schema. |
| `attachment_list` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `attachment_add` | C | ✓ | ✗ | ✓ | ✗ | – | Returns `{ id }` only. |
| `attachment_remove` | C | ✓ | ✗ | ✓ | ✗ | – | Returns `{ removed: true }` no id echo. |
| `attachment_save_to_path` | B | ✓ | ✗ | ✓ | ✓ | – | `sizeBytes` names unit. |
| `database_redo` | B | ✓ | ✗ | ✓ | ✓ | – | Confirm-required pattern. |
| `database_undo` | B | ✓ | ✗ | ✓ | ✓ | – | Confirm-required pattern. |
| `export_opml` | B | ✓ | ✗ | ✓ | ✓ | – | Manual `ValidationError` post-Zod for scope+id mismatch. |
| `import_opml` | C | ✓ | ✗ | ✓ | ✗ | – | `taskIds[]` returned without names. |
| `export_taskpaper` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `import_taskpaper` | C | ✓ | ✗ | ✓ | ✗ | – | `created: TaskId[]` without names. |
| `folder_create` | B | ✓ | ✗ | ✓ | ✓ | – | Returns full `{ folder }`. |
| `folder_delete` | B | ✓ | ✗ | ✓ | ✓ | – | `{ deleted, id }` — name unrecoverable post-delete. |
| `folder_get` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `folder_list` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `folder_move` | B | ✓ | ✗ | ✓ | ✓ | – | Returns full `{ folder }`. |
| `folder_update` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `forecast_get` | B | ✓ | ✗ | ✓ | ✓ | – | `flexDateString` already accepts shortcuts. |
| `forecast_get_tag` | C | ✓ | ✗ | ✓ | ✗ | – | Returns `{ tagId }` no tag name. |
| `forecast_pack` | B | ✓ | ✗ | ✓ | ✓ | – | `selected/skipped` carry name + `estimatedMinutes`. |
| `forecast_set_tag` | C | ✓ | ✗ | ✓ | ✗ | – | Returns `{ tagId }` no tag name. |
| `note_append` | C | ✓ | ✗ | ✓ | ✗ | – | Description / handler return-shape mismatch (`{ note }` vs `{ updated, id }`). |
| `note_get` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `note_get_html` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `note_set` | C | ✓ | ✗ | ✓ | ✗ | – | Description / handler return-shape mismatch. |
| `note_set_html` | C | ✓ | ✗ | ✓ | ✗ | – | Description / handler return-shape mismatch. |
| `internal_status` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. `uptimeMs` names unit. |
| `perspective_evaluate` | B | ✓ | ✗ | ✓ | ✓ | service-layer parse | Built-in id list documented. |
| `perspective_list` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `plugin_invoke` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `project_batch_complete` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `projectId`. |
| `project_batch_drop` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `projectId`. |
| `project_complete` | C | ✓ | ✗ | ✓ | ✗ | – | Generic summary; no name. |
| `project_create` | C | ✓ | ✗ | ✗ | ✗ | – | `status` / `completionCriterion` could alias; returns `{ created, id }`. |
| `project_delete` | B | ✓ | ✗ | ✓ | ✓ | – | Reference safety-trio. |
| `project_drop` | C | ✓ | ✗ | ✓ | ✗ | – | `{ dropped, id }` no name. |
| `project_get` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `project_get_many` | B | ✓ | ✗ | ✓ | ✓ | – | Defensive `>100` check post-Zod. |
| `project_list` | C | ✓ | ✗ | ✗ | ✓ | service-layer parse | `status` enum could alias `paused/completed/cancelled`. |
| `project_move` | C | ✓ | ✗ | ✓ | ✗ | – | `{ moved, id }` no name. |
| `project_update` | C | ✓ | ✗ | ✗ | ✗ | – | Returns `{ updated, id }` not full entity. |
| `run_jxa_script` | B | ✓ | ✗ | ✓ | ✓ | – | Opt-in only. |
| `run_omnijs_script` | B | ✓ | ✗ | ✓ | ✓ | – | Opt-in only. |
| `repetition_from_prose` | B | ✓ | ✗ | ✓ | ✓ | – | Inherently NL-heavy; description embeds inline examples. |
| `review_list_due` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. |
| `review_mark_reviewed` | C | ✓ | ✗ | ✓ | ✗ | – | `{ id }` only. `id` is plain `z.string` (laxity). |
| `project_mark_reviewed` | C | ✓ | ✗ | ✓ | ✗ | – | Convenience alias; same gaps as `review_mark_reviewed`. |
| `review_set_interval` | C | ✓ | ✗ | ✓ | ✗ | – | `{ id }` no echo of new interval. |
| `project_set_next_review_date` | C | ✓ | ✗ | ✓ | ✗ | – | `projectId` is plain `z.string`. |
| `search_query` | B | ✓ | ✗ | ✓ | ✓ | service-layer parse | |
| `sync_status` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. |
| `sync_trigger` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. |
| `tag_create` | B | ✓ | ✗ | ~ | ✓ | – | `status` enum could alias. Returns full `{ tag }`. |
| `tag_delete` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `tag_get` | B | ✓ | ✗ | ✓ | ✓ | – | Description quite terse. |
| `tag_get_location` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `tag_get_many` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `tag_list` | C | ✓ | ✗ | ✗ | ✓ | service-layer parse | `status` enum aliases. |
| `tag_move` | B | ✓ | ✗ | ✓ | ✓ | – | Returns full `{ tag }`. |
| `tag_set_allows_next_action` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `tag_set_location` | B | ✓ | ✗ | ✓ | ✓ | – | `radiusMeters / latitude / longitude` name units. |
| `tag_set_status` | C | ✓ | ✗ | ✗ | ✓ | – | `status` enum aliases. Returns full `{ tag }`. |
| `tag_update` | C | ✓ | ✗ | ✗ | ✓ | – | `status` enum aliases. Returns full `{ tag }`. |
| `task_batch_assign` | C | ✗ | ✗ | ✓ | ✗ | – | `assignments[]` inner fields lack describes. |
| `task_batch_complete` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `taskId`. |
| `task_batch_create` | C | ✗ | ✗ | ✓ | ✗ | – | Most `singleItemSchema` fields lack describes. |
| `task_batch_delete` | C | ✓ | ✗ | ✓ | ✗ | – | Confirm-required. Per-item value just `taskId`. |
| `task_batch_drop` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `taskId`. |
| `task_batch_move` | C | ✓ | ✗ | ✓ | ✗ | – | `destination` subschema described; per-item value just `taskId`. |
| `task_batch_uncomplete` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `taskId`. |
| `task_batch_undrop` | C | ✓ | ✗ | ✓ | ✗ | – | Per-item value just `taskId`. |
| `task_batch_update` | C | ✗ | ✗ | ✓ | ✗ | – | `patch` fields lack describes. |
| `task_clear_alarms` | B | ✓ | ✗ | ✓ | ✓ | – | Returns full `{ task }`. |
| `task_clear_repetition` | B | ✓ | ✗ | ✓ | ✓ | – | Returns full `{ task }`. |
| `task_complete` | C | ✓ | ✗ | ✓ | ✗ | – | `{ done, id }` no name (summary in `meta`). |
| `task_convert_to_project` | C | ✓ | ✗ | ✓ | ✗ | – | Ids only — no name pairing. |
| `task_create` | C | ✓ | ✗ | ✓ | ✗ | – | Returns `{ id }` not full task. Idempotency-key wrapper. |
| `task_delete` | B | ✓ | ✗ | ✓ | ✓ | – | Reference safety-trio. |
| `task_drop` | C | ✓ | ✗ | ✓ | ✗ | – | `{ done, id }` no name. |
| `task_duplicate` | C | ✓ | ✗ | ✓ | ✗ | – | Ids + `descendantCount` (unit named); no name pairing. |
| `task_extract_from_image` | **D** | ✗ | ✗ | ✓ | ✗ | – | Multiple discriminated-union member fields undescribed. NL-heavy two-phase. Flagged for `*_from_prose` redesign. |
| `task_extract_from_note` | C | ~ | ✗ | ✓ | ✓ | – | `proposed.deferDate / dueDate` undocumented. May warrant `*_from_prose` follow-up. |
| `task_find_by_name` | B | ✓ | ✗ | ✓ | ✓ | – | Returns `tasks[] + matchCount`. |
| `task_find_similar` | C | ~ | ✗ | ✓ | ✗ | – | Candidate `projectId` not paired with project name; `tags` is `tagIds`. |
| `task_get` | B | ✓ | ✗ | ✓ | ✓ | – | Reference example for the rubric — but no Example: line. |
| `task_get_many` | B | ✓ | ✗ | ✓ | ✓ | – | Defensive `>100` check post-Zod. |
| `task_list` | B | ✓ | ✗ | ✓ | ✓ | service-layer parse | Reference read tool. |
| `task_move` | B | ✓ | ✗ | ✓ | ✓ | – | Manual `ValidationError` post-Zod. |
| `task_parse_transport_text` | B | ✓ | ✗ | ✓ | ✓ | – | Read-only. Surfaces parse warnings. |
| `task_reclassify` | C | ✓ | ✗ | ✓ | ✗ | – | `before/after` carry `projectId/tagIds` without name pairing. |
| `task_reorder` | B | ✓ | ✗ | ✓ | ✓ | – | Manual `ValidationError` for positioning-form exclusivity. |
| `task_search` | B | ✓ | ✗ | ✓ | ✓ | service-layer parse | |
| `task_set_alarms` | B | ✓ | ✗ | ✓ | ✓ | – | Manual `ValidationError` post-Zod. |
| `task_set_repetition` | B | ✓ | ✗ | ✓ | ✓ | – | Domain-schema reuse; describes inline. Returns full `{ task }`. |
| `task_uncomplete` | C | ✓ | ✗ | ✓ | ✗ | – | `{ done, id }` no name. |
| `task_undrop` | C | ✓ | ✗ | ✓ | ✗ | – | `{ done, id }` no name. |
| `task_update` | B | ✓ | ✗ | ✓ | ✓ | – | Safety-trio + tag-diff modes. Returns full updated task. |
| `window_get_state` | C | ✓ | ✗ | ✓ | ✗ | – | `focusContainerIds` no name pairing. |
| `window_set_perspective` | B | ✓ | ✗ | ✓ | ✓ | – | |
| `window_set_focus` | C | ✓ | ✗ | ✓ | ✗ | – | `focusContainerIds` no name pairing. |
| `app_window_new` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. |
| `app_window_new_tab` | B | ✓ | ✗ | ✓ | ✓ | – | Empty input. |

`~` = partial / minor gap (one or two missing describes inside a sub-schema, otherwise covered).

---

## Method

The audit was a single-pass read of every file under `src/tools/**` plus the
two multi-tool files (`attachment/index.ts`, `window/index.ts`), scoring
against the rubric. Lever scoring rules:

- **Lever 1 (`.describe()`)** — pass requires every Zod input field at the
  top level AND inside named sub-schemas (e.g. `assignments[]`, `items[]`,
  `patch`, `destination`) to have a `.describe(...)` call. Partial pass (`~`)
  marks one or two undescribed fields.
- **Lever 2 (`Example:`)** — pass requires the `*_DESCRIPTION` constant to
  literally contain the substring `Example:`. No tool currently passes.
- **Lever 3 (alias)** — pass means either no obvious alias opportunity exists,
  or the schema already accepts NL phrasings (e.g. `flexDateString`). Failure
  means there's a stable, unambiguous alias the schema rejects.
- **Lever 4 (round-trip)** — pass means the response shape contains enough
  context for the agent to describe the result without a follow-up read.
  Failure means IDs are returned unaccompanied by names, or units are missing
  from numeric fields.
- **Lever 5 (`zodToActionable`)** — `–` means the tool delegates to the MCP
  SDK's Zod validation, which produces default Zod messages. None of these
  fail the lever; they just don't yet benefit from `zodToActionable`. The
  follow-up [#575](https://github.com/torsday/omnifocus-mcp/issues/575)
  identifies handlers that parse manually (cross-field refinement) and would
  benefit from explicit wiring.

Future audits should keep the same scoring rules so deltas are
comparable. When the dominant gap classes close, regenerate the table and
expect the grade ceiling to lift to A.
