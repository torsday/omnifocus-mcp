import type { Attachment } from "../domain/attachment.js";
import type { BatchOutcome } from "../domain/batch.js";
import type { Folder } from "../domain/folder.js";
import type { AttachmentId, FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
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
  /** Search query string. Optional — omit to filter without keyword. */
  q?: string;
  /** Which fields to search. Default: "all". Ignored when q is omitted. */
  scope?: "name" | "note" | "all";
  /** Restrict to tasks in this project. */
  projectId?: ProjectId;
  /** Restrict to tasks carrying ALL of these tags. */
  tagIds?: TagId[];
  /** true = available tasks only (not blocked, deferred, or completed); false = unavailable only; omit = all. */
  available?: boolean;
  /** Tasks with dueDate strictly before this ISO-8601 timestamp. */
  dueBefore?: string;
  /** Tasks with dueDate strictly after this ISO-8601 timestamp. */
  dueAfter?: string;
  /** true = flagged only; false = unflagged only; omit = all. */
  flagged?: boolean;
  /** "exclude" = active only; "only" = completed only; "any" = both. */
  completed?: "any" | "only" | "exclude";
}

/**
 * Describes where a task should sit among its siblings. OmniFocus has no
 * numeric sibling index; position is always expressed relative to another
 * task (`before` / `after`) or as an absolute end-of-container position
 * (`at: "start" | "end"` within an explicit `in:` container).
 *
 * The `{ before }` / `{ after }` forms assume the reference task and the task
 * being moved share a parent; implementations throw `ValidationError` if
 * they diverge.
 *
 * The `{ at, in }` form reparents the task into `in` if it isn't already
 * there — use this to move a task to the first/last position of a specific
 * project, parent, or the inbox (`{ inbox: true }`).
 */
export type TaskPosition =
  | { before: TaskId }
  | { after: TaskId }
  | {
      at: "start" | "end";
      in: { projectId: ProjectId } | { parentId: TaskId } | { inbox: true };
    };

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

export interface AppLaunchResult {
  /** True when OmniFocus was not running and was launched by this call. */
  launched: boolean;
  /** True when OmniFocus was already running before this call. */
  alreadyRunning: boolean;
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
// Attachment input / result types
// ---------------------------------------------------------------------------

/** Owner of an attachment — exactly one field must be set. */
export type AttachmentOwner =
  | { taskId: TaskId; projectId?: never }
  | { projectId: ProjectId; taskId?: never };

export type ListAttachmentsInput = AttachmentOwner;

export type AddAttachmentInput = AttachmentOwner & {
  /** Absolute resolved path to the source file. Caller must have run assertAttachmentPath. */
  filePath: string;
};

export type RemoveAttachmentInput = AttachmentOwner & {
  attachmentId: AttachmentId;
};

export type SaveAttachmentInput = AttachmentOwner & {
  attachmentId: AttachmentId;
  /** Absolute destination path. Caller must have run assertAttachmentPath on the directory. */
  destPath: string;
};

export interface SaveAttachmentResult {
  /** true when the file was written successfully */
  saved: boolean;
  path: string;
  sizeBytes: number;
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
  /**
   * Best-effort batch create. One transport round-trip per batch. Per-item
   * failures are reported in `failed[]`; successes in `succeeded[]` with the
   * new `TaskId`. Validation of the inputs is the caller's responsibility
   * (tool layer rejects the whole batch on any schema error before calling).
   *
   * @see src/domain/batch.ts — `BatchOutcome` shape
   */
  batchCreateTasks(inputs: CreateTaskInput[]): Promise<BatchOutcome<TaskId>>;
  /**
   * Best-effort batch update. One transport round-trip per batch. Per-item
   * failures are reported in `failed[]`; `succeeded[]` entries carry the
   * updated `TaskId` as the value (echoed, for callers that only inspect
   * indices).
   */
  batchUpdateTasks(
    updates: Array<{ id: TaskId; patch: UpdateTaskInput }>,
  ): Promise<BatchOutcome<TaskId>>;
  /**
   * Best-effort batch complete. One transport round-trip per batch. Per-item
   * failures are reported in `failed[]`; `succeeded[]` entries carry the
   * completed `TaskId` as the value.
   */
  batchCompleteTasks(items: Array<{ id: TaskId; at?: Date }>): Promise<BatchOutcome<TaskId>>;
  /**
   * Duplicate a task. Editable fields (name, note, noteHtml, dates, flagged,
   * tags, estimatedMinutes, repetition, sequential, completedByChildren) copy
   * over; system fields (id, createdAt, modifiedAt, completedAt, droppedAt)
   * are regenerated on the clone. Completed/dropped state is NOT carried — a
   * duplicate is a fresh, active task.
   *
   * When `recursive: true`, the full subtask subtree is walked depth-first and
   * duplicated under the clone, preserving child order.
   *
   * By default the clone lands alongside the source (same projectId/parentId).
   * Supply `destination` to override — one of `{ projectId }`, `{ parentId }`,
   * or `{ toInbox: true }`. Throws `ValidationError` when more than one
   * destination is set; `NotFound` when the source task or destination
   * container does not exist.
   *
   * Returns the clone's new ID and the number of descendants duplicated
   * beneath it (0 when `recursive: false`).
   */
  duplicateTask(
    id: TaskId,
    opts: {
      recursive: boolean;
      destination?: { projectId: ProjectId } | { parentId: TaskId } | { toInbox: true };
    },
  ): Promise<{ newId: TaskId; descendantCount: number }>;
  /**
   * Reorder a task relative to its siblings. See {@link TaskPosition}.
   *
   * - `{ before: TaskId }` / `{ after: TaskId }`: the reference must share a
   *   parent with the task being moved. Throws `ValidationError` if they
   *   don't; `NotFound` if the reference doesn't exist.
   * - `{ at, in }`: absolute start-or-end of a container; reparents into
   *   the container if needed. `NotFound` if the container doesn't exist.
   */
  reorderTask(id: TaskId, position: TaskPosition): Promise<void>;

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

