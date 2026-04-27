/**
 * `InMemoryAdapter` — minimal test double for `OmniFocusAdapter`.
 *
 * **Scope (DESIGN §19):** CRUD on tasks/projects/tags/folders, filter
 * application with the same semantics as JXA, and the basic error conditions
 * (`NotFound` on unknown IDs, `ValidationError` on bad input).
 *
 * **Out of scope by design** — exercised only in the integration tier
 * against real OmniFocus:
 * - `available` / `blocked` derivation (full task-graph reachability)
 * - cascade effects of recurring-task completion (next-occurrence spawn)
 * - perspective evaluation
 * - sync mechanics, attachments, TaskPaper/OPML round-trips
 *
 * Methods that fall outside the in-memory scope (`syncTrigger`, etc.) return
 * sensible no-op results so services can be tested end-to-end without
 * pretending the simulator is OmniFocus. Callers that depend on real OF
 * semantics for those surfaces must use the integration tier.
 *
 * Determinism: ID generation is a monotonic counter prefixed by kind; date
 * generation flows through an injectable `now()` clock. Tests can pin both.
 *
 * @see DESIGN.md §6.3, §6.6, §19
 * @see src/adapter/OmniFocusAdapter.ts — interface this satisfies
 */

import type { Attachment } from "../../domain/attachment.js";
import type { Folder } from "../../domain/folder.js";
import {
  type AttachmentId,
  AttachmentId as AttachmentIdCtor,
  type FolderId,
  FolderId as FolderIdCtor,
  type ProjectId,
  ProjectId as ProjectIdCtor,
  type TagId,
  TagId as TagIdCtor,
  type TaskId,
  TaskId as TaskIdCtor,
} from "../../domain/ids.js";
import {
  BUILTIN_PERSPECTIVE_IDS,
  type BuiltinPerspectiveId,
  type Perspective,
} from "../../domain/perspective.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { NotFound, ValidationError } from "../../errors/index.js";
import type {
  AddAttachmentInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  ForecastInput,
  ForecastResult,
  ListAttachmentsInput,
  OmniFocusAdapter,
  PluginInvokeInput,
  PluginInvokeResult,
  RemoveAttachmentInput,
  SaveAttachmentInput,
  SaveAttachmentResult,
  SearchFilter,
  SyncStatus,
  TaskFilter,
  TaskPosition,
  UpdateFolderInput,
  UpdateProjectInput,
  UpdateTagInput,
  UpdateTaskInput,
} from "../OmniFocusAdapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface InMemoryAdapterOptions {
  /** Override for the system clock. Returns ISO-8601-with-offset on each call. */
  now?: () => Date;
  /** Seed for the ID counter. Defaults to 0. */
  idSeed?: number;
}

function normaliseBatchError(e: unknown): { errorCode: string; message: string } {
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code ?? "OF_UNKNOWN";
    return { errorCode: code, message: e.message };
  }
  return { errorCode: "OF_UNKNOWN", message: String(e) };
}

/**
 * Drive a list of inputs through a per-item async operation, accumulating a
 * `BatchOutcome`. Errors from `op` are caught and recorded against the item's
 * index — sibling items are unaffected. The contract mirrors the adapter's
 * batch methods (atomic validation already happened upstream; this is the
 * best-effort execution phase).
 */
async function processBatch<I, V>(
  inputs: readonly I[],
  op: (input: I, index: number) => Promise<V>,
): Promise<import("../../domain/batch.js").BatchOutcome<V>> {
  const succeeded: Array<{ index: number; value: V }> = [];
  const failed: Array<{ index: number; errorCode: string; message: string }> = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (input === undefined) continue;
    try {
      const value = await op(input, i);
      succeeded.push({ index: i, value });
    } catch (e) {
      failed.push({ index: i, ...normaliseBatchError(e) });
    }
  }
  return { succeeded, failed };
}

