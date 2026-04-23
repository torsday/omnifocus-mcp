/**
 * `TaskService` — service-layer surface for task queries.
 *
 * Wraps the `OmniFocusAdapter` with the 30s LRU read cache (ADR-0006) and
 * applies the `task_list` business rules on top of the adapter's lower-level
 * `listTasks` primitive:
 *
 * 1. **Validation gate** — reject unbounded queries (no filter, no limit, no
 *    cursor) with a `ValidationError` that tells the agent exactly what to
 *    add. DESIGN §15 forbids unbounded pagination.
 * 2. **Filter translation** — the MCP-facing filter shape (`tagIds[]`,
 *    `completed: "any"|"only"|"exclude"`) is richer than the adapter's
 *    primitive (`tagId`, `completed?: boolean`). The service maps between
 *    the two, pushing what it can to the adapter and post-filtering the
 *    rest (multi-tag intersection).
 * 3. **Stable sort + cursor pagination** — tasks are ordered `(createdAt
 *    ASC, id ASC)` so inserts mid-pagination don't re-shuffle emitted
 *    pages. Cursors carry a `filterHash` so swapping filters mid-sequence
 *    fails loud rather than silently skipping pages (ADR-0013 contract).
 * 4. **Cache key** — `tasks:list:<filterHash>:<cursor|'first'>`. Every
 *    task mutation in the cache's scope (`task:<id>`) invalidates
 *    these entries; the service never needs to think about it.
 *
 * The service is a thin pure module: construct with `{ adapter, cache }` and
 * call `list(input)`. No mutable state.
 *
 * @see DESIGN.md §6.5 — cache strategy
 * @see DESIGN.md §15 — pagination contract
 * @see DESIGN.md §26 — reference implementation for task_list
 * @see docs/adr/0006-read-cache-strategy.md
 */