  /**
   * Evaluate a custom OmniFocus perspective by identifier and return its task
   * list. Custom perspectives require OmniFocus Pro and are evaluated via the
   * OmniJS transport (#55). The `identifier` is the opaque id surfaced by
   * `listPerspectives()` for `kind: "custom"` entries.
   *
   * @throws FeatureRequiresPro — when the OmniFocus edition does not expose
   *         the custom-perspective runtime (e.g. Standard without Pro).
   * @throws NotFound — when no custom perspective with the given id exists.
   */
  evaluateCustomPerspective(identifier: string): Promise<Task[]>;

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

  // -- Attachments -----------------------------------------------------------

  /**
   * List all attachments on a task or project.
   * @throws NotFound — when the owner ID does not exist
   */
  listAttachments(input: ListAttachmentsInput): Promise<Attachment[]>;

  /**
   * Add an attachment to a task or project from a local file path.
   * The file is embedded into the OmniFocus database.
   * @throws NotFound — when the owner ID does not exist
   * @throws ValidationError — when the path fails scope/size checks (caller's responsibility)
   */
  addAttachment(input: AddAttachmentInput): Promise<AttachmentId>;

  /**
   * Remove an attachment by ID from its owner.
   * @throws NotFound — when the owner or attachment ID does not exist
   */
  removeAttachment(input: RemoveAttachmentInput): Promise<void>;

  /**
   * Copy an attachment's bytes to a local file path.
   * The destination file is created or overwritten.
   * @throws NotFound — when the owner or attachment ID does not exist
   * @throws ValidationError — when the destination path fails scope checks (caller's responsibility)
   * @throws ScriptError — when the write fails (disk full, permission denied)
   */
  saveAttachmentToPath(input: SaveAttachmentInput): Promise<SaveAttachmentResult>;

  // -- App lifecycle ---------------------------------------------------------

  /**
   * Explicitly launch OmniFocus. Never called automatically — the agent must
   * call this tool only when the user asks. Idempotent: resolves with
   * `alreadyRunning=true` if OF is already open.
   */
  appLaunch(): Promise<AppLaunchResult>;

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

  // -- Change detection ------------------------------------------------------

  /**
   * Return the IDs of tasks and projects whose `modificationDate` is
   * **≥ `sinceIso`** (ISO-8601). Used by `DatabaseWatcher` after an
   * FSEventStream or `fs.watch` event to perform targeted cache invalidation
   * and per-object MCP resource notifications rather than a blanket cache
   * clear.
   *
   * Implementations scan `flattenedTasks` and `flattenedProjects` in a single
   * JXA call; on large databases this takes 300–700 ms. The caller must
   * debounce upstream so this is not called more than once per write burst.
   *
   * @param sinceIso - ISO-8601 lower bound. The JXA comparison is `>=`, so
   *   pass the `detectedAt` timestamp minus a small safety buffer (200 ms) to
   *   guard against sub-second clock skew between the Swift watcher and JXA.
   */
  getChangesSince(sinceIso: string): Promise<{ taskIds: string[]; projectIds: string[] }>;

  // -- Raw escape hatches (only wired when OMNIFOCUS_ALLOW_RAW_SCRIPT=1) -----

  /**
   * Execute an arbitrary JXA script body. The script must define a
   * `function run(argv)` and return a JSON-encoded value. `arg` is serialised
   * to JSON and passed as the single `run()` argument; omit for scripts that
   * don't need input.
   *
   * Dangerous: runs with full Automation privileges. Exposed at the tool
   * layer only when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` (ADR-0004).
   */
  runJxaScript?(script: string, arg?: unknown): Promise<unknown>;

  /**
   * Execute an arbitrary OmniJS script body via OmniAutomation. `arg` is
   * passed through the callback-file bridge (DESIGN §6.2) so the script can
   * access `JSON.parse(argv)`. Omit for scripts that don't need input.
   *
   * Dangerous: runs with full Automation privileges. Exposed at the tool
   * layer only when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` (ADR-0004).
   */
  runOmniJsScript?(script: string, arg?: unknown): Promise<unknown>;
}
