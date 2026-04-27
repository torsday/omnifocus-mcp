/**
 * `JxaTransport` — primary `OmniFocusAdapter` implementation.
 *
 * Shells to `osascript -l JavaScript` per ADR-0002 / ADR-0005, with each
 * domain method backed by a JXA script under `src/scripts/jxa/*.js`. The
 * `runJxaScript` runner handles process lifecycle, timeout, UTF-8, and
 * typed-error mapping; this class is mostly a thin dispatch layer that
 * loads the right script and shapes the response into the domain types
 * defined by `OmniFocusAdapter`.
 *
 * **Wired domains:** sync, tags, folders.
 * **Stubbed domains:** tasks, projects, search, forecast, notes, repetition,
 * attachments, review — these arrive via follow-up issues so each can carry
 * its own JXA script + tests without piling into a single mega-PR.
 * Stubbed methods throw `ScriptError` with `details.reason: "not-yet-wired"`
 * so `TransportRouter` (#19) can route around them and tests can detect
 * the partial-implementation state precisely.
 *
 * @see DESIGN.md §6.1, §6.3, §6.4 — adapter seam, layering, script discipline
 * @see ADR-0002 — JXA + OmniJS dual transport
 * @see ADR-0005 — scripts as first-class files
 * @see src/adapter/jxa/scriptRunner.ts
 */

