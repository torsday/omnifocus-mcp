/**
 * `OmniFocusAdapter` is the **sacred seam** between the service layer and
 * OmniFocus itself (DESIGN §6.1, §6.3). Services never see `osascript`, never
 * see URL schemes — they consume only this interface.
 *
 * Three concrete implementations satisfy this contract:
 * - `JxaTransport` (#17) — primary, calls `osascript -l JavaScript`
 * - `OmniJsTransport` (#18) — fallback for surfaces JXA can't reach (custom
 *   perspectives, plug-ins) — invoked via `Application("OmniFocus").evaluateJavascript(...)` (ADR-0002 amendment)
 * - `InMemoryAdapter` — unit-test double; behavior asserted by the contract
 *   harness (#30) so substitutability is enforced
 *
 * `TransportRouter` (#19) is itself an `OmniFocusAdapter` that delegates
 * per-method to the right underlying transport.
 *
 * ## Contract
 *
 * - Inputs are validated at the boundary; bad input throws `ValidationError`
 * - Unknown IDs throw `NotFound`
 * - Reads do not mutate; writes are serialized by the calling layer
 *   (concurrency policy lives in DESIGN §6.6, not in implementations)
 * - Dates are `IsoDateString` (ISO-8601 with offset, ADR-0007)
 * - IDs are branded opaque types (ADR-0008)
 * - Errors thrown are members of the typed taxonomy (DESIGN §6.7) — generic
 *   `Error` is forbidden and lint-checked
 *
 * @see DESIGN.md §6.1 — layering
 * @see DESIGN.md §6.3 — adapter sketch (this file is the canonical version)
 * @see DESIGN.md §19 — InMemoryAdapter scope (what's NOT modeled in-memory)
 * @see ADR-0002 — JXA + OmniJS dual transport
 */

import type { Folder } from "../domain/folder.js";
import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";
import type { Tag } from "../domain/tag.js";
import type { RepetitionRule, Task } from "../domain/task.js";

// ---------------------------------------------------------------------------
// Filter / input types
// ---------------------------------------------------------------------------

/**
 * Filters apply on the adapter side; concrete implementations may push them
 * down to the underlying transport (JXA where-clauses, OmniJS predicates, in-
 * memory predicate functions). Semantics are identical across implementations.
 */
export interface TaskFilter {
  projectId?: ProjectId;
  tagId?: TagId;
  parentId?: TaskId;
  flagged?: boolean;
  available?: boolean;
  blocked?: boolean;
  completed?: boolean;
  /** ISO-8601-with-offset string; matches tasks completed on or after */
  completedSince?: string;
  /** ISO-8601-with-offset string; matches tasks due strictly before */
  dueBefore?: string;
  /** ISO-8601-with-offset string; matches tasks due strictly after */
  dueAfter?: string;
  /** ISO-8601-with-offset string; matches tasks deferred strictly before */
  deferredBefore?: string;
  /** ISO-8601-with-offset string; matches tasks deferred strictly after */
  deferredAfter?: string;
}

export interface CreateTaskInput {
  name: string;
  /**
   * Where the task lives. Exactly one of `projectId` or `parentId` may be set.
   * If neither is provided, the task lands in the inbox.
   */
  projectId?: ProjectId;
  parentId?: TaskId;
  note?: string;
  noteHtml?: string;
  flagged?: boolean;
  deferDate?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  tagIds?: TagId[];
  sequential?: boolean;
  completedByChildren?: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  note?: string | null;
  noteHtml?: string | null;
  flagged?: boolean;
  deferDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  tagIds?: TagId[];
  sequential?: boolean;
  completedByChildren?: boolean;
  repetition?: RepetitionRule | null;
}

export interface CreateProjectInput {
  name: string;
  folderId?: FolderId;
  note?: string;
  noteHtml?: string;
  status?: "active" | "on-hold";
  completionCriterion?: "parallel" | "sequential" | "singleActions";
  deferDate?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  flagged?: boolean;
  tagIds?: TagId[];
  reviewIntervalDays?: number;
}

export interface UpdateProjectInput {
  name?: string;
  note?: string | null;
  noteHtml?: string | null;
  status?: "active" | "on-hold";
  completionCriterion?: "parallel" | "sequential" | "singleActions";
  deferDate?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  flagged?: boolean;
  tagIds?: TagId[];
  reviewIntervalDays?: number | null;
}

