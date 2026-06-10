/**
 * Centralized cache-invalidation helpers for M1 mutations.
 *
 * Every mutation tool / service write calls one of these helpers after a
 * successful adapter write. Keeping the scope matrix in one module makes the
 * "what gets cleared when" contract testable in isolation and prevents drift
 * across the mutation surface.
 *
 * Scope policy (per docs/adr/0006-read-cache-strategy.md):
 *   - task mutations    → task:${id}, task:${parentId?}, project:${projectId?}, forecast:*, perspective:*, search:*, tag:list
 *   - project mutations → project:${id}, forecast:*, perspective:*, search:*, tag:list, folder:list
 *   - tag mutations     → tag:${id}, forecast:*, perspective:*, search:*
 *   - folder mutations  → folder:${id}, perspective:*, search:*
 *   - sync_trigger      → clear all (remote state just changed under us)
 *
 * Helpers accept narrow `InvalidatingCache` / `ClearableCache` interfaces
 * rather than the concrete `OmniFocusLruCache` so tests can substitute a
 * lightweight recorder without touching lru-cache.
 *
 * @see docs/adr/0006-read-cache-strategy.md
 * @see docs/cache-invalidation.md
 * @see src/cache/lruCache.ts
 */

import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { InvalidationScope } from "./lruCache.js";

// ---------------------------------------------------------------------------
// Narrow cache interfaces
// ---------------------------------------------------------------------------

/**
 * The cache surface these helpers need. Satisfied by `OmniFocusLruCache` and
 * trivially by test recorders.
 */
export interface InvalidatingCache {
  invalidate(scope: InvalidationScope): void;
}

/** Cache surface for `invalidateOnSync` — also needs bulk clear. */
export interface ClearableCache extends InvalidatingCache {
  clear(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Invalidation scopes for any task create/update/delete/complete/drop/move/
 * repetition mutation.
 *
 * `taskId` may be omitted for mutations that haven't produced an ID yet
 * (e.g. a failed create); `projectId` may be omitted or null when the task
 * lives in the inbox. `parentId` (the task's parent when it is a subtask)
 * emits the parent's own `task:` scope — `task_get` caches the parent's
 * payload with embedded subtask bodies / counts, so any subtask mutation
 * must flush it. Wildcard scopes (`forecast:*`, `perspective:*`,
 * `search:*`) are always emitted because task-list / forecast / perspective
 * results all embed task data and cannot be surgically pruned. `tag:list`
 * is also always emitted: tag rows embed live task counts, so creating,
 * completing, retagging, or deleting a task changes them.
 */
export function invalidateTaskMutation(
  cache: InvalidatingCache,
  opts: { taskId?: TaskId; projectId?: ProjectId | null; parentId?: TaskId | null } = {},
): void {
  if (opts.taskId !== undefined) cache.invalidate(`task:${opts.taskId}`);
  if (opts.parentId !== undefined && opts.parentId !== null) {
    cache.invalidate(`task:${opts.parentId}`);
  }
  if (opts.projectId !== undefined && opts.projectId !== null) {
    cache.invalidate(`project:${opts.projectId}`);
  }
  cache.invalidate("forecast:*");
  cache.invalidate("perspective:*");
  cache.invalidate("search:*");
  cache.invalidate("tag:list");
}

/**
 * Invalidation scopes for any project create/update/delete/complete/drop/
 * move/mark-reviewed mutation.
 *
 * A project mutation conservatively invalidates the per-project scope plus
 * the three wildcards — every task inside the project could be visible in
 * forecast / perspective / search results and the project's own row is
 * embedded in project-list responses. `tag:list` is also emitted: project
 * mutations cascade to contained tasks (delete removes them, complete/drop
 * change their state), and tag rows embed live task counts. `folder:list`
 * too: folder rows embed live project counts, so creating, moving,
 * completing, or deleting a project changes them.
 */
export function invalidateProjectMutation(
  cache: InvalidatingCache,
  opts: { projectId: ProjectId },
): void {
  cache.invalidate(`project:${opts.projectId}`);
  cache.invalidate("forecast:*");
  cache.invalidate("perspective:*");
  cache.invalidate("search:*");
  cache.invalidate("tag:list");
  cache.invalidate("folder:list");
}

/**
 * Invalidation scopes for any tag create/update/delete/move/
 * setStatus/setAllowsNextAction/setLocation mutation.
 *
 * Tag changes affect tag-list rows and can cascade into task visibility
 * (e.g. next-action availability), so the three wildcards are conservative
 * but correct.
 */
export function invalidateTagMutation(cache: InvalidatingCache, opts: { tagId: TagId }): void {
  cache.invalidate(`tag:${opts.tagId}`);
  cache.invalidate("tag:list");
  cache.invalidate("forecast:*");
  cache.invalidate("perspective:*");
  cache.invalidate("search:*");
}

/**
 * Invalidation scopes for any folder create/update/delete/move mutation.
 *
 * Folders don't carry task state directly, so `forecast:*` is deliberately
 * skipped — perspective and search results can still embed folder names
 * via their project parents, so those wildcards are retained.
 */
export function invalidateFolderMutation(
  cache: InvalidatingCache,
  opts: { folderId: FolderId },
): void {
  cache.invalidate(`folder:${opts.folderId}`);
  cache.invalidate("folder:list");
  cache.invalidate("perspective:*");
  cache.invalidate("search:*");
}

/**
 * Invalidation on `sync_trigger` — a sync can pull arbitrary remote edits,
 * so every cached read is potentially stale. Clear the whole cache.
 */
export function invalidateOnSync(cache: ClearableCache): void {
  cache.clear();
}

/**
 * Invalidation on `database_undo` / `database_redo` — undo and redo can
 * revert/replay arbitrary mutations from the document's undo stack
 * (including ones from outside the MCP, like manual UI edits). We don't
 * know what was reverted, so every cached read is potentially stale.
 * Clear the whole cache. Same semantics as `invalidateOnSync`.
 *
 * @see #526
 */
export function invalidateOnUndoRedo(cache: ClearableCache): void {
  cache.clear();
}