import { z } from "zod";
import type { OmniFocusAdapter, TaskFilter } from "../adapter/OmniFocusAdapter.js";
import type { ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { Task } from "../domain/task.js";
import { ValidationError } from "../errors/index.js";
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

/** How the MCP tool layer expresses `completed`. Adapter uses boolean. */
export type CompletedMode = "any" | "only" | "exclude";

/** Zod schema for task sort fields (used by the tool layer). */
export const TaskSortBySchema = z.enum(["dueDate", "createdAt", "modifiedAt", "name"]);

/** Fields that tasks can be sorted by. */
export type TaskSortBy = z.infer<typeof TaskSortBySchema>;

/**
 * Input to {@link TaskService.list}. Matches the `task_list` MCP tool schema
 * (DESIGN §26). All fields are optional, but the service requires at least
 * one of `limit`, `cursor`, or a non-empty filter — unbounded queries are
 * rejected (DESIGN §15).
 */
export interface TaskListInput {
  projectId?: ProjectId;
  tagIds?: TagId[];
  flagged?: boolean;
  available?: boolean;
  completed?: CompletedMode;
  dueBefore?: string;
  dueAfter?: string;
  deferredBefore?: string;
  parentId?: TaskId;
  /** Field to sort by. Default "createdAt". */
  sortBy?: TaskSortBy;
  /** Sort direction. Default "asc". */
  sortDirection?: "asc" | "desc";
  /** 1..1000; service default is 200 when caller omits and any filter is set. */
  limit?: number;
  cursor?: string;
}

/** Result of {@link TaskService.list} — the service returns the domain payload plus pagination. */
export interface TaskListResult {
  tasks: Task[];
  /** Opaque cursor for the next page, or `null` if the current page exhausted the match set. */
  nextCursor: string | null;
  /** True if a next page exists (equivalent to `nextCursor !== null`). */
  hasMore: boolean;
  /** True if this response was served from the cache rather than the adapter. */
  cacheHit: boolean;
}

/**
 * Minimum cache-surface the service uses. We type against this narrow shape
 * (rather than the concrete `OmniFocusLruCache`) so tests can inject a stub
 * without pulling in `lru-cache`.
 */
export interface ReadCache {
  wrap<T>(key: string, factory: () => Promise<T>): Promise<T>;
  has(key: string): boolean;
}

export interface TaskServiceDeps {
  adapter: OmniFocusAdapter;
  cache: ReadCache;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TaskService {
  private readonly adapter: OmniFocusAdapter;
  private readonly cache: ReadCache;

  constructor(deps: TaskServiceDeps) {
    this.adapter = deps.adapter;
    this.cache = deps.cache;
  }

  /**
   * List tasks matching `input`. See {@link TaskListInput} for the filter
   * surface; see {@link TaskListResult} for the return shape.
   *
   * @throws ValidationError — unbounded query (no filter/limit/cursor);
   *   invalid limit (outside 1..1000); malformed cursor; cursor filter-hash
   *   mismatch (filters changed mid-sequence); adapter-raised input errors.
   */
  async list(input: TaskListInput): Promise<TaskListResult> {
    const limit = this.resolveLimit(input);
    this.assertBounded(input, limit);

    const normalized = this.normalize(input);
    const filterHash = hashFilter(normalized as unknown as Record<string, unknown>);

    const cursor = input.cursor !== undefined ? decodeCursor(input.cursor, filterHash) : undefined;

    const cacheKey = this.cacheKeyFor(filterHash, input.cursor);
    const cacheHit = this.cache.has(cacheKey);

    // The cached payload is the final page slice — not the adapter's raw list —
    // so cursor pagination remains stable under cache re-use.
    const { tasks, nextCursor } = await this.cache.wrap(cacheKey, async () =>
      this.fetchPage(input, normalized, cursor, limit, filterHash),
    );

    return {
      tasks,
      nextCursor,
      hasMore: nextCursor !== null,
      cacheHit,
    };
  }

  // -- Internal: page assembly -------------------------------------------

  private async fetchPage(
    input: TaskListInput,
    normalized: NormalizedFilter,
    cursor: CursorPayload | undefined,
    limit: number,
    filterHash: string,
  ): Promise<{ tasks: Task[]; nextCursor: string | null }> {
    const adapterFilter = this.toAdapterFilter(input, normalized);
    const raw = await this.adapter.listTasks(adapterFilter);

    // Post-filter: multi-tag intersection (adapter only supports a single tag).
    const postFiltered =
      normalized.tagIds.length > 1
        ? raw.filter((t) => normalized.tagIds.every((id) => t.tagIds.includes(id)))
        : raw;

    // Stable sort: (sortValue, id ASC). Null values sort last regardless of direction.
    const { sortBy, sortDirection } = normalized;
    const getSortValue = (t: Task): string | null => {
      switch (sortBy) {
        case "dueDate":
          return t.dueDate ?? null;
        case "modifiedAt":
          return t.modifiedAt;
        case "name":
          return t.name;
        default:
          return t.createdAt;
      }
    };

    const sorted = [...postFiltered].sort((a, b) => {
      const av = getSortValue(a);
      const bv = getSortValue(b);
      // Nulls last regardless of direction
      if (av === null && bv === null) return a.id < b.id ? -1 : 1;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) {
        const cmp = av < bv ? -1 : 1;
        return sortDirection === "asc" ? cmp : -cmp;
      }
      // Stable tie-break: id ASC
      return a.id < b.id ? -1 : 1;
    });

    const afterCursor =
      cursor !== undefined
        ? sorted.filter((t) =>
            isAfterCursor({ id: t.id, sortValue: getSortValue(t) }, cursor, sortDirection),
          )
        : sorted;

    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const nextCursor = hasMore ? this.encodeNextCursor(page, filterHash, getSortValue) : null;

    return { tasks: page, nextCursor };
  }

  // -- Internal: validation ----------------------------------------------

  private resolveLimit(input: TaskListInput): number {
    if (input.limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new ValidationError(
        `limit must be an integer between 1 and ${MAX_LIMIT}; got ${input.limit}.`,
        {
          suggestion: `Pass a limit between 1 and ${MAX_LIMIT}, or omit to use the default of ${DEFAULT_LIMIT}.`,
          details: { field: "limit", value: input.limit },
        },
      );
    }
    return input.limit;
  }

  /**
   * Reject unbounded queries: no filter, no limit, no cursor. An explicit
   * `limit` or `cursor` counts as a bound. Any non-empty filter counts.
   */
  private assertBounded(input: TaskListInput, _limit: number): void {
    if (input.limit !== undefined || input.cursor !== undefined) return;
    if (this.hasAnyFilter(input)) return;
    throw new ValidationError(
      "task_list requires at least one filter, limit, or cursor. Unbounded queries are rejected.",
      {
        suggestion: "Provide a filter or a limit.",
        details: { field: "filter|limit|cursor" },
      },
    );
  }

  private hasAnyFilter(input: TaskListInput): boolean {
    return (
      input.projectId !== undefined ||
      (input.tagIds !== undefined && input.tagIds.length > 0) ||
      input.flagged !== undefined ||
      input.available !== undefined ||
      input.completed !== undefined ||
      input.dueBefore !== undefined ||
      input.dueAfter !== undefined ||
      input.deferredBefore !== undefined ||
      input.parentId !== undefined
    );
  }

  // -- Internal: filter normalization ------------------------------------

  private normalize(input: TaskListInput): NormalizedFilter {
    // Dedupe + sort tagIds so filterHash is stable under caller-side reordering.
    // Inputs are already branded TagIds (validated at the tool boundary); the
    // Set/sort preserves branding without re-casting.
    const tagIds: TagId[] =
      input.tagIds !== undefined
        ? [...new Set(input.tagIds)].sort((a, b) => a.localeCompare(b))
        : [];
    return {
      projectId: input.projectId,
      tagIds,
      flagged: input.flagged,
      available: input.available,
      completed: input.completed,
      dueBefore: input.dueBefore,
      dueAfter: input.dueAfter,
      deferredBefore: input.deferredBefore,
      parentId: input.parentId,
      sortBy: input.sortBy ?? "createdAt",
      sortDirection: input.sortDirection ?? "asc",
    };
  }

  private toAdapterFilter(_input: TaskListInput, n: NormalizedFilter): TaskFilter {
    const filter: TaskFilter = {};
    if (n.projectId !== undefined) filter.projectId = n.projectId;
    if (n.parentId !== undefined) filter.parentId = n.parentId;
    if (n.tagIds.length === 1) {
      // Push single-tag filters down; multi-tag does an intersection post-fetch.
      const single = n.tagIds[0];
      if (single !== undefined) filter.tagId = single;
    }
    if (n.flagged !== undefined) filter.flagged = n.flagged;
    if (n.available !== undefined) filter.available = n.available;
    if (n.dueBefore !== undefined) filter.dueBefore = n.dueBefore;
    if (n.dueAfter !== undefined) filter.dueAfter = n.dueAfter;
    if (n.deferredBefore !== undefined) filter.deferredBefore = n.deferredBefore;

    // `completed` mode maps to the adapter's boolean `completed` filter:
    //   "only"    → completed=true
    //   "exclude" → completed=false
    //   "any"     → omit (no filter)
    //   undefined → omit (no default applied at the service layer; the tool
    //               schema may apply its own default before reaching here)
    if (n.completed === "only") filter.completed = true;
    else if (n.completed === "exclude") filter.completed = false;

    return filter;
  }

  // -- Internal: cache key + cursor --------------------------------------

  private cacheKeyFor(filterHash: string, cursor: string | undefined): string {
    // Prefix chosen to align with the `search:*` invalidation scope if we
    // decide to widen it later; for now, treat task list results as
    // task-scoped (every task:* invalidation also wipes them).
    return `search:tasks:${filterHash}:${cursor ?? "first"}`;
  }

  private encodeNextCursor(
    page: Task[],
    filterHash: string,
    getSortValue: (t: Task) => string | null,
  ): string {
    const last = page[page.length - 1];
    if (last === undefined) {
      // Unreachable: hasMore implies at least one emitted task.
      throw new ValidationError("Internal: cannot encode cursor for empty page.");
    }
    return encodeCursor({
      lastId: last.id,
      lastSortValue: getSortValue(last),
      filterHash,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface NormalizedFilter {
  projectId: ProjectId | undefined;
  tagIds: TagId[];
  flagged: boolean | undefined;
  available: boolean | undefined;
  completed: CompletedMode | undefined;
  dueBefore: string | undefined;
  dueAfter: string | undefined;
  deferredBefore: string | undefined;
  parentId: TaskId | undefined;
  sortBy: TaskSortBy;
  sortDirection: "asc" | "desc";
}
