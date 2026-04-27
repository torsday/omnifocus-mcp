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
import { TagId as TagIdCtor, TaskId as TaskIdCtor } from "../../domain/ids.js";
import type { Project } from "../../domain/project.js";
import type { Tag } from "../../domain/tag.js";
import type { Task } from "../../domain/task.js";
import { FeatureRequiresPro, NotFound, ScriptError, ValidationError } from "../../errors/index.js";
import {
  isScriptError,
  mapBatchScriptResult,
  type PerspectiveEvaluateScriptResult,
  type TaskBatchMoveScriptResult,
  type TaskMoveScriptResult,
} from "../../scripts/contracts.js";
import databaseRedoScript from "../../scripts/omnijs/database_redo.js";
import databaseUndoScript from "../../scripts/omnijs/database_undo.js";
import forecastGetTagScript from "../../scripts/omnijs/forecast_get_tag.js";
import forecastSetTagScript from "../../scripts/omnijs/forecast_set_tag.js";
import perspectiveEvaluateScript from "../../scripts/omnijs/perspective_evaluate.js";
import pluginInvokeScript from "../../scripts/omnijs/plugin_invoke.js";
import taskBatchMoveScript from "../../scripts/omnijs/task_batch_move.js";
import taskMoveScript from "../../scripts/omnijs/task_move.js";
import taskReorderScript from "../../scripts/omnijs/task_reorder.js";
import type {
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  OmniFocusAdapter,
  PluginInvokeInput,
  PluginInvokeResult,
  SyncStatus,
  TaskFilter,
  TaskPosition,
  UpdateFolderInput,
  UpdateProjectInput,
  UpdateTagInput,
  UpdateTaskInput,
} from "../OmniFocusAdapter.js";
import { type RunScriptOptions, runOmniJsScript, type ScriptSpawner } from "./scriptRunner.js";

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
    id: TaskId,
    destination: { projectId?: ProjectId; parentId?: TaskId },
  ): Promise<void> {
    // JXA's task.move() fails with error 9 ("Replacement not supported") in
    // OmniFocus 4.x. Database.moveTasks() in OmniJS performs genuine reparenting
    // while preserving the task's persistent ID — hence this routes to OmniJS.
    const script = taskMoveScript;
    const result = await runOmniJsScript<TaskMoveScriptResult>(
      script,
      {
        id,
        projectId: destination.projectId ?? null,
        parentId: destination.parentId ?? null,
      },
      { ...this.runOpts, scriptName: "task_move" },
    );
    if (isScriptError(result)) {
      if (result.error.code === "NOT_FOUND") {
        throw new NotFound(result.error.message, {
          details: { transport: "omnijs", scriptName: "task_move" },
        });
      }
      throw new ValidationError(result.error.message, {
        details: { transport: "omnijs", scriptName: "task_move" },
      });
    }
  }
  async batchMoveTasks(
    items: Array<{ id: TaskId; destination: { projectId?: ProjectId; parentId?: TaskId } }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    const script = taskBatchMoveScript;
    const raw = await runOmniJsScript<TaskBatchMoveScriptResult>(
      script,
      {
        items: items.map((it) => ({
          id: it.id,
          projectId: it.destination.projectId ?? null,
          parentId: it.destination.parentId ?? null,
        })),
      },
      { ...this.runOpts, scriptName: "task_batch_move" },
    );
    if (isScriptError(raw)) {
      throw new ValidationError(raw.error.message, {
        details: { transport: "omnijs", scriptName: "task_batch_move" },
      });
    }
    return mapBatchScriptResult(raw, TaskIdCtor.of);
  }
  async reorderTask(id: TaskId, position: TaskPosition): Promise<void> {
    const script = taskReorderScript;

    let payload: {
      id: TaskId;
      mode: "before" | "after" | "start" | "end";
      refId?: TaskId;
      container?: {
        projectId?: ProjectId;
        parentId?: TaskId;
        inbox?: true;
      };
    };
    if ("before" in position) {
      payload = { id, mode: "before", refId: position.before };
    } else if ("after" in position) {
      payload = { id, mode: "after", refId: position.after };
    } else {
      const container =
        "projectId" in position.in
          ? { projectId: position.in.projectId }
          : "parentId" in position.in
            ? { parentId: position.in.parentId }
            : { inbox: true as const };
      payload = { id, mode: position.at, container };
    }

    const result = await runOmniJsScript<TaskMoveScriptResult>(script, payload, {
      ...this.runOpts,
      scriptName: "task_reorder",
    });

    if (isScriptError(result)) {
      if (result.error.code === "NOT_FOUND") {
        throw new NotFound(result.error.message, {
          details: { transport: "omnijs", scriptName: "task_reorder" },
        });
      }
      throw new ValidationError(result.error.message, {
        details: { transport: "omnijs", scriptName: "task_reorder" },
      });
    }
  }
  async duplicateTask(
    _id: TaskId,
    _opts: {
      recursive: boolean;
      destination?: { projectId: ProjectId } | { parentId: TaskId } | { toInbox: true };
    },
  ): Promise<{ newId: TaskId; descendantCount: number }> {
    return notYetWired("duplicateTask");
  }
  async batchCreateTasks(
    _inputs: CreateTaskInput[],
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchCreateTasks");
  }
  async batchUpdateTasks(
    _updates: Array<{ id: TaskId; patch: UpdateTaskInput }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchUpdateTasks");
  }
  async batchCompleteTasks(
    _items: Array<{ id: TaskId; at?: Date }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchCompleteTasks");
  }
  async batchUncompleteTasks(
    _items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchUncompleteTasks");
  }
  async batchDeleteTasks(
    _items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchDeleteTasks");
  }
  async batchDropTasks(
    _items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchDropTasks");
  }

  async batchUndropTasks(
    _items: Array<{ id: TaskId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<TaskId>> {
    return notYetWired("batchUndropTasks");
  }

  // -- Projects -------------------------------------------------------------

  async listProjects(_filter?: {
    folderId?: FolderId;
    status?: Project["status"];
  }): Promise<Project[]> {
    return notYetWired("listProjects");
  }
  async getProject(_id: ProjectId): Promise<Project> {
    return notYetWired("getProject");
  }
  async getProjectsMany(_ids: ProjectId[]): Promise<(Project | null)[]> {
    return notYetWired("getProjectsMany");
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
  async batchCompleteProjects(
    _items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    return notYetWired("batchCompleteProjects");
  }
  async batchDropProjects(
    _items: Array<{ id: ProjectId }>,
  ): Promise<import("../../domain/batch.js").BatchOutcome<ProjectId>> {
    return notYetWired("batchDropProjects");
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
  async setProjectNextReviewDate(
    _id: import("../../domain/ids.js").ProjectId,
    _nextReviewDate: string | null,
  ): Promise<void> {
    return notYetWired("setProjectNextReviewDate");
  }

  // -- Tags -----------------------------------------------------------------

  async listTags(_filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]> {
    return notYetWired("listTags");
  }
  async getTag(_id: TagId): Promise<Tag> {
    return notYetWired("getTag");
  }
  async getTagsMany(_ids: TagId[]): Promise<(Tag | null)[]> {
    return notYetWired("getTagsMany");
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

  async getForecast(
    _input: import("../OmniFocusAdapter.js").ForecastInput,
  ): Promise<import("../OmniFocusAdapter.js").ForecastResult> {
    return notYetWired("getForecast");
  }

  async getForecastTag(): Promise<{ tagId: TagId | null }> {
    const script = forecastGetTagScript;
    const result = await runOmniJsScript<
      { tagId: string | null } | { error: { code: string; message: string } }
    >(script, {}, { ...this.runOpts, scriptName: "forecast_get_tag" });
    if (isScriptError(result)) {
      throw new ScriptError(result.error.message, {
        details: { transport: "omnijs", scriptName: "forecast_get_tag" },
      });
    }
    return {
      tagId: result.tagId === null ? null : TagIdCtor.of(result.tagId),
    };
  }

  async setForecastTag(tagId: TagId | null): Promise<{ tagId: TagId | null }> {
    const script = forecastSetTagScript;
    const result = await runOmniJsScript<
      { tagId: string | null } | { error: { code: string; message: string } }
    >(script, { tagId }, { ...this.runOpts, scriptName: "forecast_set_tag" });
    if (isScriptError(result)) {
      if (result.error.code === "NOT_FOUND") {
        throw new NotFound(result.error.message, {
          details: { transport: "omnijs", scriptName: "forecast_set_tag" },
        });
      }
      throw new ValidationError(result.error.message, {
        details: { transport: "omnijs", scriptName: "forecast_set_tag" },
      });
    }
    return {
      tagId: result.tagId === null ? null : TagIdCtor.of(result.tagId),
    };
  }

  // -- Database undo/redo ---------------------------------------------------
  // Wrap Database.undo() / Database.redo() — OmniJS-only APIs.
  async undoLastMutation(): Promise<{ undid: boolean }> {
    const result = await runOmniJsScript<
      { undid: boolean } | { error: { code: string; message: string } }
    >(databaseUndoScript, {}, { ...this.runOpts, scriptName: "database_undo" });
    if (isScriptError(result)) {
      throw new ScriptError(result.error.message, {
        details: { transport: "omnijs", scriptName: "database_undo", code: result.error.code },
      });
    }
    return { undid: result.undid };
  }

  async redoLastMutation(): Promise<{ redid: boolean }> {
    const result = await runOmniJsScript<
      { redid: boolean } | { error: { code: string; message: string } }
    >(databaseRedoScript, {}, { ...this.runOpts, scriptName: "database_redo" });
    if (isScriptError(result)) {
      throw new ScriptError(result.error.message, {
        details: { transport: "omnijs", scriptName: "database_redo", code: result.error.code },
      });
    }
    return { redid: result.redid };
  }

  // -- App lifecycle --------------------------------------------------------
  // -- Attachments (JXA-only; OmniJsTransport satisfies the interface only) --

  async listAttachments(
    _input: import("../OmniFocusAdapter.js").ListAttachmentsInput,
  ): Promise<import("../../domain/attachment.js").Attachment[]> {
    return notYetWired("listAttachments");
  }

  async addAttachment(
    _input: import("../OmniFocusAdapter.js").AddAttachmentInput,
  ): Promise<import("../../domain/ids.js").AttachmentId> {
    return notYetWired("addAttachment");
  }

  async removeAttachment(
    _input: import("../OmniFocusAdapter.js").RemoveAttachmentInput,
  ): Promise<void> {
    return notYetWired("removeAttachment");
  }

  async saveAttachmentToPath(
    _input: import("../OmniFocusAdapter.js").SaveAttachmentInput,
  ): Promise<import("../OmniFocusAdapter.js").SaveAttachmentResult> {
    return notYetWired("saveAttachmentToPath");
  }

  // App launch is a JXA operation (activate via osascript); OmniJsTransport
  // satisfies the interface only — TransportRouter never routes here.

  async appLaunch(): Promise<import("../OmniFocusAdapter.js").AppLaunchResult> {
    return notYetWired("appLaunch");
  }

  // -- Window controls — JXA-only; satisfy the interface only --------------
  async getWindowState(): Promise<{
    perspectiveName: string | null;
    focusContainerIds: string[];
  }> {
    return notYetWired("getWindowState");
  }
  async setWindowPerspective(_perspectiveName: string): Promise<{ perspectiveName: string }> {
    return notYetWired("setWindowPerspective");
  }
  async setWindowFocus(_containerId: string | null): Promise<{ focusContainerIds: string[] }> {
    return notYetWired("setWindowFocus");
  }

  // -- Plug-in invocation (wired) -------------------------------------------

  async pluginInvoke(input: PluginInvokeInput): Promise<PluginInvokeResult> {
    const script = pluginInvokeScript;
    return runOmniJsScript<PluginInvokeResult>(
      script,
      { identifier: input.identifier, arg: input.arg ?? null },
      { ...this.runOpts, scriptName: "plugin_invoke" },
    );
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

  async evaluateCustomPerspective(
    identifier: string,
  ): Promise<import("../../domain/task.js").Task[]> {
    const script = perspectiveEvaluateScript;
    const result = await runOmniJsScript<PerspectiveEvaluateScriptResult>(
      script,
      { identifier },
      { ...this.runOpts, scriptName: "perspective_evaluate" },
    );

    if (isScriptError(result)) {
      if (result.error.code === "FEATURE_REQUIRES_PRO") {
        throw new FeatureRequiresPro(result.error.message, {
          details: { feature: "custom-perspectives" },
        });
      }
      throw new NotFound(result.error.message, {
        details: { resource: "perspective", id: identifier },
      });
    }

    return result.tasks.map((t) => ({ ...t, id: TaskIdCtor.of(t.id as unknown as string) }));
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

  // -- Change detection — delegated to JXA (OmniJS has no modificationDate API)

  async getChangesSince(_sinceIso: string): Promise<{ taskIds: string[]; projectIds: string[] }> {
    // OmniJS does not expose modificationDate queries. Signal that the caller
    // should fall back to a full cache clear. In production the TransportRouter
    // routes getChangesSince to JXA, so this path is only reached in isolated
    // OmniJsTransport tests.
    return { taskIds: [], projectIds: [] };
  }

  // -- Raw escape hatch (off by default; gated by env at the tool layer) ----

  async runOmniJsScript(script: string, arg?: unknown): Promise<unknown> {
    return runOmniJsScript(script, arg ?? {}, { ...this.runOpts, scriptName: "raw" });
  }
}
