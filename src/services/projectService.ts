/**
 * `ProjectService` — service-layer surface for project queries.
 *
 * Wraps the `OmniFocusAdapter` with the 30s LRU read cache (ADR-0006) and
 * applies the `project_list` / `project_get` business rules on top of the
 * adapter's lower-level primitives. Mirrors the structure of `TaskService`
 * (DESIGN §26) so the two read surfaces have identical ergonomics.
 *
 * Filter plumbing:
 *   `folderId` and `status` map 1:1 to the adapter's narrow filter.
 *   `flagged` and `reviewDueBefore` are post-filtered in-service because
 *   the adapter's primitive does not accept them.
 *
 * Pagination is stable `(createdAt ASC, id ASC)` — inserts mid-page do not
 * shuffle the emitted page set. Cursors carry a `filterHash` so swapping
 * filters mid-sequence fails loud rather than silently skipping pages.
 *
 * `get(id, { includeTaskTree })` optionally attaches the project's full task
 * set (flat array; clients rebuild the tree via `parentId`) behind a cache
 * key that invalidates on `task:*` / `project:*` writes.
 *
 * @see DESIGN.md §6.5 — cache strategy
 * @see DESIGN.md §15 — pagination contract
 * @see DESIGN.md §26 — reference implementation (task_list)
 * @see src/services/taskService.ts — sibling service for tasks
 */

import type {
  CreateProjectInput,
  OmniFocusAdapter,
  UpdateProjectInput,
} from "../adapter/OmniFocusAdapter.js";
import type { FolderId, ProjectId } from "../domain/ids.js";
import { buildProjectLinks, buildTaskLinks } from "../domain/links.js";
import type { Project } from "../domain/project.js";
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

/** Project status filter — accepts the raw domain enum values. */
export type ProjectStatusFilter = Project["status"];

/**
 * Input to {@link ProjectService.list}. Matches the `project_list` MCP tool
 * schema. All fields are optional, but the service requires at least one of
 * `limit`, `cursor`, or a non-empty filter — unbounded queries are rejected
 * (DESIGN §15).
 */
export interface ProjectListInput {
  folderId?: FolderId;
  status?: ProjectStatusFilter;
  flagged?: boolean;
  /**
   * Return only projects whose `nextReviewDate` is strictly before this
   * moment. ISO-8601 with offset. Projects without a review interval
   * (`nextReviewDate === null`) are excluded.
   */
  reviewDueBefore?: string;
  /** 1..1000; service default is 200 when caller omits and any filter is set. */
  limit?: number;
  cursor?: string;
  /**
   * When `true`, returned projects carry a `_links` HATEOAS block (self, folder).
   * Default `false` — the block is omitted entirely to save payload size.
   * Get the underlying IDs from `id` and `folderId` on the project directly.
   */
  includeLinks?: boolean;
}

/** Result of {@link ProjectService.list}. Same envelope shape as TaskService. */
export interface ProjectListResult {
  projects: Project[];
  /** Opaque cursor for the next page, or `null` when exhausted. */
  nextCursor: string | null;
  /** `true` iff `nextCursor !== null`. */
  hasMore: boolean;
  /** `true` when the response was served from the LRU cache. */
  cacheHit: boolean;
}

/** Input to {@link ProjectService.get}. */
export interface ProjectGetInput {
  id: ProjectId;
  /** Default `true`. When `false`, `tasks` is omitted from the result. */
  includeTaskTree?: boolean;
  /** See {@link ProjectListInput.includeLinks}. Applies to the project and any attached tasks. */
  includeLinks?: boolean;
}

/** Result of {@link ProjectService.get}. */
export interface ProjectGetResult {
  project: Project;
  /** Flat task list belonging to this project; omitted when `includeTaskTree=false`. */
  tasks?: Task[];
  cacheHit: boolean;
}

/** Narrow cache surface — same as `TaskService.ReadCache`. */
export interface ReadCache {
  wrap<T>(key: string, factory: () => Promise<T>): Promise<T>;
  has(key: string): boolean;
}

