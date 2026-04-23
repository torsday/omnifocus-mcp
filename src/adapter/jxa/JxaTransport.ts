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

import type { Folder } from "../../domain/folder.js";
import {
  type FolderId,
  FolderId as FolderIdCtor,
  type ProjectId,
  ProjectId as ProjectIdCtor,
  type TagId,
  TagId as TagIdCtor,
  type TaskId,
} from "../../domain/ids.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { ScriptError } from "../../errors/index.js";
import folderCreateScript from "../../scripts/jxa/folder_create.js";
import folderDeleteScript from "../../scripts/jxa/folder_delete.js";
import folderGetScript from "../../scripts/jxa/folder_get.js";
import folderListScript from "../../scripts/jxa/folder_list.js";
import folderUpdateScript from "../../scripts/jxa/folder_update.js";
import projectCompleteScript from "../../scripts/jxa/project_complete.js";
import projectCreateScript from "../../scripts/jxa/project_create.js";
import projectDeleteScript from "../../scripts/jxa/project_delete.js";
import projectDropScript from "../../scripts/jxa/project_drop.js";
import projectGetScript from "../../scripts/jxa/project_get.js";
import projectListScript from "../../scripts/jxa/project_list.js";
import projectMarkReviewedScript from "../../scripts/jxa/project_mark_reviewed.js";
import projectMoveScript from "../../scripts/jxa/project_move.js";
import projectUpdateScript from "../../scripts/jxa/project_update.js";
import syncTriggerScript from "../../scripts/jxa/sync_trigger.js";
import tagCreateScript from "../../scripts/jxa/tag_create.js";
import tagDeleteScript from "../../scripts/jxa/tag_delete.js";
import tagGetScript from "../../scripts/jxa/tag_get.js";
import tagListScript from "../../scripts/jxa/tag_list.js";
import tagUpdateScript from "../../scripts/jxa/tag_update.js";
import type {
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  OmniFocusAdapter,
  SyncStatus,
  TaskFilter,
  UpdateFolderInput,
  UpdateProjectInput,
  UpdateTagInput,
  UpdateTaskInput,
} from "../OmniFocusAdapter.js";
import { type RunScriptOptions, type ScriptSpawner, runJxaScript } from "./scriptRunner.js";

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

/**
 * Sentinel thrown by every method whose underlying JXA script hasn't been
 * wired yet. The `details.reason` value is part of the deliberately-narrow
 * contract that `TransportRouter` (#19) and unit tests inspect to decide
 * whether to route to `OmniJsTransport` instead.
 */
function notYetWired(method: string): never {
  throw new ScriptError(`JxaTransport.${method} is not wired yet`, {
    details: { transport: "jxa", reason: "not-yet-wired", method },
  });
}

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

  // -- Tasks ----------------------------------------------------------------

  async listTasks(_filter: TaskFilter): Promise<Task[]> {
    return notYetWired("listTasks");
  }
  async getTask(_id: TaskId): Promise<Task> {
    return notYetWired("getTask");
  }
  async getTasksMany(_ids: TaskId[]): Promise<(Task | null)[]> {
    return notYetWired("getTasksMany");
  }
  async createTask(_input: CreateTaskInput): Promise<TaskId> {
    return notYetWired("createTask");
  }
  async updateTask(_id: TaskId, _patch: UpdateTaskInput): Promise<void> {
    return notYetWired("updateTask");
  }
  async completeTask(_id: TaskId, _at?: Date): Promise<void> {
    return notYetWired("completeTask");
  }
  async uncompleteTask(_id: TaskId): Promise<void> {
    return notYetWired("uncompleteTask");
  }
  async dropTask(_id: TaskId, _at?: Date): Promise<void> {
    return notYetWired("dropTask");
  }
  async undropTask(_id: TaskId): Promise<void> {
    return notYetWired("undropTask");
  }
  async deleteTask(_id: TaskId): Promise<void> {
    return notYetWired("deleteTask");
  }
  async moveTask(
    _id: TaskId,
    _destination: { projectId?: ProjectId; parentId?: TaskId },
  ): Promise<void> {
    return notYetWired("moveTask");
  }

  // -- Projects (wired) -----------------------------------------------------

  async listProjects(filter?: { folderId?: FolderId; status?: Project["status"] }): Promise<
    Project[]
  > {
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

  // -- Search ---------------------------------------------------------------

  async searchTasks(
    _filter: import("../OmniFocusAdapter.js").SearchFilter,
  ): Promise<import("../../domain/task.js").Task[]> {
    return notYetWired("searchTasks");
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

  // -- Raw escape hatch (off by default; gated by env at the tool layer) ----

  async runJxaScript(script: string): Promise<unknown> {
    return runJxaScript(script, {}, { ...this.runOpts, scriptName: "raw" });
  }
}