import type { Attachment } from "../../domain/attachment.js";
import type { Folder } from "../../domain/folder.js";
import {
  AttachmentId,
  type FolderId,
  FolderId as FolderIdCtor,
  type ProjectId,
  ProjectId as ProjectIdCtor,
  type TagId,
  TagId as TagIdCtor,
  type TaskId,
  TaskId as TaskIdCtor,
} from "../../domain/ids.js";
import type { BuiltinPerspectiveId, Perspective } from "../../domain/perspective.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { ScriptError } from "../../errors/index.js";
import {
  type ChangesSinceScriptResult,
  mapBatchScriptResult,
  type RawBatchScriptResult,
  type TaskDuplicateScriptResult,
} from "../../scripts/contracts.js";
import appLaunchScript from "../../scripts/jxa/app_launch.js";
import attachmentAddScript from "../../scripts/jxa/attachment_add.js";
import attachmentListScript from "../../scripts/jxa/attachment_list.js";
import attachmentRemoveScript from "../../scripts/jxa/attachment_remove.js";
import attachmentSaveToPathScript from "../../scripts/jxa/attachment_save_to_path.js";
import changesSinceScript from "../../scripts/jxa/changes_since.js";
import folderCreateScript from "../../scripts/jxa/folder_create.js";
import folderDeleteScript from "../../scripts/jxa/folder_delete.js";
import folderGetScript from "../../scripts/jxa/folder_get.js";
import folderListScript from "../../scripts/jxa/folder_list.js";
import folderUpdateScript from "../../scripts/jxa/folder_update.js";
import forecastGetScript from "../../scripts/jxa/forecast_get.js";
import perspectiveEvaluateScript from "../../scripts/jxa/perspective_evaluate.js";
import perspectiveListScript from "../../scripts/jxa/perspective_list.js";
import projectBatchCompleteScript from "../../scripts/jxa/project_batch_complete.js";
import projectBatchDropScript from "../../scripts/jxa/project_batch_drop.js";
import projectCompleteScript from "../../scripts/jxa/project_complete.js";
import projectCreateScript from "../../scripts/jxa/project_create.js";
import projectDeleteScript from "../../scripts/jxa/project_delete.js";
import projectDropScript from "../../scripts/jxa/project_drop.js";
import projectGetScript from "../../scripts/jxa/project_get.js";
import projectGetManyScript from "../../scripts/jxa/project_get_many.js";
import projectListScript from "../../scripts/jxa/project_list.js";
import projectMarkReviewedScript from "../../scripts/jxa/project_mark_reviewed.js";
import projectMoveScript from "../../scripts/jxa/project_move.js";
import projectSetReviewIntervalScript from "../../scripts/jxa/project_set_review_interval.js";
import projectUpdateScript from "../../scripts/jxa/project_update.js";
import reviewListDueScript from "../../scripts/jxa/review_list_due.js";
import syncTriggerScript from "../../scripts/jxa/sync_trigger.js";
import tagCreateScript from "../../scripts/jxa/tag_create.js";
import tagDeleteScript from "../../scripts/jxa/tag_delete.js";
import tagGetScript from "../../scripts/jxa/tag_get.js";
import tagGetManyScript from "../../scripts/jxa/tag_get_many.js";
import tagListScript from "../../scripts/jxa/tag_list.js";
import tagUpdateScript from "../../scripts/jxa/tag_update.js";
import taskBatchCompleteScript from "../../scripts/jxa/task_batch_complete.js";
import taskBatchCreateScript from "../../scripts/jxa/task_batch_create.js";
import taskBatchDeleteScript from "../../scripts/jxa/task_batch_delete.js";
import taskBatchDropScript from "../../scripts/jxa/task_batch_drop.js";
import taskBatchUncompleteScript from "../../scripts/jxa/task_batch_uncomplete.js";
import taskBatchUndropScript from "../../scripts/jxa/task_batch_undrop.js";
import taskBatchUpdateScript from "../../scripts/jxa/task_batch_update.js";
import taskCompleteScript from "../../scripts/jxa/task_complete.js";
import taskCreateScript from "../../scripts/jxa/task_create.js";
import taskDeleteScript from "../../scripts/jxa/task_delete.js";
import taskDropScript from "../../scripts/jxa/task_drop.js";
import taskDuplicateScript from "../../scripts/jxa/task_duplicate.js";
import taskGetScript from "../../scripts/jxa/task_get.js";
import taskGetManyScript from "../../scripts/jxa/task_get_many.js";
import taskListScript from "../../scripts/jxa/task_list.js";
import taskMoveScript from "../../scripts/jxa/task_move.js";
import taskSearchScript from "../../scripts/jxa/task_search.js";
import taskUncompleteScript from "../../scripts/jxa/task_uncomplete.js";
import taskUndropScript from "../../scripts/jxa/task_undrop.js";
import taskUpdateScript from "../../scripts/jxa/task_update.js";
import type {
  AddAttachmentInput,
  AppLaunchResult,
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  ForecastInput,
  ForecastResult,
  ListAttachmentsInput,
  OmniFocusAdapter,
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
import { type RunScriptOptions, runJxaScript, type ScriptSpawner } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface JxaTransportOptions {
  /** Hard timeout for any single JXA invocation. Defaults to 30s. */
  timeoutMs?: number;
  /** Inject a fake spawner — used by unit tests; production callers omit. */
  spawner?: ScriptSpawner;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class JxaTransport implements OmniFocusAdapter {
  private readonly runOpts: RunScriptOptions;

  constructor(options: JxaTransportOptions = {}) {
    this.runOpts = {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.spawner !== undefined ? { spawner: options.spawner } : {}),
    };
  }

  // -- Tasks (wired) --------------------------------------------------------

  async listTasks(filter: TaskFilter): Promise<Task[]> {
    const result = await runJxaScript<{ tasks: Task[] }>(
      taskListScript,
      {
        projectId: filter.projectId ?? null,
        tagId: filter.tagId ?? null,
        parentId: filter.parentId ?? null,
        flagged: filter.flagged ?? null,
        available: filter.available ?? null,
        blocked: filter.blocked ?? null,
        completed: filter.completed ?? null,
        completedSince: filter.completedSince ?? null,
        dueBefore: filter.dueBefore ?? null,
        dueAfter: filter.dueAfter ?? null,
        deferredBefore: filter.deferredBefore ?? null,
        deferredAfter: filter.deferredAfter ?? null,
      },
      { ...this.runOpts, scriptName: "task_list" },
    );
    return result.tasks.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) }));
  }

  async getTask(id: TaskId): Promise<Task> {
    const result = await runJxaScript<{ task: Task }>(
      taskGetScript,
      { id },
      { ...this.runOpts, scriptName: "task_get" },
    );
    return { ...result.task, id: TaskIdCtor.of(result.task.id) };
  }

  async getTasksMany(ids: TaskId[]): Promise<(Task | null)[]> {
    const result = await runJxaScript<{ tasks: (Task | null)[] }>(
      taskGetManyScript,
      { ids },
      { ...this.runOpts, scriptName: "task_get_many" },
    );
    return result.tasks.map((t) => (t ? { ...t, id: TaskIdCtor.of(t.id) } : null));
  }

  async createTask(input: CreateTaskInput): Promise<TaskId> {
    const result = await runJxaScript<{ task: Task }>(
      taskCreateScript,
      {
        name: input.name,
        projectId: input.projectId ?? null,
        parentId: input.parentId ?? null,
        note: input.note ?? null,
        flagged: input.flagged ?? false,
        deferDate: input.deferDate ?? null,
        dueDate: input.dueDate ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        tagIds: input.tagIds ?? [],
        sequential: input.sequential ?? false,
        completedByChildren: input.completedByChildren ?? false,
      },
      { ...this.runOpts, scriptName: "task_create" },
    );
    return TaskIdCtor.of(result.task.id);
  }

  async updateTask(id: TaskId, patch: UpdateTaskInput): Promise<void> {
    await runJxaScript<{ task: Task }>(
      taskUpdateScript,
      {
        id,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
        ...(patch.deferDate !== undefined ? { deferDate: patch.deferDate } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.estimatedMinutes !== undefined
          ? { estimatedMinutes: patch.estimatedMinutes }
          : {}),
        ...(patch.tagIds !== undefined ? { tagIds: patch.tagIds } : {}),
        ...(patch.sequential !== undefined ? { sequential: patch.sequential } : {}),
        ...(patch.completedByChildren !== undefined
          ? { completedByChildren: patch.completedByChildren }
          : {}),
      },
      { ...this.runOpts, scriptName: "task_update" },
    );
  }

  async completeTask(id: TaskId, at?: Date): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskCompleteScript,
      { id, completionDate: at?.toISOString() ?? null },
      { ...this.runOpts, scriptName: "task_complete" },
    );
  }

  async uncompleteTask(id: TaskId): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskUncompleteScript,
      { id },
      { ...this.runOpts, scriptName: "task_uncomplete" },
    );
  }

  async dropTask(id: TaskId, at?: Date): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskDropScript,
      { id, droppedAt: at?.toISOString() ?? null },
      { ...this.runOpts, scriptName: "task_drop" },
    );
  }

  async undropTask(id: TaskId): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskUndropScript,
      { id },
      { ...this.runOpts, scriptName: "task_undrop" },
    );
  }

  async deleteTask(id: TaskId): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskDeleteScript,
      { id },
      { ...this.runOpts, scriptName: "task_delete" },
    );
  }

  async moveTask(
    id: TaskId,
    destination: { projectId?: ProjectId; parentId?: TaskId },
  ): Promise<void> {
    await runJxaScript<{ id: string }>(
      taskMoveScript,
      {
        id,
        projectId: destination.projectId ?? null,
        parentId: destination.parentId ?? null,
      },
      { ...this.runOpts, scriptName: "task_move" },
    );
  }

  async batchMoveTasks(
    _items: Array<{ id: TaskId; destination: { projectId?: ProjectId; parentId?: TaskId } }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    // batchMoveTasks routes to OmniJsTransport — same reason as moveTask and
    // reorderTask: JXA task.move() throws error 9 ("Replacement not supported") in
    // OmniFocus 4.x. The router sends this method to OmniJS.
    throw new ScriptError("batchMoveTasks routes to OmniJsTransport — JXA transport unavailable", {
      details: { transport: "jxa", reason: "routes-to-omnijs", method: "batchMoveTasks" },
    });
  }

  async reorderTask(_id: TaskId, _position: TaskPosition): Promise<void> {
    // JXA's task.move() with `positioned:` shares the same broken code path
    // as the non-positioned form — both throw error 9 ("Replacement not
    // supported currently") in OmniFocus 4.x. reorderTask routes to
    // OmniJsTransport which uses Database.moveTasks() + ChildInsertionLocation.
    // See docs/spikes/2026-04-task-reorder.md for the full evaluation.
    throw new ScriptError("reorderTask routes to OmniJsTransport — JXA transport unavailable", {
      details: { transport: "jxa", reason: "routes-to-omnijs", method: "reorderTask" },
    });
  }

  async duplicateTask(
    id: TaskId,
    opts: {
      recursive: boolean;
      destination?: { projectId: ProjectId } | { parentId: TaskId } | { toInbox: true };
    },
  ): Promise<{ newId: TaskId; descendantCount: number }> {
    const destination =
      opts.destination === undefined
        ? undefined
        : "projectId" in opts.destination
          ? { projectId: opts.destination.projectId }
          : "parentId" in opts.destination
            ? { parentId: opts.destination.parentId }
            : { toInbox: true as const };
    const result = await runJxaScript<TaskDuplicateScriptResult>(
      taskDuplicateScript,
      { id, recursive: opts.recursive, destination },
      { ...this.runOpts, scriptName: "task_duplicate" },
    );
    return { newId: TaskIdCtor.of(result.newId), descendantCount: result.descendantCount };
  }

  async batchCreateTasks(
    inputs: CreateTaskInput[],
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchCreateScript,
      {
        inputs: inputs.map((i) => ({
          name: i.name,
          projectId: i.projectId ?? null,
          parentId: i.parentId ?? null,
          note: i.note ?? null,
          flagged: i.flagged ?? false,
          deferDate: i.deferDate ?? null,
          dueDate: i.dueDate ?? null,
          estimatedMinutes: i.estimatedMinutes ?? null,
          tagIds: i.tagIds ?? [],
          sequential: i.sequential ?? false,
          completedByChildren: i.completedByChildren ?? false,
        })),
      },
      { ...this.runOpts, scriptName: "task_batch_create" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchUpdateTasks(
    updates: Array<{ id: TaskId; patch: UpdateTaskInput }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchUpdateScript,
      { updates },
      { ...this.runOpts, scriptName: "task_batch_update" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchCompleteTasks(
    items: Array<{ id: TaskId; at?: Date }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchCompleteScript,
      { items: items.map((it) => ({ id: it.id, at: it.at?.toISOString() ?? null })) },
      { ...this.runOpts, scriptName: "task_batch_complete" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchUncompleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchUncompleteScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "task_batch_uncomplete" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchDeleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchDeleteScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "task_batch_delete" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchDropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchDropScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "task_batch_drop" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  async batchUndropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      taskBatchUndropScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "task_batch_undrop" },
    );
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }

  // -- Projects (wired) -----------------------------------------------------

  async listProjects(filter?: {
    folderId?: FolderId;
    status?: Project["status"];
  }): Promise<Project[]> {
    const result = await runJxaScript<{ projects: Project[] }>(
      projectListScript,
      { folderId: filter?.folderId ?? null, status: filter?.status ?? null },
      { ...this.runOpts, scriptName: "project_list" },
    );
    return result.projects.map((p) => ({ ...p, id: ProjectIdCtor.of(p.id) }));
  }

  async getProject(id: ProjectId): Promise<Project> {
    const result = await runJxaScript<{ project: Project }>(
      projectGetScript,
      { id },
      { ...this.runOpts, scriptName: "project_get" },
    );
    return { ...result.project, id: ProjectIdCtor.of(result.project.id) };
  }

  async getProjectsMany(ids: ProjectId[]): Promise<(Project | null)[]> {
    const result = await runJxaScript<{ projects: (Project | null)[] }>(
      projectGetManyScript,
      { ids },
      { ...this.runOpts, scriptName: "project_get_many" },
    );
    return result.projects.map((p) => (p ? { ...p, id: ProjectIdCtor.of(p.id) } : null));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectId> {
    const result = await runJxaScript<{ project: Project }>(
      projectCreateScript,
      {
        name: input.name,
        folderId: input.folderId ?? null,
        note: input.note ?? null,
        deferDate: input.deferDate ?? null,
        dueDate: input.dueDate ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        flagged: input.flagged ?? false,
        status: input.status ?? null,
      },
      { ...this.runOpts, scriptName: "project_create" },
    );
    return ProjectIdCtor.of(result.project.id);
  }

  async updateProject(id: ProjectId, patch: UpdateProjectInput): Promise<void> {
    await runJxaScript<{ project: Project }>(
      projectUpdateScript,
      {
        id,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
        ...(patch.estimatedMinutes !== undefined
          ? { estimatedMinutes: patch.estimatedMinutes }
          : {}),
        ...(patch.deferDate !== undefined ? { deferDate: patch.deferDate } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
      { ...this.runOpts, scriptName: "project_update" },
    );
  }

  async completeProject(id: ProjectId, at?: Date): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectCompleteScript,
      { id, completionDate: at?.toISOString() ?? null },
      { ...this.runOpts, scriptName: "project_complete" },
    );
  }

  async dropProject(id: ProjectId): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectDropScript,
      { id },
      { ...this.runOpts, scriptName: "project_drop" },
    );
  }

  async batchCompleteProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      projectBatchCompleteScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "project_batch_complete" },
    );
    return mapBatchScriptResult(raw, ProjectIdCtor.of);
  }

  async batchDropProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    const raw = await runJxaScript<RawBatchScriptResult>(
      projectBatchDropScript,
      { items: items.map((it) => ({ id: it.id })) },
      { ...this.runOpts, scriptName: "project_batch_drop" },
    );
    return mapBatchScriptResult(raw, ProjectIdCtor.of);
  }

  async moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectMoveScript,
      { id, folderId: destination.folderId ?? null },
      { ...this.runOpts, scriptName: "project_move" },
    );
  }

  async deleteProject(id: ProjectId): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectDeleteScript,
      { id },
      { ...this.runOpts, scriptName: "project_delete" },
    );
  }

  async markProjectReviewed(id: ProjectId): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectMarkReviewedScript,
      { id },
      { ...this.runOpts, scriptName: "project_mark_reviewed" },
    );
  }

  async listProjectsDueForReview(): Promise<Project[]> {
    const result = await runJxaScript<{ projects: Project[] }>(
      reviewListDueScript,
      {},
      { ...this.runOpts, scriptName: "review_list_due" },
    );
    return result.projects;
  }

  async setProjectReviewInterval(id: ProjectId, days: number | null): Promise<void> {
    await runJxaScript<{ id: string }>(
      projectSetReviewIntervalScript,
      { id, days },
      { ...this.runOpts, scriptName: "project_set_review_interval" },
    );
  }

  // -- Tags (wired) ---------------------------------------------------------

  async listTags(filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]> {
    const result = await runJxaScript<{ tags: Tag[] }>(
      tagListScript,
      {
        parentId: filter?.parentId ?? null,
        status: filter?.status ?? null,
      },
      { ...this.runOpts, scriptName: "tag_list" },
    );
    return result.tags.map((t) => ({ ...t, id: TagIdCtor.of(t.id) }));
  }

  async getTag(id: TagId): Promise<Tag> {
    const result = await runJxaScript<{ tag: Tag }>(
      tagGetScript,
      { id },
      { ...this.runOpts, scriptName: "tag_get" },
    );
    return { ...result.tag, id: TagIdCtor.of(result.tag.id) };
  }

  async getTagsMany(ids: TagId[]): Promise<(Tag | null)[]> {
    const result = await runJxaScript<{ tags: (Tag | null)[] }>(
      tagGetManyScript,
      { ids },
      { ...this.runOpts, scriptName: "tag_get_many" },
    );
    return result.tags.map((t) => (t ? { ...t, id: TagIdCtor.of(t.id) } : null));
  }

  async createTag(input: CreateTagInput): Promise<TagId> {
    const result = await runJxaScript<{ tag: Tag }>(
      tagCreateScript,
      { name: input.name, parentId: input.parentId ?? null },
      { ...this.runOpts, scriptName: "tag_create" },
    );
    return TagIdCtor.of(result.tag.id);
  }

  async updateTag(id: TagId, patch: UpdateTagInput): Promise<void> {
    await runJxaScript<{ tag: Tag }>(
      tagUpdateScript,
      {
        id,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.allowsNextAction !== undefined
          ? { allowsNextAction: patch.allowsNextAction }
          : {}),
      },
      { ...this.runOpts, scriptName: "tag_update" },
    );
  }

  async deleteTag(id: TagId): Promise<void> {
    await runJxaScript<{ id: string }>(
      tagDeleteScript,
      { id },
      { ...this.runOpts, scriptName: "tag_delete" },
    );
  }

  // -- Folders (wired) ------------------------------------------------------

  async listFolders(filter?: { parentId?: FolderId }): Promise<Folder[]> {
    const result = await runJxaScript<{ folders: Folder[] }>(
      folderListScript,
      { parentId: filter?.parentId ?? null },
      { ...this.runOpts, scriptName: "folder_list" },
    );
    return result.folders.map((f) => ({ ...f, id: FolderIdCtor.of(f.id) }));
  }

  async getFolder(id: FolderId): Promise<Folder> {
    const result = await runJxaScript<{ folder: Folder }>(
      folderGetScript,
      { id },
      { ...this.runOpts, scriptName: "folder_get" },
    );
    return { ...result.folder, id: FolderIdCtor.of(result.folder.id) };
  }

  async createFolder(input: CreateFolderInput): Promise<FolderId> {
    const result = await runJxaScript<{ folder: Folder }>(
      folderCreateScript,
      { name: input.name, parentId: input.parentId ?? null },
      { ...this.runOpts, scriptName: "folder_create" },
    );
    return FolderIdCtor.of(result.folder.id);
  }

  async updateFolder(id: FolderId, patch: UpdateFolderInput): Promise<void> {
    await runJxaScript<{ folder: Folder }>(
      folderUpdateScript,
      { id, ...(patch.name !== undefined ? { name: patch.name } : {}) },
      { ...this.runOpts, scriptName: "folder_update" },
    );
  }

  async deleteFolder(id: FolderId): Promise<void> {
    await runJxaScript<{ id: string }>(
      folderDeleteScript,
      { id },
      { ...this.runOpts, scriptName: "folder_delete" },
    );
  }

  // -- Perspectives (wired) -------------------------------------------------

  async listPerspectives(): Promise<Perspective[]> {
    const result = await runJxaScript<{ perspectives: Perspective[] }>(
      perspectiveListScript,
      {},
      { ...this.runOpts, scriptName: "perspective_list" },
    );
    return result.perspectives;
  }

  async evaluatePerspective(id: BuiltinPerspectiveId): Promise<Task[]> {
    const result = await runJxaScript<{ tasks: Task[] }>(
      perspectiveEvaluateScript,
      { perspectiveId: id },
      { ...this.runOpts, scriptName: "perspective_evaluate" },
    );
    return result.tasks.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) }));
  }

  async evaluateCustomPerspective(_identifier: string): Promise<Task[]> {
    throw new ScriptError("evaluateCustomPerspective requires the OmniJS transport", {
      details: {
        transport: "jxa",
        reason: "omnijs-only",
        method: "evaluateCustomPerspective",
      },
    });
  }

  // -- Search ---------------------------------------------------------------

  async searchTasks(filter: SearchFilter): Promise<Task[]> {
    const result = await runJxaScript<{ tasks: Task[] }>(
      taskSearchScript,
      {
        q: filter.q ?? null,
        scope: filter.scope ?? "all",
        projectId: filter.projectId ?? null,
        tagIds: filter.tagIds ?? null,
        available: filter.available ?? null,
        dueBefore: filter.dueBefore ?? null,
        dueAfter: filter.dueAfter ?? null,
        flagged: filter.flagged ?? null,
        completed: filter.completed ?? "exclude",
      },
      { ...this.runOpts, scriptName: "task_search" },
    );
    return result.tasks.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) }));
  }

  async getForecast(input: ForecastInput): Promise<ForecastResult> {
    const result = await runJxaScript<ForecastResult>(
      forecastGetScript,
      {
        from: input.from,
        to: input.to,
        includeOverdue: input.includeOverdue ?? true,
        includeDeferred: input.includeDeferred ?? true,
        includeFlagged: input.includeFlagged ?? true,
      },
      { ...this.runOpts, scriptName: "forecast_get" },
    );
    return {
      overdue: result.overdue.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) })),
      dueToday: result.dueToday.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) })),
      deferredToday: result.deferredToday.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) })),
      flagged: result.flagged.map((t) => ({ ...t, id: TaskIdCtor.of(t.id) })),
    };
  }

  // The forecast-tag preference (`Database.forecastTag` in OmniJS) is not
  // exposed by JXA cleanly; routed to OmniJsTransport via TransportRouter.
  async getForecastTag(): Promise<{ tagId: import("../../domain/ids.js").TagId | null }> {
    throw new ScriptError("getForecastTag routes to OmniJsTransport — JXA transport unavailable", {
      details: { transport: "jxa", reason: "routes-to-omnijs", method: "getForecastTag" },
    });
  }
  async setForecastTag(
    _tagId: import("../../domain/ids.js").TagId | null,
  ): Promise<{ tagId: import("../../domain/ids.js").TagId | null }> {
    throw new ScriptError("setForecastTag routes to OmniJsTransport — JXA transport unavailable", {
      details: { transport: "jxa", reason: "routes-to-omnijs", method: "setForecastTag" },
    });
  }

  // -- Attachments (wired) --------------------------------------------------

  async listAttachments(input: ListAttachmentsInput): Promise<Attachment[]> {
    const result = await runJxaScript<{ attachments: Attachment[] }>(attachmentListScript, input, {
      ...this.runOpts,
      scriptName: "attachment_list",
    });
    return result.attachments;
  }

  async addAttachment(input: AddAttachmentInput): Promise<AttachmentId> {
    const result = await runJxaScript<{ id: string }>(attachmentAddScript, input, {
      ...this.runOpts,
      scriptName: "attachment_add",
    });
    return AttachmentId.of(result.id);
  }

  async removeAttachment(input: RemoveAttachmentInput): Promise<void> {
    await runJxaScript<Record<string, never>>(attachmentRemoveScript, input, {
      ...this.runOpts,
      scriptName: "attachment_remove",
    });
  }

  async saveAttachmentToPath(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
    return runJxaScript<SaveAttachmentResult>(attachmentSaveToPathScript, input, {
      ...this.runOpts,
      scriptName: "attachment_save_to_path",
    });
  }

  // -- App lifecycle (wired) ------------------------------------------------

  async appLaunch(): Promise<AppLaunchResult> {
    return runJxaScript<AppLaunchResult>(
      appLaunchScript,
      {},
      {
        ...this.runOpts,
        scriptName: "app_launch",
      },
    );
  }

  // -- Plug-in invocation ---------------------------------------------------
  // Plug-in invocation requires the OmniJS runtime; JXA has no API surface
  // for Omni Automation plug-ins. TransportRouter permanently routes
  // pluginInvoke → OmniJsTransport (router.ts ROUTING_TABLE). This stub
  // satisfies the OmniFocusAdapter interface but should never be reached in
  // production. It throws a ScriptError (not notYetWired) so accidental
  // calls are clearly diagnosed rather than silently discarded.

  async pluginInvoke(
    _input: import("../OmniFocusAdapter.js").PluginInvokeInput,
  ): Promise<import("../OmniFocusAdapter.js").PluginInvokeResult> {
    throw new ScriptError(
      "pluginInvoke is handled by OmniJsTransport; JxaTransport is not in the routing path for this method",
      { details: { transport: "jxa", reason: "routed-to-omnijs" } },
    );
  }

  // -- Sync (wired) ---------------------------------------------------------

  async syncTrigger(): Promise<SyncStatus> {
    const result = await runJxaScript<{ lastSyncAt: string | null; inFlight: boolean }>(
      syncTriggerScript,
      {},
      { ...this.runOpts, scriptName: "sync_trigger" },
    );
    return result;
  }

  async getLastSync(): Promise<SyncStatus> {
    // `getLastSync` is a pure read with no JXA equivalent — OmniFocus does
    // not expose a "last sync timestamp" property on the document. The real
    // implementation will surface this from a process-local cache populated
    // by `syncTrigger`. The lifecycle layer (#25) owns that cache; until
    // it lands, signal "unknown" rather than a misleading timestamp.
    return { lastSyncAt: null, inFlight: false };
  }

  // -- Change detection ------------------------------------------------------

  async getChangesSince(sinceIso: string): Promise<{ taskIds: string[]; projectIds: string[] }> {
    const result = await runJxaScript<ChangesSinceScriptResult>(
      changesSinceScript,
      { sinceIso },
      { ...this.runOpts, scriptName: "changes_since" },
    );
    return {
      taskIds: result.tasks.map((t) => t.id),
      projectIds: result.projects.map((p) => p.id),
    };
  }

  // -- Raw escape hatch (off by default; gated by env at the tool layer) ----

  async runJxaScript(script: string, arg?: unknown): Promise<unknown> {
    return runJxaScript(script, arg ?? {}, { ...this.runOpts, scriptName: "raw" });
  }
}