function isoOf(d: Date): string {
  // toISOString returns Zulu form ("2026-04-21T17:30:00.000Z") which is a valid
  // ISO-8601 with offset (Z == +00:00). The domain dates module accepts this.
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class InMemoryAdapter implements OmniFocusAdapter {
  private readonly now: () => Date;
  private idCounter: number;

  private readonly tasks = new Map<TaskId, Task>();
  private readonly projects = new Map<ProjectId, Project>();
  private readonly tags = new Map<TagId, Tag>();
  private readonly folders = new Map<FolderId, Folder>();
  /** ownerKey → attachments. ownerKey is `task:<id>` or `project:<id>`. */
  private readonly attachments = new Map<string, Map<AttachmentId, Attachment>>();

  private lastSyncAt: string | null = null;
  private forecastTagId: TagId | null = null;

  constructor(options: InMemoryAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idCounter = options.idSeed ?? 0;
  }

  // -- ID generation --------------------------------------------------------

  private nextId<B extends string>(prefix: string, ctor: { of(s: string): B }): B {
    this.idCounter += 1;
    // Pad to keep IDs sortable; pattern still matches ^[A-Za-z0-9._-]{3,64}$.
    return ctor.of(`${prefix}_${this.idCounter.toString().padStart(6, "0")}`);
  }

  // -- Tasks ----------------------------------------------------------------

  async listTasks(filter: TaskFilter): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter((t) => this.matchesTask(t, filter));
  }

  async getTask(id: TaskId): Promise<Task> {
    const task = this.tasks.get(id);
    if (task === undefined) {
      throw new NotFound(`Task not found: ${id}`, { details: { resource: "task", id } });
    }
    return task;
  }

  async getTasksMany(ids: TaskId[]): Promise<(Task | null)[]> {
    return ids.map((id) => this.tasks.get(id) ?? null);
  }

  async createTask(input: CreateTaskInput): Promise<TaskId> {
    if (input.name.trim() === "") {
      throw new ValidationError("Task name must be non-empty", {
        details: { field: "name" },
      });
    }
    if (input.projectId !== undefined && input.parentId !== undefined) {
      throw new ValidationError("createTask: provide projectId OR parentId, not both", {
        details: { field: "projectId|parentId" },
      });
    }
    if (input.projectId !== undefined && !this.projects.has(input.projectId)) {
      throw new NotFound(`Project not found: ${input.projectId}`, {
        details: { resource: "project", id: input.projectId },
      });
    }
    if (input.parentId !== undefined && !this.tasks.has(input.parentId)) {
      throw new NotFound(`Parent task not found: ${input.parentId}`, {
        details: { resource: "task", id: input.parentId },
      });
    }
    for (const tagId of input.tagIds ?? []) {
      if (!this.tags.has(tagId)) {
        throw new NotFound(`Tag not found: ${tagId}`, {
          details: { resource: "tag", id: tagId },
        });
      }
    }

    const id = this.nextId("task", TaskIdCtor);
    const now = isoOf(this.now()) as Task["createdAt"];
    const task: Task = {
      id,
      name: input.name,
      note: input.note ?? null,
      noteHtml: input.noteHtml ?? null,
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? null,
      tagIds: [...(input.tagIds ?? [])],
      deferDate: (input.deferDate ?? null) as Task["deferDate"],
      ...(input.deferDateFloating ? { deferDateFloating: true } : {}),
      dueDate: (input.dueDate ?? null) as Task["dueDate"],
      ...(input.dueDateFloating ? { dueDateFloating: true } : {}),
      estimatedMinutes: input.estimatedMinutes ?? null,
      flagged: input.flagged ?? false,
      completed: false,
      completedAt: null,
      dropped: false,
      droppedAt: null,
      // Availability/blocked derivation is integration-only (DESIGN §19); the
      // in-memory double assumes a freshly-created task is available + unblocked.
      available: true,
      blocked: false,
      sequential: input.sequential ?? false,
      completedByChildren: input.completedByChildren ?? false,
      repetition: null,
      createdAt: now,
      modifiedAt: now,
    };
    this.tasks.set(id, task);
    this.bumpProjectTaskCount(task.projectId, +1);
    return id;
  }

  async updateTask(id: TaskId, patch: UpdateTaskInput): Promise<void> {
    const task = await this.getTask(id);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new ValidationError("Task name must be non-empty", { details: { field: "name" } });
    }
    if (patch.tagIds !== undefined) {
      for (const tagId of patch.tagIds) {
        if (!this.tags.has(tagId)) {
          throw new NotFound(`Tag not found: ${tagId}`, {
            details: { resource: "tag", id: tagId },
          });
        }
      }
    }
    const updated = {
      ...task,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.noteHtml !== undefined ? { noteHtml: patch.noteHtml } : {}),
      ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      ...(patch.deferDate !== undefined ? { deferDate: patch.deferDate as Task["deferDate"] } : {}),
      ...(patch.deferDateFloating === true ? { deferDateFloating: true as const } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate as Task["dueDate"] } : {}),
      ...(patch.dueDateFloating === true ? { dueDateFloating: true as const } : {}),
      ...(patch.estimatedMinutes !== undefined ? { estimatedMinutes: patch.estimatedMinutes } : {}),
      ...(patch.tagIds !== undefined ? { tagIds: [...patch.tagIds] } : {}),
      ...(patch.sequential !== undefined ? { sequential: patch.sequential } : {}),
      ...(patch.completedByChildren !== undefined
        ? { completedByChildren: patch.completedByChildren }
        : {}),
      ...(patch.repetition !== undefined ? { repetition: patch.repetition } : {}),
      modifiedAt: isoOf(this.now()) as Task["modifiedAt"],
    } as Task;
    if (patch.deferDateFloating === false) delete (updated as Partial<Task>).deferDateFloating;
    if (patch.dueDateFloating === false) delete (updated as Partial<Task>).dueDateFloating;
    this.tasks.set(id, updated);
  }

  async completeTask(id: TaskId, at?: Date): Promise<void> {
    return this.applyTaskCompletion(id, true, at);
  }

  async uncompleteTask(id: TaskId): Promise<void> {
    return this.applyTaskCompletion(id, false);
  }

  async dropTask(id: TaskId, at?: Date): Promise<void> {
    return this.applyTaskDropState(id, true, at);
  }

  async undropTask(id: TaskId): Promise<void> {
    return this.applyTaskDropState(id, false);
  }

  /**
   * Toggle a task's completion state. Drives both `completeTask` and
   * `uncompleteTask` from the single boolean pivot.
   *
   * Asymmetric idempotency — load-bearing: **uncomplete** short-circuits
   * if already uncompleted; **complete** does NOT short-circuit. The batch
   * tool's contract (`task_batch_complete` description) explicitly states
   * "Already-completed tasks are not treated specially". Changing this is
   * a behaviour change and belongs in its own issue, not a refactor.
   */
  private async applyTaskCompletion(id: TaskId, completed: boolean, at?: Date): Promise<void> {
    const task = await this.getTask(id);
    if (!completed && !task.completed) return;
    const stamp = completed ? (isoOf(at ?? this.now()) as Task["completedAt"]) : null;
    this.tasks.set(id, {
      ...task,
      completed,
      completedAt: stamp,
      modifiedAt: (stamp ?? isoOf(this.now())) as unknown as Task["modifiedAt"],
    });
    this.bumpProjectCompletedCount(task.projectId, completed ? +1 : -1);
  }

  /**
   * Toggle a task's dropped state. Drives both `dropTask` and `undropTask`
   * from the single boolean pivot. Same idempotency asymmetry as
   * {@link applyTaskCompletion} — drop re-stamps, undrop short-circuits.
   */
  private async applyTaskDropState(id: TaskId, dropped: boolean, at?: Date): Promise<void> {
    const task = await this.getTask(id);
    if (!dropped && !task.dropped) return;
    const stamp = dropped ? (isoOf(at ?? this.now()) as Task["droppedAt"]) : null;
    this.tasks.set(id, {
      ...task,
      dropped,
      droppedAt: stamp,
      modifiedAt: (stamp ?? isoOf(this.now())) as unknown as Task["modifiedAt"],
    });
  }

  async batchCreateTasks(
    inputs: CreateTaskInput[],
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(inputs, (input) => this.createTask(input));
  }

  async batchUpdateTasks(
    updates: Array<{ id: TaskId; patch: UpdateTaskInput }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(updates, async ({ id, patch }) => {
      await this.updateTask(id, patch);
      return id;
    });
  }

  async batchCompleteTasks(
    items: Array<{ id: TaskId; at?: Date }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id, at }) => {
      await this.completeTask(id, at);
      return id;
    });
  }

  async batchUncompleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id }) => {
      await this.uncompleteTask(id);
      return id;
    });
  }

  async batchDeleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id }) => {
      await this.deleteTask(id);
      return id;
    });
  }

  async batchDropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id }) => {
      await this.dropTask(id);
      return id;
    });
  }

  async batchUndropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id }) => {
      await this.undropTask(id);
      return id;
    });
  }

  async deleteTask(id: TaskId): Promise<void> {
    const task = await this.getTask(id);
    this.tasks.delete(id);
    this.adjustProjectCountsForTask(task.projectId, task, -1);
  }

  async moveTask(
    id: TaskId,
    destination: { projectId?: ProjectId; parentId?: TaskId },
  ): Promise<void> {
    const task = await this.getTask(id);
    if (destination.projectId !== undefined && destination.parentId !== undefined) {
      throw new ValidationError("moveTask: provide projectId OR parentId, not both", {
        details: { field: "projectId|parentId" },
      });
    }
    if (destination.projectId !== undefined && !this.projects.has(destination.projectId)) {
      throw new NotFound(`Project not found: ${destination.projectId}`, {
        details: { resource: "project", id: destination.projectId },
      });
    }
    if (destination.parentId !== undefined && !this.tasks.has(destination.parentId)) {
      throw new NotFound(`Parent task not found: ${destination.parentId}`, {
        details: { resource: "task", id: destination.parentId },
      });
    }
    this.adjustProjectCountsForTask(task.projectId, task, -1);

    const newProjectId = destination.projectId ?? null;
    this.tasks.set(id, {
      ...task,
      projectId: newProjectId,
      parentId: destination.parentId ?? null,
      modifiedAt: isoOf(this.now()) as Task["modifiedAt"],
    });
    this.adjustProjectCountsForTask(newProjectId, task, +1);
  }

  async batchMoveTasks(
    items: Array<{ id: TaskId; destination: { projectId?: ProjectId; parentId?: TaskId } }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return processBatch(items, async ({ id, destination }) => {
      await this.moveTask(id, destination);
      return id;
    });
  }

  async duplicateTask(
    id: TaskId,
    opts: {
      recursive: boolean;
      destination?: { projectId: ProjectId } | { parentId: TaskId } | { toInbox: true };
    },
  ): Promise<{ newId: TaskId; descendantCount: number }> {
    const source = await this.getTask(id);

    // Validate / resolve destination.
    let destProjectId: ProjectId | null;
    let destParentId: TaskId | null;
    if (opts.destination === undefined) {
      destProjectId = source.projectId;
      destParentId = source.parentId;
    } else {
      const dest = opts.destination;
      const destKeys =
        ("projectId" in dest ? 1 : 0) +
        ("parentId" in dest ? 1 : 0) +
        ("toInbox" in dest && dest.toInbox === true ? 1 : 0);
      if (destKeys !== 1) {
        throw new ValidationError(
          "duplicateTask: destination must specify exactly one of projectId, parentId, or toInbox",
          { details: { field: "destination" } },
        );
      }
      if ("projectId" in dest) {
        if (!this.projects.has(dest.projectId)) {
          throw new NotFound(`Project not found: ${dest.projectId}`, {
            details: { resource: "project", id: dest.projectId },
          });
        }
        destProjectId = dest.projectId;
        destParentId = null;
      } else if ("parentId" in dest) {
        const parent = this.tasks.get(dest.parentId);
        if (parent === undefined) {
          throw new NotFound(`Parent task not found: ${dest.parentId}`, {
            details: { resource: "task", id: dest.parentId },
          });
        }
        destProjectId = parent.projectId;
        destParentId = dest.parentId;
      } else {
        destProjectId = null;
        destParentId = null;
      }
    }

    // Snapshot of direct children BEFORE cloning (insertion order == sibling order).
    // Needed only when recursive: we walk from the original source's subtree.
    const childrenOf = (parentId: TaskId): Task[] =>
      Array.from(this.tasks.values()).filter((t) => t.parentId === parentId);

    const cloneOne = (src: Task, projectId: ProjectId | null, parentId: TaskId | null): TaskId => {
      const newId = this.nextId("task", TaskIdCtor);
      const now = isoOf(this.now()) as Task["createdAt"];
      const clone: Task = {
        id: newId,
        name: src.name,
        note: src.note,
        noteHtml: src.noteHtml,
        projectId,
        parentId,
        tagIds: [...src.tagIds],
        deferDate: src.deferDate,
        dueDate: src.dueDate,
        estimatedMinutes: src.estimatedMinutes,
        flagged: src.flagged,
        completed: false,
        completedAt: null,
        dropped: false,
        droppedAt: null,
        available: true,
        blocked: false,
        sequential: src.sequential,
        completedByChildren: src.completedByChildren,
        repetition: src.repetition,
        createdAt: now,
        modifiedAt: now,
      };
      this.tasks.set(newId, clone);
      this.bumpProjectTaskCount(projectId, +1);
      return newId;
    };

    const newRootId = cloneOne(source, destProjectId, destParentId);
    let descendantCount = 0;

    if (opts.recursive) {
      const walk = (
        srcParentId: TaskId,
        cloneParentId: TaskId,
        cloneProjectId: ProjectId | null,
      ) => {
        for (const child of childrenOf(srcParentId)) {
          const childClone = cloneOne(child, cloneProjectId, cloneParentId);
          descendantCount += 1;
          walk(child.id, childClone, cloneProjectId);
        }
      };
      walk(source.id, newRootId, destProjectId);
    }

    return { newId: newRootId, descendantCount };
  }

  async reorderTask(id: TaskId, position: TaskPosition): Promise<void> {
    const task = await this.getTask(id);
    const { newProjectId, newParentId, anchorMode, anchorId } = this.resolveReorderDestination(
      id,
      task,
      position,
    );

    const reparented = newProjectId !== task.projectId || newParentId !== task.parentId;
    if (reparented) {
      this.adjustProjectCountsForTask(task.projectId, task, -1);
      this.adjustProjectCountsForTask(newProjectId, task, +1);
    }

    const updated: Task = {
      ...task,
      projectId: newProjectId,
      parentId: newParentId,
      modifiedAt: isoOf(this.now()) as Task["modifiedAt"],
    };

    // Rebuild the task map so insertion order reflects the new sibling
    // position. listTasks() returns Array.from(this.tasks.values()), so
    // insertion order *is* the observable sibling order.
    const remaining: [TaskId, Task][] = [];
    for (const [tid, t] of this.tasks) {
      if (tid === id) continue;
      remaining.push([tid, t]);
    }

    const inContainer = (t: Task): boolean =>
      t.projectId === newProjectId && t.parentId === newParentId;

    let insertAt: number;
    if (anchorMode === "start") {
      insertAt = remaining.findIndex(([, t]) => inContainer(t));
      if (insertAt === -1) insertAt = remaining.length;
    } else if (anchorMode === "end") {
      let last = -1;
      remaining.forEach(([, t], i) => {
        if (inContainer(t)) last = i;
      });
      insertAt = last === -1 ? remaining.length : last + 1;
    } else {
      const refIdx = remaining.findIndex(([tid]) => tid === anchorId);
      // Guaranteed: anchorId existed in the map and wasn't the task being moved.
      insertAt = anchorMode === "before" ? refIdx : refIdx + 1;
    }

    this.tasks.clear();
    remaining.forEach(([tid, t], i) => {
      if (i === insertAt) this.tasks.set(id, updated);
      this.tasks.set(tid, t);
    });
    if (insertAt >= remaining.length) this.tasks.set(id, updated);
  }

  /**
   * Validate `position` and derive the four locals that drive the reorder
   * mutation. Encapsulates all NotFound / ValidationError throws so
   * `reorderTask` itself reads as three phases: resolve → counter-adjust →
   * rebuild map.
   *
   * @throws NotFound when a referenced task/project/parent doesn't exist
   * @throws ValidationError for self-reference, cross-container references,
   *   or self-reparent
   */
  private resolveReorderDestination(
    id: TaskId,
    task: Task,
    position: TaskPosition,
  ): {
    newProjectId: ProjectId | null;
    newParentId: TaskId | null;
    anchorMode: "before" | "after" | "start" | "end";
    anchorId: TaskId | null;
  } {
    if ("before" in position || "after" in position) {
      const refId = "before" in position ? position.before : position.after;
      const ref = this.tasks.get(refId);
      if (ref === undefined) {
        throw new NotFound(`Reference task not found: ${refId}`, {
          details: { resource: "task", id: refId },
        });
      }
      if (refId === id) {
        throw new ValidationError("reorderTask: reference must differ from the task id", {
          details: { field: "position" },
        });
      }
      if (ref.projectId !== task.projectId || ref.parentId !== task.parentId) {
        throw new ValidationError(
          "reorderTask: reference task must share parent with the task being moved",
          { details: { field: "position" } },
        );
      }
      return {
        newProjectId: task.projectId,
        newParentId: task.parentId,
        anchorMode: "before" in position ? "before" : "after",
        anchorId: refId,
      };
    }

    const { at, in: container } = position;
    let newProjectId: ProjectId | null;
    let newParentId: TaskId | null;
    if ("projectId" in container) {
      if (!this.projects.has(container.projectId)) {
        throw new NotFound(`Project not found: ${container.projectId}`, {
          details: { resource: "project", id: container.projectId },
        });
      }
      newProjectId = container.projectId;
      newParentId = null;
    } else if ("parentId" in container) {
      if (!this.tasks.has(container.parentId)) {
        throw new NotFound(`Parent task not found: ${container.parentId}`, {
          details: { resource: "task", id: container.parentId },
        });
      }
      if (container.parentId === id) {
        throw new ValidationError("reorderTask: cannot reparent a task under itself", {
          details: { field: "position.in.parentId" },
        });
      }
      // When reparenting under a task, project scope follows the new parent.
      const parent = this.tasks.get(container.parentId);
      newProjectId = parent?.projectId ?? null;
      newParentId = container.parentId;
    } else {
      newProjectId = null;
      newParentId = null;
    }
    return { newProjectId, newParentId, anchorMode: at, anchorId: null };
  }

  // -- Projects -------------------------------------------------------------

  async listProjects(
    filter: { folderId?: FolderId; status?: Project["status"] } = {},
  ): Promise<Project[]> {
    return Array.from(this.projects.values()).filter((p) => {
      if (filter.folderId !== undefined && p.folderId !== filter.folderId) return false;
      if (filter.status !== undefined && p.status !== filter.status) return false;
      return true;
    });
  }

  async getProject(id: ProjectId): Promise<Project> {
    const project = this.projects.get(id);
    if (project === undefined) {
      throw new NotFound(`Project not found: ${id}`, { details: { resource: "project", id } });
    }
    return project;
  }

  async getProjectsMany(ids: ProjectId[]): Promise<(Project | null)[]> {
    return ids.map((id) => this.projects.get(id) ?? null);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectId> {
    if (input.name.trim() === "") {
      throw new ValidationError("Project name must be non-empty", {
        details: { field: "name" },
      });
    }
    if (input.folderId !== undefined && !this.folders.has(input.folderId)) {
      throw new NotFound(`Folder not found: ${input.folderId}`, {
        details: { resource: "folder", id: input.folderId },
      });
    }

    const id = this.nextId("proj", ProjectIdCtor);
    const now = isoOf(this.now()) as Project["createdAt"];
    const project: Project = {
      id,
      name: input.name,
      note: input.note ?? null,
      noteHtml: input.noteHtml ?? null,
      folderId: input.folderId ?? null,
      tagIds: [...(input.tagIds ?? [])],
      status: input.status ?? "active",
      completionCriterion: input.completionCriterion ?? "parallel",
      deferDate: (input.deferDate ?? null) as Project["deferDate"],
      ...(input.deferDateFloating ? { deferDateFloating: true } : {}),
      dueDate: (input.dueDate ?? null) as Project["dueDate"],
      ...(input.dueDateFloating ? { dueDateFloating: true } : {}),
      estimatedMinutes: input.estimatedMinutes ?? null,
      flagged: input.flagged ?? false,
      reviewIntervalDays: input.reviewIntervalDays ?? null,
      nextReviewDate: null,
      lastReviewDate: null,
      completed: false,
      completedAt: null,
      dropped: false,
      droppedAt: null,
      taskCount: 0,
      completedTaskCount: 0,
      createdAt: now,
      modifiedAt: now,
    };
    this.projects.set(id, project);
    this.bumpFolderProjectCount(project.folderId, +1);
    return id;
  }

  async updateProject(id: ProjectId, patch: UpdateProjectInput): Promise<void> {
    const project = await this.getProject(id);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new ValidationError("Project name must be non-empty", { details: { field: "name" } });
    }
    const updated = {
      ...project,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.noteHtml !== undefined ? { noteHtml: patch.noteHtml } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.completionCriterion !== undefined
        ? { completionCriterion: patch.completionCriterion }
        : {}),
      ...(patch.deferDate !== undefined
        ? { deferDate: patch.deferDate as Project["deferDate"] }
        : {}),
      ...(patch.deferDateFloating === true ? { deferDateFloating: true as const } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate as Project["dueDate"] } : {}),
      ...(patch.dueDateFloating === true ? { dueDateFloating: true as const } : {}),
      ...(patch.estimatedMinutes !== undefined ? { estimatedMinutes: patch.estimatedMinutes } : {}),
      ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      ...(patch.tagIds !== undefined ? { tagIds: [...patch.tagIds] } : {}),
      ...(patch.reviewIntervalDays !== undefined
        ? { reviewIntervalDays: patch.reviewIntervalDays }
        : {}),
      modifiedAt: isoOf(this.now()) as Project["modifiedAt"],
    } as Project;
    if (patch.deferDateFloating === false) delete (updated as Partial<Project>).deferDateFloating;
    if (patch.dueDateFloating === false) delete (updated as Partial<Project>).dueDateFloating;
    this.projects.set(id, updated);
  }

  async completeProject(id: ProjectId, at?: Date): Promise<void> {
    const project = await this.getProject(id);
    const completedAt = isoOf(at ?? this.now()) as Project["completedAt"];
    this.projects.set(id, {
      ...project,
      status: "done",
      completed: true,
      completedAt,
      modifiedAt: completedAt as unknown as Project["modifiedAt"],
    });
  }

  async dropProject(id: ProjectId, at?: Date): Promise<void> {
    const project = await this.getProject(id);
    const droppedAt = isoOf(at ?? this.now()) as Project["droppedAt"];
    this.projects.set(id, {
      ...project,
      status: "dropped",
      dropped: true,
      droppedAt,
      modifiedAt: droppedAt as unknown as Project["modifiedAt"],
    });
  }

  async batchCompleteProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    return processBatch(items, async ({ id }) => {
      await this.completeProject(id);
      return id;
    });
  }

  async batchDropProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    return processBatch(items, async ({ id }) => {
      await this.dropProject(id);
      return id;
    });
  }

  async moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void> {
    const project = await this.getProject(id);
    if (destination.folderId !== null && !this.folders.has(destination.folderId)) {
      throw new NotFound(`Folder not found: ${destination.folderId}`, {
        details: { resource: "folder", id: destination.folderId },
      });
    }
    this.bumpFolderProjectCount(project.folderId, -1);
    this.projects.set(id, {
      ...project,
      folderId: destination.folderId,
      modifiedAt: isoOf(this.now()) as Project["modifiedAt"],
    });
    this.bumpFolderProjectCount(destination.folderId, +1);
  }

  async deleteProject(id: ProjectId): Promise<void> {
    const project = await this.getProject(id);
    // Cascade: orphaned tasks become inbox tasks (matches OF behavior loosely;
    // real OF prompts the user). Out-of-scope details fall to the integration tier.
    for (const [taskId, task] of this.tasks) {
      if (task.projectId === id) {
        this.tasks.set(taskId, { ...task, projectId: null });
      }
    }
    this.projects.delete(id);
    this.bumpFolderProjectCount(project.folderId, -1);
  }

  async markProjectReviewed(id: ProjectId): Promise<void> {
    const project = await this.getProject(id);
    const now = this.now();
    const lastReviewDate = isoOf(now) as Project["lastReviewDate"];
    let nextReviewDate: Project["nextReviewDate"] = null;
    if (project.reviewIntervalDays !== null) {
      const next = new Date(now);
      next.setUTCDate(next.getUTCDate() + project.reviewIntervalDays);
      nextReviewDate = isoOf(next) as Project["nextReviewDate"];
    }
    this.projects.set(id, {
      ...project,
      lastReviewDate,
      nextReviewDate,
      modifiedAt: lastReviewDate as unknown as Project["modifiedAt"],
    });
  }

  async listProjectsDueForReview(): Promise<Project[]> {
    const today = new Date();
    today.setUTCHours(23, 59, 59, 999); // end of today
    return [...this.projects.values()]
      .filter((p) => p.nextReviewDate === null || new Date(p.nextReviewDate) <= today)
      .sort((a, b) => {
        if (a.nextReviewDate === null && b.nextReviewDate === null) return 0;
        if (a.nextReviewDate === null) return -1;
        if (b.nextReviewDate === null) return 1;
        return a.nextReviewDate.localeCompare(b.nextReviewDate);
      });
  }

  async setProjectReviewInterval(id: ProjectId, days: number | null): Promise<void> {
    const project = await this.getProject(id);
    this.projects.set(id, { ...project, reviewIntervalDays: days });
  }

  async setProjectNextReviewDate(id: ProjectId, nextReviewDate: string | null): Promise<void> {
    const project = await this.getProject(id);
    this.projects.set(id, { ...project, nextReviewDate });
  }

  // -- Tags -----------------------------------------------------------------

  async listTags(filter: { parentId?: TagId; status?: Tag["status"] } = {}): Promise<Tag[]> {
    return Array.from(this.tags.values()).filter((t) => {
      if (filter.parentId !== undefined && t.parentId !== filter.parentId) return false;
      if (filter.status !== undefined && t.status !== filter.status) return false;
      return true;
    });
  }

  async getTag(id: TagId): Promise<Tag> {
    const tag = this.tags.get(id);
    if (tag === undefined) {
      throw new NotFound(`Tag not found: ${id}`, { details: { resource: "tag", id } });
    }
    return tag;
  }

  async getTagsMany(ids: TagId[]): Promise<(Tag | null)[]> {
    return ids.map((id) => this.tags.get(id) ?? null);
  }

  async createTag(input: CreateTagInput): Promise<TagId> {
    if (input.name.trim() === "") {
      throw new ValidationError("Tag name must be non-empty", { details: { field: "name" } });
    }
    if (input.parentId !== undefined && !this.tags.has(input.parentId)) {
      throw new NotFound(`Parent tag not found: ${input.parentId}`, {
        details: { resource: "tag", id: input.parentId },
      });
    }

    const id = this.nextId("tag", TagIdCtor);
    const now = isoOf(this.now()) as Tag["createdAt"];
    const tag: Tag = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      status: input.status ?? "active",
      location: null,
      allowsNextAction: input.allowsNextAction ?? true,
      taskCount: 0,
      createdAt: now,
      modifiedAt: now,
    };
    this.tags.set(id, tag);
    return id;
  }

  async updateTag(id: TagId, patch: UpdateTagInput): Promise<void> {
    const tag = await this.getTag(id);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new ValidationError("Tag name must be non-empty", { details: { field: "name" } });
    }
    if (patch.parentId !== undefined && patch.parentId !== null && !this.tags.has(patch.parentId)) {
      throw new NotFound(`Parent tag not found: ${patch.parentId}`, {
        details: { resource: "tag", id: patch.parentId },
      });
    }
    this.tags.set(id, {
      ...tag,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.allowsNextAction !== undefined ? { allowsNextAction: patch.allowsNextAction } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      modifiedAt: isoOf(this.now()) as Tag["modifiedAt"],
    });
  }

  async deleteTag(id: TagId): Promise<void> {
    await this.getTag(id);
    // Drop the tag from any task carrying it.
    for (const [taskId, task] of this.tasks) {
      if (task.tagIds.includes(id)) {
        this.tasks.set(taskId, {
          ...task,
          tagIds: task.tagIds.filter((t) => t !== id),
        });
      }
    }
    this.tags.delete(id);
  }

  // -- Folders --------------------------------------------------------------

  async listFolders(filter: { parentId?: FolderId } = {}): Promise<Folder[]> {
    return Array.from(this.folders.values()).filter((f) => {
      if (filter.parentId !== undefined && f.parentId !== filter.parentId) return false;
      return true;
    });
  }

  async getFolder(id: FolderId): Promise<Folder> {
    const folder = this.folders.get(id);
    if (folder === undefined) {
      throw new NotFound(`Folder not found: ${id}`, { details: { resource: "folder", id } });
    }
    return folder;
  }

  async createFolder(input: CreateFolderInput): Promise<FolderId> {
    if (input.name.trim() === "") {
      throw new ValidationError("Folder name must be non-empty", {
        details: { field: "name" },
      });
    }
    if (input.parentId !== undefined && !this.folders.has(input.parentId)) {
      throw new NotFound(`Parent folder not found: ${input.parentId}`, {
        details: { resource: "folder", id: input.parentId },
      });
    }

    const id = this.nextId("fold", FolderIdCtor);
    const now = isoOf(this.now()) as Folder["createdAt"];
    const folder: Folder = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      projectCount: 0,
      subfolderCount: 0,
      createdAt: now,
      modifiedAt: now,
    };
    this.folders.set(id, folder);
    if (folder.parentId !== null) this.bumpFolderSubfolderCount(folder.parentId, +1);
    return id;
  }

  async updateFolder(id: FolderId, patch: UpdateFolderInput): Promise<void> {
    const folder = await this.getFolder(id);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new ValidationError("Folder name must be non-empty", { details: { field: "name" } });
    }
    if (
      patch.parentId !== undefined &&
      patch.parentId !== null &&
      !this.folders.has(patch.parentId)
    ) {
      throw new NotFound(`Parent folder not found: ${patch.parentId}`, {
        details: { resource: "folder", id: patch.parentId },
      });
    }
    if (patch.parentId !== undefined && patch.parentId !== folder.parentId) {
      if (folder.parentId !== null) this.bumpFolderSubfolderCount(folder.parentId, -1);
      if (patch.parentId !== null) this.bumpFolderSubfolderCount(patch.parentId, +1);
    }
    this.folders.set(id, {
      ...folder,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      modifiedAt: isoOf(this.now()) as Folder["modifiedAt"],
    });
  }

  async deleteFolder(id: FolderId): Promise<void> {
    const folder = await this.getFolder(id);
    if (folder.projectCount > 0 || folder.subfolderCount > 0) {
      throw new ValidationError(
        `Folder is not empty (projects=${folder.projectCount}, subfolders=${folder.subfolderCount})`,
        { details: { resource: "folder", id } },
      );
    }
    this.folders.delete(id);
    if (folder.parentId !== null) this.bumpFolderSubfolderCount(folder.parentId, -1);
  }

  // -- Search ---------------------------------------------------------------

  /**
   * In-memory full-text search across task name and/or note.
   *
   * Matching is case-insensitive substring search. Additional filter fields
   * (projectId, tagIds, flagged, completed) narrow the result set with the
   * same semantics as `listTasks`. Returns matching tasks in creation order.
   */
  async searchTasks(filter: SearchFilter): Promise<Task[]> {
    const q = filter.q !== undefined ? filter.q.toLowerCase() : null;
    const scope = filter.scope ?? "all";

    return Array.from(this.tasks.values()).filter((task) => {
      // Text match (only when q provided)
      if (q !== null) {
        const inName = scope !== "note" && task.name.toLowerCase().includes(q);
        const inNote = scope !== "name" && (task.note ?? "").toLowerCase().includes(q);
        if (!inName && !inNote) return false;
      }

      // projectId filter
      if (filter.projectId !== undefined && task.projectId !== filter.projectId) return false;

      // tagIds filter (task must carry ALL requested tags)
      if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
        const taskTagSet = new Set(task.tagIds);
        if (!filter.tagIds.every((tid) => taskTagSet.has(tid))) return false;
      }

      // available filter
      if (filter.available !== undefined && task.available !== filter.available) return false;

      // due date range filters
      if (filter.dueBefore !== undefined || filter.dueAfter !== undefined) {
        if (task.dueDate === null) return false;
        const due = new Date(task.dueDate);
        if (filter.dueBefore !== undefined && due >= new Date(filter.dueBefore)) return false;
        if (filter.dueAfter !== undefined && due <= new Date(filter.dueAfter)) return false;
      }

      // flagged filter
      if (filter.flagged !== undefined && task.flagged !== filter.flagged) return false;

      // completed filter
      const isCompleted = task.completedAt !== null;
      if (filter.completed === "only" && !isCompleted) return false;
      if (filter.completed === "exclude" && isCompleted) return false;

      return true;
    });
  }

  // -- Sync (no-op stubs; integration tier owns real semantics) ------------

  async syncTrigger(): Promise<SyncStatus> {
    this.lastSyncAt = isoOf(this.now());
    return { lastSyncAt: this.lastSyncAt, inFlight: false };
  }

  async getLastSync(): Promise<SyncStatus> {
    return { lastSyncAt: this.lastSyncAt, inFlight: false };
  }

  // -- Perspectives (in-memory returns the built-in set) --------------------

  async listPerspectives(): Promise<Perspective[]> {
    const builtinNames: Record<string, string> = {
      inbox: "Inbox",
      projects: "Projects",
      tags: "Tags",
      forecast: "Forecast",
      flagged: "Flagged",
      nearby: "Nearby",
      review: "Review",
    };
    return BUILTIN_PERSPECTIVE_IDS.map((id) => ({
      id,
      name: builtinNames[id] ?? id,
      kind: "builtin" as const,
      requiresPro: false,
      icon: null,
    }));
  }

  /**
   * Seed map consulted by {@link evaluateCustomPerspective}. Tests call
   * {@link seedCustomPerspective} to register a known identifier → task-id
   * mapping; production uses the OmniJS transport directly, so this store is
   * unused outside test harnesses.
   */
  private readonly customPerspectives = new Map<string, TaskId[]>();

  /** Test-only helper: associate a custom perspective identifier with a task-id list. */
  seedCustomPerspective(identifier: string, taskIds: TaskId[]): void {
    this.customPerspectives.set(identifier, [...taskIds]);
  }

  async evaluateCustomPerspective(identifier: string): Promise<Task[]> {
    const ids = this.customPerspectives.get(identifier);
    if (ids === undefined) {
      throw new NotFound(`Custom perspective not found: ${identifier}`, {
        details: { resource: "perspective", id: identifier },
      });
    }
    const out: Task[] = [];
    for (const tid of ids) {
      const t = this.tasks.get(tid);
      if (t !== undefined) out.push(t);
    }
    return out;
  }

  async evaluatePerspective(id: BuiltinPerspectiveId): Promise<Task[]> {
    const all = Array.from(this.tasks.values());
    if (id === "review" || id === "nearby") return [];
    if (id === "inbox") {
      return all.filter((t) => t.projectId === null && !t.completed && !t.dropped);
    }
    if (id === "flagged") {
      return all.filter((t) => t.flagged && !t.completed && !t.dropped);
    }
    if (id === "forecast") {
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      return all.filter(
        (t) =>
          t.dueDate !== null && new Date(t.dueDate) <= endOfToday && !t.completed && !t.dropped,
      );
    }
    if (id === "projects") {
      return all.filter((t) => t.projectId !== null && !t.completed && !t.dropped);
    }
    if (id === "tags") {
      return all.filter((t) => t.tagIds.length > 0 && !t.completed && !t.dropped);
    }
    return [];
  }

  async getForecast(input: ForecastInput): Promise<ForecastResult> {
    const all = Array.from(this.tasks.values()).filter((t) => !t.completed && !t.dropped);
    const {
      from,
      to,
      includeOverdue = true,
      includeDeferred = true,
      includeFlagged = true,
    } = input;

    const overdue = includeOverdue ? all.filter((t) => t.dueDate !== null && t.dueDate < from) : [];
    const dueToday = all.filter((t) => t.dueDate !== null && t.dueDate >= from && t.dueDate <= to);
    const deferredToday = includeDeferred
      ? all.filter((t) => t.deferDate !== null && t.deferDate >= from && t.deferDate <= to)
      : [];
    const flagged = includeFlagged ? all.filter((t) => t.flagged) : [];

    return { overdue, dueToday, deferredToday, flagged };
  }

  async getForecastTag(): Promise<{ tagId: TagId | null }> {
    return { tagId: this.forecastTagId };
  }

  async setForecastTag(tagId: TagId | null): Promise<{ tagId: TagId | null }> {
    if (tagId !== null && !this.tags.has(tagId)) {
      throw new NotFound(`Tag not found: ${tagId}`);
    }
    this.forecastTagId = tagId;
    return { tagId };
  }

  // -- Attachments (minimal in-memory store; real semantics in integration tier)
  // Attachment content (bytes) is never stored here — we track metadata only.
  // `saveAttachmentToPath` is a no-op that returns a synthetic result because
  // there are no real bytes to write. Integration tests exercise the real JXA path.

  private ownerKey(input: ListAttachmentsInput): string {
    return input.taskId ? `task:${input.taskId}` : `project:${input.projectId}`;
  }

  async listAttachments(input: ListAttachmentsInput): Promise<Attachment[]> {
    if (input.taskId && !this.tasks.has(input.taskId)) {
      throw new NotFound(`Task not found: ${input.taskId}`);
    }
    if (input.projectId && !this.projects.has(input.projectId)) {
      throw new NotFound(`Project not found: ${input.projectId}`);
    }
    const key = this.ownerKey(input);
    return Array.from(this.attachments.get(key)?.values() ?? []);
  }

  async addAttachment(input: AddAttachmentInput): Promise<AttachmentId> {
    if (input.taskId && !this.tasks.has(input.taskId)) {
      throw new NotFound(`Task not found: ${input.taskId}`);
    }
    if (input.projectId && !this.projects.has(input.projectId)) {
      throw new NotFound(`Project not found: ${input.projectId}`);
    }
    const key = this.ownerKey(input);
    if (!this.attachments.has(key)) this.attachments.set(key, new Map());
    const id = this.nextId("att", AttachmentIdCtor);
    const fileName = input.filePath.split("/").pop() ?? "attachment";
    const att: Attachment = {
      id,
      name: fileName,
      mimeType: null,
      sizeBytes: null,
      addedAt: isoOf(this.now()),
      kind: "embedded",
    };
    // biome-ignore lint/style/noNonNullAssertion: just set above
    this.attachments.get(key)!.set(id, att);
    return id;
  }

  async removeAttachment(input: RemoveAttachmentInput): Promise<void> {
    if (input.taskId && !this.tasks.has(input.taskId)) {
      throw new NotFound(`Task not found: ${input.taskId}`);
    }
    if (input.projectId && !this.projects.has(input.projectId)) {
      throw new NotFound(`Project not found: ${input.projectId}`);
    }
    const key = this.ownerKey(input);
    const store = this.attachments.get(key);
    if (!store?.has(input.attachmentId)) {
      throw new NotFound(`Attachment not found: ${input.attachmentId}`);
    }
    store.delete(input.attachmentId);
  }

  async saveAttachmentToPath(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
    if (input.taskId && !this.tasks.has(input.taskId)) {
      throw new NotFound(`Task not found: ${input.taskId}`);
    }
    if (input.projectId && !this.projects.has(input.projectId)) {
      throw new NotFound(`Project not found: ${input.projectId}`);
    }
    const key = this.ownerKey(input);
    const store = this.attachments.get(key);
    if (!store?.has(input.attachmentId)) {
      throw new NotFound(`Attachment not found: ${input.attachmentId}`);
    }
    // In-memory: no real bytes; return synthetic result satisfying the contract.
    return { saved: true, path: input.destPath, sizeBytes: 0 };
  }

  // -- App lifecycle --------------------------------------------------------
  // The in-memory adapter has no OS-level launch capability. Return a
  // synthetic "already running" response so tests that exercise the tool
  // surface don't need a live OmniFocus process.

  async appLaunch(): Promise<import("../OmniFocusAdapter.js").AppLaunchResult> {
    return { launched: false, alreadyRunning: true };
  }

  // -- Window controls (in-memory: synthetic state) ------------------------
  // The in-memory adapter doesn't model an actual OmniFocus window, but it
  // satisfies the contract so unit tests can exercise tool wiring without
  // a live OF. State is preserved across calls so set → get round-trips.

  private windowPerspectiveName: string | null = null;
  private windowFocusContainerIds: string[] = [];

  async getWindowState(): Promise<{
    perspectiveName: string | null;
    focusContainerIds: string[];
  }> {
    return {
      perspectiveName: this.windowPerspectiveName,
      focusContainerIds: [...this.windowFocusContainerIds],
    };
  }

  async setWindowPerspective(perspectiveName: string): Promise<{ perspectiveName: string }> {
    this.windowPerspectiveName = perspectiveName;
    return { perspectiveName };
  }

  async setWindowFocus(containerId: string | null): Promise<{ focusContainerIds: string[] }> {
    if (containerId === null) {
      this.windowFocusContainerIds = [];
      return { focusContainerIds: [] };
    }
    // Validate the container exists as either a project or folder. The
    // adapter stores ProjectId/FolderId-keyed maps; iterate to compare by
    // string value rather than casting to brand types (lint: no-id-cast).
    let exists = false;
    for (const id of this.projects.keys()) {
      if (String(id) === containerId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      for (const id of this.folders.keys()) {
        if (String(id) === containerId) {
          exists = true;
          break;
        }
      }
    }
    if (!exists) {
      throw new NotFound(`Container not found (project or folder): ${containerId}`);
    }
    this.windowFocusContainerIds = [containerId];
    return { focusContainerIds: [containerId] };
  }

  // -- Plug-in invocation ---------------------------------------------------
  // The in-memory adapter is used exclusively for unit tests and does not
  // have access to the OmniJS plug-in runtime. Throw `NotFound` with a
  // distinguishable message so tests can assert the surface exists without
  // needing a real OmniFocus plug-in.

  async pluginInvoke(_input: PluginInvokeInput): Promise<PluginInvokeResult> {
    throw new NotFound(
      "pluginInvoke is not supported by InMemoryAdapter — use a real OmniJsTransport for integration tests",
    );
  }

  // -- Change detection ------------------------------------------------------

  async getChangesSince(sinceIso: string): Promise<{ taskIds: string[]; projectIds: string[] }> {
    const since = new Date(sinceIso).getTime();
    const taskIds = [...this.tasks.values()]
      .filter((t) => new Date(t.modifiedAt).getTime() >= since)
      .map((t) => t.id as string);
    const projectIds = [...this.projects.values()]
      .filter((p) => new Date(p.modifiedAt).getTime() >= since)
      .map((p) => p.id as string);
    return { taskIds, projectIds };
  }

  // -- Internal helpers -----------------------------------------------------

  private matchesTask(task: Task, filter: TaskFilter): boolean {
    if (filter.projectId !== undefined && task.projectId !== filter.projectId) return false;
    if (filter.parentId !== undefined && task.parentId !== filter.parentId) return false;
    if (filter.tagId !== undefined && !task.tagIds.includes(filter.tagId)) return false;
    if (filter.flagged !== undefined && task.flagged !== filter.flagged) return false;
    if (filter.completed !== undefined && task.completed !== filter.completed) return false;
    if (filter.available !== undefined && task.available !== filter.available) return false;
    if (filter.blocked !== undefined && task.blocked !== filter.blocked) return false;
    if (filter.completedSince !== undefined) {
      if (task.completedAt === null || task.completedAt < filter.completedSince) return false;
    }
    if (filter.dueBefore !== undefined) {
      if (task.dueDate === null || task.dueDate >= filter.dueBefore) return false;
    }
    if (filter.dueAfter !== undefined) {
      if (task.dueDate === null || task.dueDate <= filter.dueAfter) return false;
    }
    if (filter.deferredBefore !== undefined) {
      if (task.deferDate === null || task.deferDate >= filter.deferredBefore) return false;
    }
    if (filter.deferredAfter !== undefined) {
      if (task.deferDate === null || task.deferDate <= filter.deferredAfter) return false;
    }
    // inbox=true: only tasks with no project assignment (projectId === null)
    if (filter.inbox === true && task.projectId !== null) return false;
    return true;
  }

  private bumpProjectTaskCount(projectId: ProjectId | null, delta: number): void {
    if (projectId === null) return;
    const project = this.projects.get(projectId);
    if (project === undefined) return;
    this.projects.set(projectId, {
      ...project,
      taskCount: Math.max(0, project.taskCount + delta),
    });
  }

  /**
   * Adjust both project-scoped counters in lockstep when a task enters or
   * leaves a project. `delta = +1` on insertion, `-1` on removal. The
   * completed-count only tracks if the task itself is completed — callers
   * must pass the task post-read so the invariant holds.
   */
  private adjustProjectCountsForTask(projectId: ProjectId | null, task: Task, delta: number): void {
    this.bumpProjectTaskCount(projectId, delta);
    if (task.completed) this.bumpProjectCompletedCount(projectId, delta);
  }

  private bumpProjectCompletedCount(projectId: ProjectId | null, delta: number): void {
    if (projectId === null) return;
    const project = this.projects.get(projectId);
    if (project === undefined) return;
    this.projects.set(projectId, {
      ...project,
      completedTaskCount: Math.max(0, project.completedTaskCount + delta),
    });
  }

  private bumpFolderProjectCount(folderId: FolderId | null, delta: number): void {
    if (folderId === null) return;
    const folder = this.folders.get(folderId);
    if (folder === undefined) return;
    this.folders.set(folderId, {
      ...folder,
      projectCount: Math.max(0, folder.projectCount + delta),
    });
  }

  private bumpFolderSubfolderCount(folderId: FolderId, delta: number): void {
    const folder = this.folders.get(folderId);
    if (folder === undefined) return;
    this.folders.set(folderId, {
      ...folder,
      subfolderCount: Math.max(0, folder.subfolderCount + delta),
    });
  }
}
