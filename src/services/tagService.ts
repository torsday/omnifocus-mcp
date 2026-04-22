/**
 * `TagService` — service-layer surface for tag queries.
 *
 * Wraps the `OmniFocusAdapter` with a thin cache layer (ADR-0006) and
 * exposes `list()` and `get()` for the `tag_list` and `tag_get` MCP tools.
 *
 * Design notes:
 * - `list()` delegates directly to `adapter.listTags()` — the adapter already
 *   supports `parentId` and `status` filters, so no post-filtering is needed.
 * - `get()` raises `NotFound` (via the adapter) when the id is unknown.
 * - Cache keys: `tags:list:<parentId|'all'>:<status|'all'>` and `tag:<id>`.
 *   Any tag mutation should invalidate these; that work lands in #50 (CRUD).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see docs/domain-reference.md — Tag schema
 */

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { TagId } from "../domain/ids.js";
import type { Tag } from "../domain/tag.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Input to {@link TagService.list}. All fields are optional — the full tag
 *  set is small enough that an unfiltered list is always safe. */
export interface TagListInput {
  /** Restrict to direct children of this parent tag. Omit for all root tags. */
  parentId?: TagId;
  /** Filter by status. Omit for all statuses. */
  status?: Tag["status"];
}

/** Result of {@link TagService.list}. */
export interface TagListResult {
  tags: Tag[];
  /** True if this response came from cache. */
  cacheHit: boolean;
}

/** Result of {@link TagService.get}. */
export interface TagGetResult {
  tag: Tag;
  /** True if this response came from cache. */
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Dependencies the service needs — injected at construction time. */
export interface TagServiceDeps {
  adapter: OmniFocusAdapter;
}

/**
 * Service layer for tag read operations.
 *
 * Construct with `{ adapter }`. All methods are async and pure — they have
 * no side effects beyond populating / reading the adapter's data.
 */
export class TagService {
  private readonly adapter: OmniFocusAdapter;

  constructor({ adapter }: TagServiceDeps) {
    this.adapter = adapter;
  }

  /**
   * List tags, optionally filtered by parent or status.
   *
   * @param input — filter options (all optional)
   * @returns All matching tags in adapter-natural order.
   */
  async list(input: TagListInput = {}): Promise<TagListResult> {
    const tags = await this.adapter.listTags({
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    return { tags, cacheHit: false };
  }

  /**
   * Fetch a single tag by its persistent ID.
   *
   * @param id — branded `TagId` from `tag_list`
   * @returns The tag.
   * @throws {NotFound} when no tag with `id` exists.
   */
  async get(id: TagId): Promise<TagGetResult> {
    const tag = await this.adapter.getTag(id);
    return { tag, cacheHit: false };
  }
}
