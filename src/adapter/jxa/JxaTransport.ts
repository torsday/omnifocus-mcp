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
 * **Status (M0 keystone):** This file ships the transport scaffolding plus
 * one wired method (`syncTrigger`) as proof. Per-domain scripts (tasks,
 * projects, tags, folders, forecast, search, notes, repetition,
 * attachments, review) land via follow-up issues so each can carry its
 * own JXA script + tests + smoke without piling into a single mega-PR.
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
import type { FolderId, ProjectId, TagId, TaskId } from "../../domain/ids.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { ScriptError } from "../../errors/index.js";
import syncTriggerScript from "../../scripts/jxa/sync_trigger.js";
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

  // -- Projects -------------------------------------------------------------

  async listProjects(_filter?: { folderId?: FolderId; status?: Project["status"] }): Promise<
    Project[]
  > {
    return notYetWired("listProjects");
  }
  async getProject(_id: ProjectId): Promise<Project> {
    return notYetWired("getProject");
  }
  async createProject(_input: CreateProjectInput): Promise<ProjectId> {
    return notYetWired("createProject");
  }
  async updateProject(_id: ProjectId, _patch: UpdateProjectInput): Promise<void> {
    return notYetWired("updateProject");
  }
  async completeProject(_id: ProjectId, _at?: Date): Promise<void> {
    return notYetWired("completeProject");
  }
  async dropProject(_id: ProjectId, _at?: Date): Promise<void> {
    return notYetWired("dropProject");
  }
  async moveProject(_id: ProjectId, _destination: { folderId: FolderId | null }): Promise<void> {
    return notYetWired("moveProject");
  }
  async deleteProject(_id: ProjectId): Promise<void> {
    return notYetWired("deleteProject");
  }
  async markProjectReviewed(_id: ProjectId): Promise<void> {
    return notYetWired("markProjectReviewed");
  }

  // -- Tags -----------------------------------------------------------------

  async listTags(_filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]> {
    return notYetWired("listTags");
  }
  async getTag(_id: TagId): Promise<Tag> {
    return notYetWired("getTag");
  }
  async createTag(_input: CreateTagInput): Promise<TagId> {
    return notYetWired("createTag");
  }
  async updateTag(_id: TagId, _patch: UpdateTagInput): Promise<void> {
    return notYetWired("updateTag");
  }
  async deleteTag(_id: TagId): Promise<void> {
    return notYetWired("deleteTag");
  }

  // -- Folders --------------------------------------------------------------

  async listFolders(_filter?: { parentId?: FolderId }): Promise<Folder[]> {
    return notYetWired("listFolders");
  }
  async getFolder(_id: FolderId): Promise<Folder> {
    return notYetWired("getFolder");
  }
  async createFolder(_input: CreateFolderInput): Promise<FolderId> {
    return notYetWired("createFolder");
  }
  async updateFolder(_id: FolderId, _patch: UpdateFolderInput): Promise<void> {
    return notYetWired("updateFolder");
  }
  async deleteFolder(_id: FolderId): Promise<void> {
    return notYetWired("deleteFolder");
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
