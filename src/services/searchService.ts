/**
 * `SearchService` — full-text task search with cursor pagination.
 *
 * Delegates the actual text matching to `adapter.searchTasks()` (which can
 * push the predicate to JXA/OmniJS or run in-memory for tests), then applies
 * stable cursor pagination using the shared cursor codec (ADR-0013 / #35).
 *
 * Pagination contract:
 * - Tasks are sorted by `(createdAt ASC, id ASC)` — deterministic, insert-safe.
 * - Cursors encode `{ lastId, lastCreatedAt, filterHash }`. Swapping filter
 *   fields mid-sequence returns `ValidationError` (filterHash mismatch).
 * - Default page size: 50. Maximum: 500.
 *
 * @see DESIGN.md §15 — pagination contract
 * @see src/pagination/cursor.ts
 */

import type { OmniFocusAdapter, SearchFilter } from "../adapter/OmniFocusAdapter.js";
import { buildTaskLinks } from "../domain/links.js";
import type { Task } from "../domain/task.js";
import {
  type CursorPayload,
  decodeCursor,
  encodeCursor,
  hashFilter,
  isAfterCursor,
} from "../pagination/cursor.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Input to {@link SearchService.search}. */
export interface SearchInput extends SearchFilter {
  /** Max results per page (1..500). Default 50. */
  limit?: number;
  /** Opaque cursor from a previous search_query response. */
  cursor?: string;
  /**
   * When `true`, returned tasks carry a `_links` HATEOAS block (self, project,
   * parent, tags). Default `false` — the block is omitted entirely to save
   * payload size. Get the underlying IDs from `id`, `projectId`, `parentId`,
   * and `tagIds` on the task directly.
   */
  includeLinks?: boolean;
}

/** Result of {@link SearchService.search}. */
export interface SearchResult {
  tasks: Task[];
  nextCursor: string | null;
  hasMore: boolean;
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface SearchServiceDeps {
  adapter: OmniFocusAdapter;
}

/**
 * Service layer for full-text task search.
 *
 * Construct with `{ adapter }`. No mutable state.
 */
export class SearchService {
  private readonly adapter: OmniFocusAdapter;

  constructor({ adapter }: SearchServiceDeps) {
    this.adapter = adapter;
  }

  /**
   * Search tasks by full-text query with optional narrowing filters.
   *
   * @param input — query + filters + pagination
   * @returns Matched tasks for the current page plus cursor metadata.
   * @throws {ValidationError} when `cursor` was produced with different filters.
   */
  async search(input: SearchInput): Promise<SearchResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Build the stable filter (exclude pagination fields from the hash)
    const filterForHash: Record<string, unknown> = {
      ...(input.q !== undefined ? { q: input.q } : {}),
      scope: input.scope ?? "all",
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.tagIds !== undefined ? { tagIds: [...input.tagIds].sort() } : {}),
      ...(input.available !== undefined ? { available: input.available } : {}),
      ...(input.dueBefore !== undefined ? { dueBefore: input.dueBefore } : {}),
      ...(input.dueAfter !== undefined ? { dueAfter: input.dueAfter } : {}),
      ...(input.flagged !== undefined ? { flagged: input.flagged } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    };
    const filterHash = hashFilter(filterForHash);

    // Decode cursor if present (validates filterHash)
    let cursorPayload: CursorPayload | null = null;
    if (input.cursor) {
      cursorPayload = decodeCursor(input.cursor, filterHash);
    }

    // Fetch all matching tasks from the adapter
    const searchFilter: SearchFilter = {
      ...(input.q !== undefined ? { q: input.q } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
      ...(input.available !== undefined ? { available: input.available } : {}),
      ...(input.dueBefore !== undefined ? { dueBefore: input.dueBefore } : {}),
      ...(input.dueAfter !== undefined ? { dueAfter: input.dueAfter } : {}),
      ...(input.flagged !== undefined ? { flagged: input.flagged } : {}),
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
    };
    const allTasks = await this.adapter.searchTasks(searchFilter);

    // Stable sort: createdAt ASC, id ASC
    const sorted = [...allTasks].sort((a, b) => {
      const dateCompare = a.createdAt.localeCompare(b.createdAt);
      return dateCompare !== 0 ? dateCompare : a.id.localeCompare(b.id);
    });

    // Apply cursor offset (search always sorts createdAt ASC)
    const afterCursor = cursorPayload
      ? sorted.filter((t) =>
          isAfterCursor(
            { id: t.id, sortValue: t.createdAt },
            cursorPayload as CursorPayload,
            "asc",
          ),
        )
      : sorted;

    // Take one extra to detect hasMore
    const page = afterCursor.slice(0, limit + 1);
    const hasMore = page.length > limit;
    const bareTasks = page.slice(0, limit);
    const tasks =
      input.includeLinks === true
        ? bareTasks.map((t) => ({ ...t, _links: buildTaskLinks(t) }))
        : bareTasks;

    // Encode next cursor
    const last = tasks.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor({ lastId: last.id, lastSortValue: last.createdAt, filterHash })
        : null;

    return { tasks, nextCursor, hasMore, cacheHit: false };
  }
}