export interface ProjectServiceDeps {
  adapter: OmniFocusAdapter;
  cache: ReadCache;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProjectService {
  private readonly adapter: OmniFocusAdapter;
  private readonly cache: ReadCache;

  constructor(deps: ProjectServiceDeps) {
    this.adapter = deps.adapter;
    this.cache = deps.cache;
  }

  /**
   * List projects matching `input`. See {@link ProjectListInput}.
   *
   * @throws ValidationError — unbounded query (no filter/limit/cursor);
   *   invalid limit (outside 1..1000); malformed cursor; cursor filter-hash
   *   mismatch.
   */
  async list(input: ProjectListInput): Promise<ProjectListResult> {
    const limit = this.resolveLimit(input);
    this.assertBounded(input);

    const normalized = this.normalize(input);
    const filterHash = hashFilter(normalized as unknown as Record<string, unknown>);

    const cursor = input.cursor !== undefined ? decodeCursor(input.cursor, filterHash) : undefined;

    const cacheKey = this.listCacheKey(filterHash, input.cursor);
    const cacheHit = this.cache.has(cacheKey);

    // `_links` is injected post-cache so toggling includeLinks doesn't
    // fragment the cache.
    const { projects: bareProjects, nextCursor } = await this.cache.wrap(cacheKey, async () =>
      this.fetchPage(normalized, cursor, limit, filterHash),
    );

    const projects =
      input.includeLinks === true
        ? bareProjects.map((p) => ({ ...p, _links: buildProjectLinks(p) }))
        : bareProjects;

    return {
      projects,
      nextCursor,
      hasMore: nextCursor !== null,
      cacheHit,
    };
  }

  /** Complete a project (sets completionDate, removes from active view). */
  async completeProject(id: ProjectId): Promise<void> {
    await this.adapter.completeProject(id);
  }

  /** Drop a project (removes from active view without completing). */
  async dropProject(id: ProjectId): Promise<void> {
    await this.adapter.dropProject(id);
  }

  /** Move a project to a folder (or to the root if folderId is null). */
  async moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void> {
    await this.adapter.moveProject(id, destination);
  }

  /** Create a new project with the given fields. Returns the new project's ID. */
  async createProject(input: CreateProjectInput): Promise<ProjectId> {
    return this.adapter.createProject(input);
  }

  /** Partially update mutable fields on an existing project. */
  async updateProject(id: ProjectId, patch: UpdateProjectInput): Promise<void> {
    return this.adapter.updateProject(id, patch);
  }

  /**
   * Fetch a single project by ID, optionally attaching its task tree.
   *
   * @throws NotFound when the project ID does not exist.
   */
  async get(input: ProjectGetInput): Promise<ProjectGetResult> {
    const includeTaskTree = input.includeTaskTree ?? true;
    const includeLinks = input.includeLinks ?? false;
    const cacheKey = this.getCacheKey(input.id, includeTaskTree);
    const cacheHit = this.cache.has(cacheKey);

    // Cache bare (link-free) records — `_links` is injected post-cache so
    // toggling includeLinks doesn't fragment the cache.
    const payload = await this.cache.wrap(cacheKey, async () => {
      const project = await this.adapter.getProject(input.id);
      if (!includeTaskTree) return { project };
      const tasks = await this.adapter.listTasks({ projectId: input.id });
      return { project, tasks };
    });

    const project = includeLinks
      ? { ...payload.project, _links: buildProjectLinks(payload.project) }
      : payload.project;
    const tasks = includeLinks
      ? payload.tasks?.map((t) => ({ ...t, _links: buildTaskLinks(t) }))
      : payload.tasks;

    return {
      project,
      ...(tasks !== undefined ? { tasks } : {}),
      cacheHit,
    };
  }

  // -- Internal: page assembly -------------------------------------------

  private async fetchPage(
    normalized: NormalizedFilter,
    cursor: CursorPayload | undefined,
    limit: number,
    filterHash: string,
  ): Promise<{ projects: Project[]; nextCursor: string | null }> {
    // Push folderId + status down; adapter rejects unknown keys.
    const adapterFilter: { folderId?: FolderId; status?: Project["status"] } = {};
    if (normalized.folderId !== undefined) adapterFilter.folderId = normalized.folderId;
    if (normalized.status !== undefined) adapterFilter.status = normalized.status;

    const raw = await this.adapter.listProjects(adapterFilter);

    // Post-filter: flagged + reviewDueBefore (adapter primitive doesn't accept these).
    const { flagged, reviewDueBefore } = normalized;
    const filtered = raw.filter((p) => {
      if (flagged !== undefined && p.flagged !== flagged) return false;
      if (reviewDueBefore !== undefined) {
        if (p.nextReviewDate === null) return false;
        if (p.nextReviewDate >= reviewDueBefore) return false;
      }
      return true;
    });

    // Stable sort: (createdAt ASC, id ASC).
    const sorted = [...filtered].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

    const afterCursor =
      cursor !== undefined
        ? sorted.filter((p) => isAfterCursor({ id: p.id, sortValue: p.createdAt }, cursor, "asc"))
        : sorted;

    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const nextCursor = hasMore ? this.encodeNextCursor(page, filterHash) : null;

    // Bare projects — `_links` is injected by the public `list()` method only
    // when the caller opts in. Caching link-free results keeps the cache compact.
    return { projects: page, nextCursor };
  }

  // -- Internal: validation ----------------------------------------------

  private resolveLimit(input: ProjectListInput): number {
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

  private assertBounded(input: ProjectListInput): void {
    if (input.limit !== undefined || input.cursor !== undefined) return;
    if (this.hasAnyFilter(input)) return;
    throw new ValidationError(
      "project_list requires at least one filter, limit, or cursor. Unbounded queries are rejected.",
      {
        suggestion: "Provide a filter or a limit.",
        details: { field: "filter|limit|cursor" },
      },
    );
  }

  private hasAnyFilter(input: ProjectListInput): boolean {
    return (
      input.folderId !== undefined ||
      input.status !== undefined ||
      input.flagged !== undefined ||
      input.reviewDueBefore !== undefined
    );
  }

  // -- Internal: normalize + cursor --------------------------------------

  private normalize(input: ProjectListInput): NormalizedFilter {
    return {
      folderId: input.folderId,
      status: input.status,
      flagged: input.flagged,
      reviewDueBefore: input.reviewDueBefore,
    };
  }

  private listCacheKey(filterHash: string, cursor: string | undefined): string {
    // Prefix on `search:` so task-mutation / project-mutation invalidations
    // that emit `search:*` also flush stale list pages. See docs/cache-invalidation.md.
    return `search:projects:${filterHash}:${cursor ?? "first"}`;
  }

  private getCacheKey(id: ProjectId, includeTaskTree: boolean): string {
    return `project:${id}:${includeTaskTree ? "with-tasks" : "solo"}`;
  }

  private encodeNextCursor(page: Project[], filterHash: string): string {
    const last = page[page.length - 1];
    if (last === undefined) {
      // Unreachable: hasMore implies ≥1 emitted project.
      throw new ValidationError("Internal: cannot encode cursor for empty page.");
    }
    return encodeCursor({
      lastId: last.id,
      lastSortValue: last.createdAt,
      filterHash,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface NormalizedFilter {
  folderId: FolderId | undefined;
  status: ProjectStatusFilter | undefined;
  flagged: boolean | undefined;
  reviewDueBefore: string | undefined;
}
