# Tool naming — canonical verb vocabulary (#837)

Tool names follow a `<resource>_<verb>[_<qualifier>]` grammar. A consistent
verb-per-action lets the agent apply a pattern instead of memorising a different
verb for each resource, which measurably improves tool-selection accuracy and
lets descriptions stay terse (pairs with the description audit, #814).

This document is the canonical vocabulary. The
[`naming.lint.test.ts`](../../src/tools/naming.lint.test.ts) gate enforces it by
rejecting non-canonical synonyms (`add`, `remove`, `new`, … ) in new tool names.

## Canonical verbs

### Read

| Verb       | Meaning                                              | Examples                                  |
| ---------- | --------------------------------------------------- | ----------------------------------------- |
| `get`      | Fetch a single entity by id                         | `task_get`, `project_get`, `tag_get`      |
| `get_many` | Fetch multiple entities by a list of ids            | `task_get_many`, `project_get_many`       |
| `list`     | Paginated listing of a collection                   | `task_list`, `folder_list`, `webhook_list`|
| `search`   | Query by predicate / free text                      | `task_search`, `search_query`             |

### Create / update / delete (CRUD)

| Verb     | Meaning                                  | Examples                              |
| -------- | ---------------------------------------- | ------------------------------------- |
| `create` | Make a new entity                        | `task_create`, `project_create`       |
| `update` | In-place edit of one or more fields      | `task_update`, `tag_update`           |
| `delete` | Hard removal                             | `task_delete`, `perspective_delete`   |

Use `create` — **never** `add` or `new`. Use `delete` — **never** `remove` or
`destroy`. Use `update` — **never** `modify`, `edit`, or `rename`.

### Single-aspect mutation

`set_<aspect>` / `clear_<aspect>` mutate one specific facet of an entity, as
distinct from `update` (a general multi-field patch). Use these when the action
targets a single named attribute with its own semantics.

- `task_set_alarms` / `task_clear_alarms`
- `task_set_repetition` / `task_clear_repetition`
- `task_set_waiting_on` / `task_clear_waiting_on`
- `tag_set_status`, `tag_set_location`, `tag_set_allows_next_action`
- `project_set_next_review_date`, `review_set_interval`, `forecast_set_tag`
- `note_set` / `note_append` / `note_get` (and `_html` variants)

### Lifecycle transitions

| Verb        | Inverse      | Examples                          |
| ----------- | ------------ | --------------------------------- |
| `complete`  | `uncomplete` | `task_complete`, `task_uncomplete`|
| `drop`      | `undrop`     | `task_drop`, `task_undrop`        |
| `move`      | —            | `task_move`, `folder_move`        |

### Qualifiers (suffixes)

| Suffix       | Meaning                                                       |
| ------------ | ------------------------------------------------------------ |
| `_describe`  | Dry-run preview of a write; returns planned changes, no edit |
| `_dry_run`   | Evaluate-only variant (e.g. `perspective_evaluate_dry_run`)  |
| `batch_*`    | Bulk variant operating on an array (`task_batch_create`, …)  |
| `_smart`     | Intent/NL-driven variant (`task_defer_smart`)               |

## Documented exceptions

These deviate from the vocabulary for a justified reason (encoded in the lint's
`VERB_SYNONYM_EXCEPTIONS`):

- `app_window_new`, `app_window_new_tab` — `new` is correct here: a UI action
  that opens a new window/tab, not the creation of a persisted domain object.
- `attachment_add`, `attachment_remove` — **legacy outliers.** They should be
  `attachment_create` / `attachment_delete` to match the CRUD vocabulary.
  Renaming is a breaking change requiring a deprecation window (old name aliases
  to new for one minor, `tool.deprecated` logged, dropped next major), so it is
  tracked as a separate breaking follow-up rather than done here.

## Non-CRUD action tools

Some tools are imperative actions, not resource CRUD, and name themselves after
the action directly: `app_launch`, `sync_trigger`, `plugin_invoke`,
`database_undo`/`database_redo`, `task_reorder`, `task_reclassify`,
`task_convert_to_project`, `task_duplicate`, `*_mark_reviewed`,
`import_*` / `export_*`, `run_jxa_script` / `run_omnijs_script`. These are
intentional and outside the CRUD grammar.
