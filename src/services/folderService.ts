/**
 * `FolderService` — service-layer surface for folder queries and mutations.
 *
 * Wraps `OmniFocusAdapter` and exposes read (`list`, `get`) and write
 * (`create`, `update`, `delete`, `move`) operations for the MCP tool layer.
 *
 * Design notes:
 * - `delete` with `cascade: false` (the default) delegates directly to the
 *   adapter which raises `ValidationError` on non-empty folders.
 * - `delete` with `cascade: true` orphans all direct projects (moves them to
 *   no folder) and recursively cascade-deletes all subfolders, then deletes
 *   the now-empty folder. This is intentionally explicit — agents must pass
 *   `cascade: true` to trigger destructive behaviour.
 * - `move` is a thin wrapper over `updateFolder(id, { parentId })`.
 * - Cache invalidation: FolderService does not yet wire an LRU cache (that
 *   integration lands with the full cache pass in #36).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see docs/domain-reference.md — Folder schema
 */

import type {
  CreateFolderInput,
  OmniFocusAdapter,
  UpdateFolderInput,
} from "../adapter/OmniFocusAdapter.js";
import type { Folder } from "../domain/folder.js";
import type { FolderId } from "../domain/ids.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Input to {@link FolderService.list}. All fields optional. */
export interface FolderListInput {
  /** Restrict to direct children of this parent folder. Omit for root folders. */
  parentId?: FolderId;
}

/** Result of {@link FolderService.list}. */
export interface FolderListResult {
  folders: Folder[];
  cacheHit: boolean;
}

/** Result of {@link FolderService.get}. */
export interface FolderGetResult {
  folder: Folder;
  cacheHit: boolean;
}

/** Result of {@link FolderService.create}. */
export interface FolderCreateResult {
  id: FolderId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Dependencies injected at construction time. */
export interface FolderServiceDeps {
  adapter: OmniFocusAdapter;
}

/**
 * Service layer for folder read and write operations.
 *
 * Construct with `{ adapter }`. All methods are async and free of hidden state.
 */
export class FolderService {
  private readonly adapter: OmniFocusAdapter;

  constructor({ adapter }: FolderServiceDeps) {
    this.adapter = adapter;
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  /**
   * List folders, optionally filtered by parent.
   *
   * @param input — filter options (all optional)
   * @returns Matching folders in adapter-natural order.
   */
  async list(input: FolderListInput = {}): Promise<FolderListResult> {
    const folders = await this.adapter.listFolders(
      input.parentId !== undefined ? { parentId: input.parentId } : {},
    );
    return { folders, cacheHit: false };
  }

  /**
   * Fetch a single folder by its persistent ID.
   *
   * @param id — branded `FolderId` from `folder_list`
   * @returns The folder with `projectCount` and `subfolderCount`.
   * @throws {NotFound} when no folder with `id` exists.
   */
  async get(id: FolderId): Promise<FolderGetResult> {
    const folder = await this.adapter.getFolder(id);
    return { folder, cacheHit: false };
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  /**
   * Create a new folder.
   *
   * @param input — name (required), optional parentId
   * @returns Branded ID of the newly created folder.
   * @throws {ValidationError} when name is empty.
   * @throws {NotFound} when parentId references a non-existent folder.
   */
  async create(input: CreateFolderInput): Promise<FolderCreateResult> {
    const id = await this.adapter.createFolder(input);
    return { id };
  }

  /**
   * Update a folder's name or parent (partial patch).
   *
   * @param id — folder to update
   * @param patch — fields to change
   * @throws {NotFound} when no folder with `id` exists.
   * @throws {ValidationError} when `name` is present but empty.
   */
  async update(id: FolderId, patch: UpdateFolderInput): Promise<void> {
    await this.adapter.updateFolder(id, patch);
  }

  /**
   * Delete a folder.
   *
   * By default (`cascade: false`) the adapter raises `ValidationError` when
   * the folder is non-empty. Pass `cascade: true` to first orphan all direct
   * projects (move to no folder) and recursively delete all subfolders, then
   * delete the now-empty folder.
   *
   * @param id — folder to delete
   * @param cascade — when true, recursively empty the folder before deleting
   * @throws {NotFound} when no folder with `id` exists.
   * @throws {ValidationError} when non-empty and `cascade` is false.
   */
  async delete(id: FolderId, cascade = false): Promise<void> {
    if (cascade) {
      await this._cascadeEmpty(id);
    }
    await this.adapter.deleteFolder(id);
  }

  /**
   * Move a folder to a new parent (or promote to root by passing `null`).
   *
   * @param id — folder to move
   * @param parentId — new parent folder ID, or null for root
   * @throws {NotFound} when `id` or the new `parentId` doesn't exist.
   */
  async move(id: FolderId, parentId: FolderId | null): Promise<void> {
    await this.adapter.updateFolder(id, { parentId });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Recursively empty a folder: orphan direct projects, cascade-delete
   * all subfolders, leaving the folder itself ready for deletion.
   */
  private async _cascadeEmpty(id: FolderId): Promise<void> {
    // Orphan all direct projects (move them out of this folder)
    const projects = await this.adapter.listProjects({ folderId: id });
    await Promise.all(projects.map((p) => this.adapter.moveProject(p.id, { folderId: null })));

    // Recursively cascade-delete all direct subfolders
    const subfolders = await this.adapter.listFolders({ parentId: id });
    for (const subfolder of subfolders) {
      await this._cascadeEmpty(subfolder.id);
      await this.adapter.deleteFolder(subfolder.id);
    }
  }
}
