/**
 * `TagService` — service-layer surface for tag queries and mutations.
 *
 * Wraps `OmniFocusAdapter` and exposes read (`list`, `get`) and write
 * (`create`, `update`, `delete`, `move`, `setStatus`, `setAllowsNextAction`)
 * operations for the MCP tool layer.
 *
 * Design notes:
 * - All reads delegate directly to the adapter — tag sets are small enough
 *   that unbounded listing is safe (no pagination required).
 * - Mutations delegate to `adapter.createTag / updateTag / deleteTag`.
 *   `move`, `setStatus`, and `setAllowsNextAction` are thin specialisations of
 *   `updateTag` exposed as separate tools to give agents atomic, composable
 *   operations (DESIGN agent_systems §atomic).
 * - Cache invalidation: TagService does not yet wire an LRU cache (that
 *   integration lands with the full service-layer cache pass in #36). Any
 *   future cache layer must be invalidated on every write method here.
 *
 * @see DESIGN.md §26 — reference implementation
 * @see docs/domain-reference.md — Tag schema
 * @see src/adapter/OmniFocusAdapter.ts — CreateTagInput / UpdateTagInput
 */

import type {
  CreateTagInput,
  OmniFocusAdapter,
  UpdateTagInput,
} from "../adapter/OmniFocusAdapter.js";
import type { TagId } from "../domain/ids.js";
import type { Tag } from "../domain/tag.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Input to {@link TagService.list}. All fields optional. */
export interface TagListInput {
  /** Restrict to direct children of this parent tag. Omit for root tags. */
  parentId?: TagId;
  /** Filter by status. Omit for all statuses. */
  status?: Tag["status"];
}

/** Result of {@link TagService.list}. */
export interface TagListResult {
  tags: Tag[];
  cacheHit: boolean;
}

/** Result of {@link TagService.get}. */
export interface TagGetResult {
  tag: Tag;
  cacheHit: boolean;
}

/** Result of write operations that return an ID. */
export interface TagCreateResult {
  id: TagId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Dependencies injected at construction time. */
export interface TagServiceDeps {
  adapter: OmniFocusAdapter;
}

/**
 * Service layer for tag read and write operations.
 *
 * Construct with `{ adapter }`. All methods are async and
 * free of hidden state — side effects are limited to the adapter.
 */
export class TagService {
  private readonly adapter: OmniFocusAdapter;

  constructor({ adapter }: TagServiceDeps) {
    this.adapter = adapter;
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  /**
   * Create a new tag.
   *
   * @param input — name (required), optional parentId, status, allowsNextAction
   * @returns Branded ID of the newly created tag.
   * @throws {ValidationError} when name is empty.
   * @throws {NotFound} when parentId references a non-existent tag.
   */
  async create(input: CreateTagInput): Promise<TagCreateResult> {
    const id = await this.adapter.createTag(input);
    return { id };
  }

  /**
   * Update mutable fields on an existing tag (partial patch).
   *
   * @param id — tag to update
   * @param patch — fields to change (omit to leave unchanged)
   * @throws {NotFound} when no tag with `id` exists.
   * @throws {ValidationError} when `name` is present but empty.
   */
  async update(id: TagId, patch: UpdateTagInput): Promise<void> {
    await this.adapter.updateTag(id, patch);
  }

  /**
   * Hard-delete a tag.  Irreversible.
   *
   * @param id — tag to delete
   * @throws {NotFound} when no tag with `id` exists.
   */
  async delete(id: TagId): Promise<void> {
    await this.adapter.deleteTag(id);
  }

  /**
   * Move a tag to a new parent (or promote it to root by passing `null`).
   *
   * Implemented as `updateTag(id, { parentId })` — a distinct tool
   * is exposed so agents have an atomic, intention-clear operation.
   *
   * @param id — tag to move
   * @param parentId — new parent tag ID, or `null` to promote to root
   * @throws {NotFound} when `id` or the new `parentId` doesn't exist.
   */
  async move(id: TagId, parentId: TagId | null): Promise<void> {
    await this.adapter.updateTag(id, { parentId });
  }

  /**
   * Set the lifecycle status of a tag (active / on-hold / dropped).
   *
   * @param id — tag to update
   * @param status — new status value
   * @throws {NotFound} when no tag with `id` exists.
   */
  async setStatus(id: TagId, status: Tag["status"]): Promise<void> {
    await this.adapter.updateTag(id, { status });
  }

  /**
   * Toggle whether the tag allows next-action selection in OmniFocus.
   *
   * @param id — tag to update
   * @param value — true to enable, false to disable
   * @throws {NotFound} when no tag with `id` exists.
   */
  async setAllowsNextAction(id: TagId, value: boolean): Promise<void> {
    await this.adapter.updateTag(id, { allowsNextAction: value });
  }

  /**
   * Set a geographic location trigger on the tag (OmniFocus Pro only).
   *
   * The JXA adapter will throw `FeatureRequiresPro` when running against
   * OmniFocus Standard — this service method is transparent to that error
   * and lets it propagate to the MCP tool layer.
   *
   * @param id — tag to update
   * @param location — location trigger data (lat/lon/radius/trigger/optional name)
   * @throws {NotFound} when no tag with `id` exists.
   * @throws {FeatureRequiresPro} (from adapter) on OmniFocus Standard.
   */
  async setLocation(id: TagId, location: TagLocation): Promise<void> {
    await this.adapter.updateTag(id, { location });
  }

  /**
   * Clear the geographic location trigger on the tag.
   *
   * @param id — tag to update
   * @throws {NotFound} when no tag with `id` exists.
   */
  async clearLocation(id: TagId): Promise<void> {
    await this.adapter.updateTag(id, { location: null });
  }

  /**
   * Get the current location trigger for a tag (null if none set).
   *
   * @param id — tag to query
   * @returns The location trigger, or null if not set.
   * @throws {NotFound} when no tag with `id` exists.
   */
  async getLocation(id: TagId): Promise<{ location: TagLocation | null; cacheHit: boolean }> {
    const tag = await this.adapter.getTag(id);
    return { location: tag.location, cacheHit: false };
  }
}