export interface CreateTagInput {
  name: string;
  parentId?: TagId;
  status?: "active" | "on-hold";
  allowsNextAction?: boolean;
}

export interface UpdateTagInput {
  name?: string;
  parentId?: TagId | null;
  status?: "active" | "on-hold" | "dropped";
  allowsNextAction?: boolean;
}

export interface CreateFolderInput {
  name: string;
  parentId?: FolderId;
}

export interface UpdateFolderInput {
  name?: string;
  parentId?: FolderId | null;
}

export interface SyncStatus {
  /** ISO-8601-with-offset of the last successful sync; `null` if never synced */
  lastSyncAt: string | null;
  /** Whether a sync is currently in flight */
  inFlight: boolean;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Every method returns `Promise<...>` even when the underlying call is
 * synchronous (e.g. InMemoryAdapter). Async-by-default keeps services
 * implementation-agnostic.
 */
export interface OmniFocusAdapter {
  // -- Tasks -----------------------------------------------------------------

  listTasks(filter: TaskFilter): Promise<Task[]>;
  getTask(id: TaskId): Promise<Task>;
  /** Bulk fetch by ID list — returns tasks in input order. Missing IDs surface in `meta.warnings` at the service layer; the adapter signals them by returning `null` for those positions. */
  getTasksMany(ids: TaskId[]): Promise<(Task | null)[]>;
  createTask(input: CreateTaskInput): Promise<TaskId>;
  updateTask(id: TaskId, patch: UpdateTaskInput): Promise<void>;
  completeTask(id: TaskId, at?: Date): Promise<void>;
  uncompleteTask(id: TaskId): Promise<void>;
  dropTask(id: TaskId, at?: Date): Promise<void>;
  undropTask(id: TaskId): Promise<void>;
  /** Hard delete — irreversible; distinct from drop. */
  deleteTask(id: TaskId): Promise<void>;
  moveTask(id: TaskId, destination: { projectId?: ProjectId; parentId?: TaskId }): Promise<void>;

  // -- Projects --------------------------------------------------------------

  listProjects(filter?: { folderId?: FolderId; status?: Project["status"] }): Promise<Project[]>;
  getProject(id: ProjectId): Promise<Project>;
  createProject(input: CreateProjectInput): Promise<ProjectId>;
  updateProject(id: ProjectId, patch: UpdateProjectInput): Promise<void>;
  completeProject(id: ProjectId, at?: Date): Promise<void>;
  dropProject(id: ProjectId, at?: Date): Promise<void>;
  moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void>;
  /** Hard delete — irreversible; distinct from drop. */
  deleteProject(id: ProjectId): Promise<void>;
  /** Mark a project as reviewed (sets `lastReviewDate` to now and advances `nextReviewDate`). */
  markProjectReviewed(id: ProjectId): Promise<void>;

  // -- Tags ------------------------------------------------------------------

  listTags(filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]>;
  getTag(id: TagId): Promise<Tag>;
  createTag(input: CreateTagInput): Promise<TagId>;
  updateTag(id: TagId, patch: UpdateTagInput): Promise<void>;
  deleteTag(id: TagId): Promise<void>;

  // -- Folders ---------------------------------------------------------------

  listFolders(filter?: { parentId?: FolderId }): Promise<Folder[]>;
  getFolder(id: FolderId): Promise<Folder>;
  createFolder(input: CreateFolderInput): Promise<FolderId>;
  updateFolder(id: FolderId, patch: UpdateFolderInput): Promise<void>;
  deleteFolder(id: FolderId): Promise<void>;

  // -- Sync ------------------------------------------------------------------

  /** Trigger a sync with Omni Sync; resolves once initiated (does not wait for completion). */
  syncTrigger(): Promise<SyncStatus>;
  getLastSync(): Promise<SyncStatus>;

  // -- Raw escape hatches (only wired when OMNIFOCUS_ALLOW_RAW_SCRIPT=1) -----

  runJxaScript?(script: string): Promise<unknown>;
  runOmniJsScript?(script: string): Promise<unknown>;
}
