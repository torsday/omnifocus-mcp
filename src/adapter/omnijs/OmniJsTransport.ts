/**
 * `OmniJsTransport` — fallback `OmniFocusAdapter` implementation for surfaces
 * JXA cannot reach (custom perspectives, Omni Automation plug-ins, anything
 * the Omni Automation API exposes exclusively).
 *
 * Per ADR-0002 (and the spike at `docs/spikes/2026-04-omnijs-spike.md` that
 * superseded the original URL-scheme transport), OmniJS is invoked via the
 * JXA bridge: `Application("OmniFocus").evaluateJavascript(...)`. The
 * underlying spawner is a sibling of `JxaTransport`'s — same UTF-8 handling,
 * same timeout discipline, same typed-error mapping — but with a longer
 * default timeout (45s, `OMNIFOCUS_OMNIJS_TIMEOUT_MS`) because Omni
 * Automation work tends to be heavier than direct JXA reads.
 *
 * **Status (M0 keystone):** This file ships the transport scaffolding plus
 * the raw `runOmniJsScript` escape hatch as the wired proof. Per-domain
 * methods (custom perspectives in #55, plugin invocation in #74) land via
 * follow-up issues so each can carry its own OmniJS script + tests + smoke
 * without piling into a single mega-PR. Stubbed methods throw `ScriptError`
 * with `details.reason: "not-yet-wired"` so `TransportRouter` (#19) can
 * route around them and tests can detect the partial-implementation state
 * precisely.
 *
 * @see DESIGN.md §6.1, §6.3, §6.4 — adapter seam, layering, script discipline
 * @see ADR-0002 — JXA + OmniJS dual transport
 * @see ADR-0005 — scripts as first-class files
 * @see docs/spikes/2026-04-omnijs-spike.md — `evaluateJavascript` adoption
 * @see src/adapter/omnijs/scriptRunner.ts
 */

import type { Folder } from "../../domain/folder.js";
import type { FolderId, ProjectId, TagId, TaskId } from "../../domain/ids.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { ScriptError } from "../../errors/index.js";
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
import { type RunScriptOptions, type ScriptSpawner, runOmniJsScript } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface OmniJsTransportOptions {
  /** Hard timeout for any single OmniJS invocation. Defaults to 45s. */
  timeoutMs?: number;
  /** Inject a fake spawner — used by unit tests; production callers omit. */
  spawner?: ScriptSpawner;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel thrown by every method whose underlying OmniJS script hasn't been
 * wired yet. The `details.reason` value is part of the deliberately-narrow
 * contract that `TransportRouter` (#19) and unit tests inspect to decide
 * whether to route to `JxaTransport` instead.
 */
function notYetWired(method: string): never {
  throw new ScriptError(`OmniJsTransport.${method} is not wired yet`, {
    details: { transport: "omnijs", reason: "not-yet-wired", method },
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class OmniJsTransport implements OmniFocusAdapter {
  private readonly runOpts: RunScriptOptions;

  constructor(options: OmniJsTransportOptions = {}) {
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
  async listProjectsDueForReview(): Promise<import("../../domain/project.js").Project[]> {
    return notYetWired("listProjectsDueForReview");
  }
  async setProjectReviewInterval(
    _id: import("../../domain/ids.js").ProjectId,
    _days: number | null,
  ): Promise<void> {
    return notYetWired("setProjectReviewInterval");
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

  // -- Perspectives ---------------------------------------------------------

  // Perspectives are read via JXA; OmniJsTransport satisfies the interface only.
  async listPerspectives(): Promise<import("../../domain/perspective.js").Perspective[]> {
    return notYetWired("listPerspectives");
  }

  async evaluatePerspective(
    _id: import("../../domain/perspective.js").BuiltinPerspectiveId,
  ): Promise<import("../../domain/task.js").Task[]> {
    return notYetWired("evaluatePerspective");
  }

  // -- Sync -----------------------------------------------------------------

  // Sync is a document-level operation exposed by JXA, not OmniJS. The
  // primary transport for these methods is `JxaTransport`; `OmniJsTransport`
  // exposes them only to satisfy the interface — `TransportRouter` (#19)
  // will never route here.
  async syncTrigger(): Promise<SyncStatus> {
    return notYetWired("syncTrigger");
  }
  async getLastSync(): Promise<SyncStatus> {
    return notYetWired("getLastSync");
  }

  // -- Raw escape hatch (off by default; gated by env at the tool layer) ----

  async runOmniJsScript(script: string): Promise<unknown> {
    return runOmniJsScript(script, {}, { ...this.runOpts, scriptName: "raw" });
  }
}
