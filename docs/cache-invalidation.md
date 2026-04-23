# Cache invalidation matrix

Every M1 mutation tool / service write calls one of the helpers in
`src/cache/invalidation.ts` after a successful adapter call. Those helpers
emit the exact set of scopes listed below against the shared
`OmniFocusLruCache`, which prefix-matches keys and fires a
`cache.invalidated` event for each call.

See [ADR-0006 — read cache strategy](./adr/0006-read-cache-strategy.md) for
the underlying policy and [`src/cache/lruCache.ts`](../src/cache/lruCache.ts)
for scope-matching semantics.

## Scope legend

| Scope             | Clears                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `task:${id}`      | Per-task cache entries (`task:${id}:…`).                            |
| `project:${id}`   | Per-project cache entries (`project:${id}:…`).                      |
| `tag:${id}`       | Per-tag cache entries.                                              |
| `folder:${id}`    | Per-folder cache entries.                                           |
| `forecast:*`      | All forecast-view results (any due / deferred aggregate).           |
| `perspective:*`   | All perspective-evaluate results (custom + built-in).               |
| `search:*`        | All list / search results, including `task_list` and `search_query`.|

`forecast:*`, `perspective:*`, and `search:*` are conservative wildcards
because those responses embed task and project rows that can change under
any write within the noun's scope.

## Matrix

| Tool / service method           | Helper                        | `task:${id}` | `project:${id}` | `tag:${id}` | `folder:${id}` | `forecast:*` | `perspective:*` | `search:*` | `cache.clear()` |
| ------------------------------- | ----------------------------- | :----------: | :-------------: | :---------: | :------------: | :----------: | :-------------: | :--------: | :-------------: |
| `task_update`                   | `invalidateTaskMutation`      | ✅            | ✅¹              |             |                | ✅            | ✅               | ✅          |                 |
| `task_delete`                   | `invalidateTaskMutation`      | ✅            | ✅¹              |             |                | ✅            | ✅               | ✅          |                 |
| `task_set_repetition`           | `invalidateTaskMutation`      | ✅            | ✅¹              |             |                | ✅            | ✅               | ✅          |                 |
| `task_clear_repetition`         | `invalidateTaskMutation`      | ✅            | ✅¹              |             |                | ✅            | ✅               | ✅          |                 |
| `project_delete`                | `invalidateProjectMutation`   |              | ✅               |             |                | ✅            | ✅               | ✅          |                 |
| `TagService.create`             | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.update`             | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.delete`             | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.move`               | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.setStatus`          | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.setAllowsNextAction`| `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.setLocation`        | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `TagService.clearLocation`      | `invalidateTagMutation`       |              |                 | ✅           |                | ✅            | ✅               | ✅          |                 |
| `FolderService.create`          | `invalidateFolderMutation`    |              |                 |             | ✅              |              | ✅               | ✅          |                 |
| `FolderService.update`          | `invalidateFolderMutation`    |              |                 |             | ✅              |              | ✅               | ✅          |                 |
| `FolderService.delete`          | `invalidateFolderMutation`    |              |                 |             | ✅              |              | ✅               | ✅          |                 |
| `FolderService.move`            | `invalidateFolderMutation`    |              |                 |             | ✅              |              | ✅               | ✅          |                 |
| `sync_trigger`                  | `invalidateOnSync`            |              |                 |             |                |              |                 |            | ✅               |

¹ `project:${id}` is emitted only when the task's project is known. For
inbox tasks (`projectId === null`) it is skipped. For tools that don't
re-read the task after the mutation (e.g. `task_delete`), the handler
pre-fetches via `adapter.getTask` before writing so the project scope can
still be flushed.

## Testing contract

Every mutation's unit test must:

1. Register a listener on `cache.invalidated`.
2. Run the handler / service method.
3. Assert `scope` values received match the matrix row for that mutation.

See `src/cache/invalidation.test.ts` for the per-helper contract tests and
per-tool tests (e.g. `src/tools/task/delete.test.ts`) for end-to-end event
assertions.
