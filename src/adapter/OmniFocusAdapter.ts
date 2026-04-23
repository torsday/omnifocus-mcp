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
import type { BuiltinPerspectiveId, Perspective } from "../domain/perspective.js";
import type { Project } from "../domain/project.js";
import type { Tag, TagLocation } from "../domain/tag.js";
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

/**
 * Filter for full-text task search. `q` is matched against `name`, `note`,
 * or both depending on `scope`. Additional fields narrow the match set.
 */
export interface SearchFilter {
  /** Search query string. Case-insensitive; empty string matches all. */
  q: string;
  /** Which fields to search. Default: "all". */
  scope?: "name" | "note" | "all";
  /** Restrict to tasks in this project. */
  projectId?: ProjectId;
  /** Restrict to tasks carrying ALL of these tags. */
  tagIds?: TagId[];
  /** true = flagged only; false = unflagged only; omit = all. */
  flagged?: boolean;
  /** "exclude" = active only; "only" = completed only; "any" = both. */
  completed?: "any" | "only" | "exclude";
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
  /** Set or clear the location trigger on the tag. Pass `null` to remove the location. */
  location?: TagLocation | null;
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

export interface ForecastInput {
  /** ISO-8601 date string — start of range (inclusive). Default: start of today. */
  from: string;
  /** ISO-8601 date string — end of range (inclusive). Default: end of today. */
  to: string;
  includeDeferred?: boolean;
  includeFlagged?: boolean;
  includeOverdue?: boolean;
}

export interface PluginInvokeInput {
  /** Bundle identifier of the Omni Automation plug-in to invoke. */
  identifier: string;
  /**
   * Optional argument forwarded to the plug-in action's `perform()` handler
   * as `Action.args[0]`. Must be JSON-serialisable; defaults to `null`.
   */
  arg?: unknown;
}

export interface PluginInvokeResult {
  /** The value returned by the plug-in action (deserialised from JSON). */
  result: unknown;
}

export interface ForecastResult {
  /** Tasks whose dueDate is before `from` and are not completed/dropped. Only populated when includeOverdue=true (default true). */
  overdue: Task[];
  /** Tasks whose dueDate falls within [from, to] and are not completed/dropped. */
  dueToday: Task[];
  /** Tasks whose deferDate falls within [from, to] and are not completed/dropped. Only populated when includeDeferred=true (default true). */
  deferredToday: Task[];
  /** All flagged tasks that are not completed/dropped. Only populated when includeFlagged=true (default true). */
  flagged: Task[];
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
  /** List projects due for review (nextReviewDate ≤ today or null), sorted by nextReviewDate ascending (nulls first). */
  listProjectsDueForReview(): Promise<Project[]>;
  /** Set a project's review interval. days=null removes the schedule. */
  setProjectReviewInterval(id: ProjectId, days: number | null): Promise<void>;

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

  // -- Perspectives ----------------------------------------------------------

  listPerspectives(): Promise<Perspective[]>;

  /**
   * Evaluate a built-in OmniFocus perspective and return its task list.
   * For "review", returns an empty array (projects shown via review_list_due).
   * For "nearby", returns an empty array (location unavailable from script context).
   */
  evaluatePerspective(id: BuiltinPerspectiveId): Promise<Task[]>;

  // -- Search ----------------------------------------------------------------

  /**
   * Full-text search across tasks. Implementations may push the search to
   * the underlying transport (JXA predicate, OmniJS filter) or perform it
   * in-process. Returns matching tasks in adapter-natural order.
   */
  searchTasks(filter: SearchFilter): Promise<Task[]>;

  // -- Sync ------------------------------------------------------------------

  /** Trigger a sync with Omni Sync; resolves once initiated (does not wait for completion). */
  syncTrigger(): Promise<SyncStatus>;
  getLastSync(): Promise<SyncStatus>;

  // -- Forecast --------------------------------------------------------------
  getForecast(input: ForecastInput): Promise<ForecastResult>;

  // -- Plug-in invocation ----------------------------------------------------

  /**
   * Invoke a named Omni Automation plug-in action via OmniJS.
   *
   * `identifier` is the plug-in's bundle identifier (e.g.
   * `"com.example.my-plugin"`). `arg` is an optional JSON-serialisable
   * value passed to the action's `perform()` handler as `Action.args[0]`.
   *
   * Returns whatever the plug-in action returns (deserialised from JSON).
   * Throws `FeatureRequiresPro` when the plug-in runtime is unavailable (e.g.
   * OmniFocus Standard without the Automation add-on).
   *
   * **Only available via OmniJS transport** — JXA has no access to the
   * plug-in runtime. Routed to `OmniJsTransport` by the routing table.
   */
  pluginInvoke(input: PluginInvokeInput): Promise<PluginInvokeResult>;

  // -- Raw escape hatches (only wired when OMNIFOCUS_ALLOW_RAW_SCRIPT=1) -----

  runJxaScript?(script: string): Promise<unknown>;
  runOmniJsScript?(script: string): Promise<unknown>;
}
