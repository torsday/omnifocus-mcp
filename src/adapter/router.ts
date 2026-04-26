/**
 * `TransportRouter` — the facade every service layer talks to.
 *
 * The router is itself an `OmniFocusAdapter`, so services are blind to which
 * underlying transport serves each call (DESIGN §6.1 — the adapter seam).
 * It holds references to a `JxaTransport` and an `OmniJsTransport`, and
 * dispatches per-method according to a single literal **routing table**.
 *
 * ## Why a routing table?
 *
 * The choice of transport per method is a load-bearing policy decision
 * (ADR-0002 — JXA is the default; OmniJS for surfaces JXA cannot reach,
 * e.g. custom perspectives and plug-in invocation). Keeping that policy in
 * one auditable literal means:
 *
 * - Any reviewer can answer "which transport handles X?" by reading one file.
 * - Moving a method between transports is a one-line change with zero
 *   knock-on effects in service code.
 * - The envelope layer (ADR-0013 / DESIGN §13) can stamp
 *   `meta.transport` by indexing into the exported {@link ROUTING_TABLE}
 *   rather than instrumenting every call site.
 *
 * The current table routes everything to JXA except the OmniJS raw escape
 * hatch. Per-method OmniJS surfaces (custom perspectives #55, plugin
 * invocation #74) will add new rows as those methods land on the adapter
 * interface.
 *
 * ## Lifecycle & concurrency
 *
 * The router does not itself introduce concurrency controls; those live in
 * #20 (read pool / write queue / OmniJS queue) and compose _above_ the
 * router. The router also does not gate on OF version or running-state —
 * that is the lifecycle layer's job (#25). Keeping the router pure dispatch
 * makes it substitutable by `InMemoryAdapter` for service tests.
 *
 * @see DESIGN.md §6.1, §6.3 — layering, adapter seam
 * @see docs/adr/0002-omnifocus-transport-dual.md
 * @see docs/adr/0009-concurrency-pool-and-queue.md
 * @see docs/adr/0013-tool-response-envelope.md
 */

import type { Folder } from "../domain/folder.js";
import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";
import type { Tag } from "../domain/tag.js";
import type { Task } from "../domain/task.js";
import type { JxaTransport } from "./jxa/JxaTransport.js";
import type {
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  OmniFocusAdapter,
  SyncStatus,
  TaskFilter,
  TaskPosition,
  UpdateFolderInput,
  UpdateProjectInput,
  UpdateTagInput,
  UpdateTaskInput,
} from "./OmniFocusAdapter.js";
import type { OmniJsTransport } from "./omnijs/OmniJsTransport.js";

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

/** Names of every method on `OmniFocusAdapter`, including the optional raw escape hatches. */
export type AdapterMethod = keyof OmniFocusAdapter;

/** The two concrete transports the router can dispatch to. */
export type TransportName = "jxa" | "omnijs";

/**
 * The single source of truth for per-method transport selection.
 *
 * Read this once to know the entire policy. Moving a method between
 * transports is a one-line edit here; no call-site changes required.
 *
 * Current policy:
 *
 * - **JXA** — every data/sync/raw-JXA method. JXA is the primary transport
 *   per ADR-0002 and reaches the full OmniFocus scripting surface that the
 *   M1 services need.
 * - **OmniJS** — only the `runOmniJsScript` raw escape hatch today. As
 *   OmniJS-only methods land on the adapter interface (custom perspectives
 *   #55, plugin invocation #74), their rows switch to `"omnijs"`.
 */
export const ROUTING_TABLE: Readonly<Record<AdapterMethod, TransportName>> = Object.freeze({
  // -- Tasks ----------------------------------------------------------------
  listTasks: "jxa",
  getTask: "jxa",
  getTasksMany: "jxa",
  createTask: "jxa",
  updateTask: "jxa",
  completeTask: "jxa",
  uncompleteTask: "jxa",
  dropTask: "jxa",
  undropTask: "jxa",
  deleteTask: "jxa",
  moveTask: "omnijs", // JXA task.move() → error 9 in OF 4.x; Database.moveTasks() via OmniJS works
  batchMoveTasks: "omnijs", // same JXA bug; batch variant routes through OmniJS
  reorderTask: "omnijs",
  duplicateTask: "jxa",
  batchCreateTasks: "jxa",
  batchUpdateTasks: "jxa",
  batchCompleteTasks: "jxa",
  batchUncompleteTasks: "jxa",
  batchDeleteTasks: "jxa",
  batchDropTasks: "jxa",
  batchUndropTasks: "jxa",

  // -- Projects -------------------------------------------------------------
  listProjects: "jxa",
  getProject: "jxa",
  getProjectsMany: "jxa",
  createProject: "jxa",
  updateProject: "jxa",
  completeProject: "jxa",
  batchCompleteProjects: "jxa",
  dropProject: "jxa",
  batchDropProjects: "jxa",
  moveProject: "jxa",
  deleteProject: "jxa",
  markProjectReviewed: "jxa",
  listProjectsDueForReview: "jxa",
  setProjectReviewInterval: "jxa",

  // -- Tags -----------------------------------------------------------------
  listTags: "jxa",
  getTag: "jxa",
  getTagsMany: "jxa",
  createTag: "jxa",
  updateTag: "jxa",
  deleteTag: "jxa",

  // -- Folders --------------------------------------------------------------
  listFolders: "jxa",
  getFolder: "jxa",
  createFolder: "jxa",
  updateFolder: "jxa",
  deleteFolder: "jxa",

  // -- Search ---------------------------------------------------------------
  searchTasks: "jxa",
  getForecast: "jxa",

  // -- Perspectives ---------------------------------------------------------
  listPerspectives: "jxa",
  evaluatePerspective: "jxa",
  evaluateCustomPerspective: "omnijs",

  // -- Sync -----------------------------------------------------------------
  syncTrigger: "jxa",
  getLastSync: "jxa",

  // -- Attachments ----------------------------------------------------------
  listAttachments: "jxa",
  addAttachment: "jxa",
  removeAttachment: "jxa",
  saveAttachmentToPath: "jxa",

  // -- App lifecycle --------------------------------------------------------
  appLaunch: "jxa",

  // -- Plug-in invocation ---------------------------------------------------
  pluginInvoke: "omnijs",

  // -- Change detection ------------------------------------------------------
  getChangesSince: "jxa",

  // -- Raw escape hatches ---------------------------------------------------
  runJxaScript: "jxa",
  runOmniJsScript: "omnijs",
});

/**
 * Return the transport name assigned to a given adapter method.
 *
 * The envelope layer uses this to stamp `meta.transport` without
 * instrumenting every dispatch site.
 */
export function transportFor(method: AdapterMethod): TransportName {
  return ROUTING_TABLE[method];
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface TransportRouterOptions {
  jxa: OmniFocusAdapter;
  omnijs: OmniFocusAdapter;
}

/**
 * Dispatches `OmniFocusAdapter` calls to the transport chosen by
 * {@link ROUTING_TABLE}. The injected transports are typed as
 * `OmniFocusAdapter` (not the concrete classes) so tests can swap in stubs
 * and the contract harness (#30) can exercise the router without spawning
 * real `osascript` processes.
 */
export class TransportRouter implements OmniFocusAdapter {
  private readonly jxa: OmniFocusAdapter;
  private readonly omnijs: OmniFocusAdapter;

  constructor(options: TransportRouterOptions) {
    this.jxa = options.jxa;
    this.omnijs = options.omnijs;
  }

  /** Expose the routing policy so callers can audit or reflect over it. */
  get routingTable(): Readonly<Record<AdapterMethod, TransportName>> {
    return ROUTING_TABLE;
  }

  /**
   * Factory that wires in real `JxaTransport` / `OmniJsTransport` instances.
   * Prefer this in production; tests use the plain constructor with stubs.
   */
  static fromTransports(jxa: JxaTransport, omnijs: OmniJsTransport): TransportRouter {
    return new TransportRouter({ jxa, omnijs });
  }

  /** Internal dispatch helper. Narrows the method lookup to one place. */
  private pick(method: AdapterMethod): OmniFocusAdapter {
    return ROUTING_TABLE[method] === "jxa" ? this.jxa : this.omnijs;
  }

  // -- Tasks ----------------------------------------------------------------

  listTasks(filter: TaskFilter): Promise<Task[]> {
    return this.pick("listTasks").listTasks(filter);
  }
  getTask(id: TaskId): Promise<Task> {
    return this.pick("getTask").getTask(id);
  }
  getTasksMany(ids: TaskId[]): Promise<(Task | null)[]> {
    return this.pick("getTasksMany").getTasksMany(ids);
  }
  createTask(input: CreateTaskInput): Promise<TaskId> {
    return this.pick("createTask").createTask(input);
  }
  updateTask(id: TaskId, patch: UpdateTaskInput): Promise<void> {
    return this.pick("updateTask").updateTask(id, patch);
  }
  completeTask(id: TaskId, at?: Date): Promise<void> {
    return this.pick("completeTask").completeTask(id, at);
  }
  uncompleteTask(id: TaskId): Promise<void> {
    return this.pick("uncompleteTask").uncompleteTask(id);
  }
  dropTask(id: TaskId, at?: Date): Promise<void> {
    return this.pick("dropTask").dropTask(id, at);
  }
  undropTask(id: TaskId): Promise<void> {
    return this.pick("undropTask").undropTask(id);
  }
  deleteTask(id: TaskId): Promise<void> {
    return this.pick("deleteTask").deleteTask(id);
  }
  moveTask(id: TaskId, destination: { projectId?: ProjectId; parentId?: TaskId }): Promise<void> {
    return this.pick("moveTask").moveTask(id, destination);
  }
  batchMoveTasks(
    items: Array<{ id: TaskId; destination: { projectId?: ProjectId; parentId?: TaskId } }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchMoveTasks").batchMoveTasks(items);
  }
  reorderTask(id: TaskId, position: TaskPosition): Promise<void> {
    return this.pick("reorderTask").reorderTask(id, position);
  }
  duplicateTask(
    id: TaskId,
    opts: {
      recursive: boolean;
      destination?: { projectId: ProjectId } | { parentId: TaskId } | { toInbox: true };
    },
  ): Promise<{ newId: TaskId; descendantCount: number }> {
    return this.pick("duplicateTask").duplicateTask(id, opts);
  }
  batchCreateTasks(
    inputs: CreateTaskInput[],
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchCreateTasks").batchCreateTasks(inputs);
  }
  batchUpdateTasks(
    updates: Array<{ id: TaskId; patch: UpdateTaskInput }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchUpdateTasks").batchUpdateTasks(updates);
  }
  batchCompleteTasks(
    items: Array<{ id: TaskId; at?: Date }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchCompleteTasks").batchCompleteTasks(items);
  }
  batchUncompleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchUncompleteTasks").batchUncompleteTasks(items);
  }
  batchDeleteTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchDeleteTasks").batchDeleteTasks(items);
  }
  batchDropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchDropTasks").batchDropTasks(items);
  }

  batchUndropTasks(
    items: Array<{ id: TaskId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<TaskId>> {
    return this.pick("batchUndropTasks").batchUndropTasks(items);
  }

  // -- Projects -------------------------------------------------------------

  listProjects(filter?: { folderId?: FolderId; status?: Project["status"] }): Promise<Project[]> {
    return this.pick("listProjects").listProjects(filter);
  }
  getProject(id: ProjectId): Promise<Project> {
    return this.pick("getProject").getProject(id);
  }
  getProjectsMany(ids: ProjectId[]): Promise<(Project | null)[]> {
    return this.pick("getProjectsMany").getProjectsMany(ids);
  }
  createProject(input: CreateProjectInput): Promise<ProjectId> {
    return this.pick("createProject").createProject(input);
  }
  updateProject(id: ProjectId, patch: UpdateProjectInput): Promise<void> {
    return this.pick("updateProject").updateProject(id, patch);
  }
  completeProject(id: ProjectId, at?: Date): Promise<void> {
    return this.pick("completeProject").completeProject(id, at);
  }
  dropProject(id: ProjectId, at?: Date): Promise<void> {
    return this.pick("dropProject").dropProject(id, at);
  }
  batchCompleteProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<ProjectId>> {
    return this.pick("batchCompleteProjects").batchCompleteProjects(items);
  }
  batchDropProjects(
    items: Array<{ id: ProjectId }>,
  ): Promise<import("../domain/batch.js").BatchOutcome<ProjectId>> {
    return this.pick("batchDropProjects").batchDropProjects(items);
  }
  moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void> {
    return this.pick("moveProject").moveProject(id, destination);
  }
  deleteProject(id: ProjectId): Promise<void> {
    return this.pick("deleteProject").deleteProject(id);
  }
  markProjectReviewed(id: ProjectId): Promise<void> {
    return this.pick("markProjectReviewed").markProjectReviewed(id);
  }
  listProjectsDueForReview(): Promise<import("../domain/project.js").Project[]> {
    return this.pick("listProjectsDueForReview").listProjectsDueForReview();
  }
  setProjectReviewInterval(
    id: import("../domain/ids.js").ProjectId,
    days: number | null,
  ): Promise<void> {
    return this.pick("setProjectReviewInterval").setProjectReviewInterval(id, days);
  }

  // -- Tags -----------------------------------------------------------------

  listTags(filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]> {
    return this.pick("listTags").listTags(filter);
  }
  getTag(id: TagId): Promise<Tag> {
    return this.pick("getTag").getTag(id);
  }
  getTagsMany(ids: TagId[]): Promise<(Tag | null)[]> {
    return this.pick("getTagsMany").getTagsMany(ids);
  }
  createTag(input: CreateTagInput): Promise<TagId> {
    return this.pick("createTag").createTag(input);
  }
  updateTag(id: TagId, patch: UpdateTagInput): Promise<void> {
    return this.pick("updateTag").updateTag(id, patch);
  }
  deleteTag(id: TagId): Promise<void> {
    return this.pick("deleteTag").deleteTag(id);
  }

  // -- Folders --------------------------------------------------------------

  listFolders(filter?: { parentId?: FolderId }): Promise<Folder[]> {
    return this.pick("listFolders").listFolders(filter);
  }
  getFolder(id: FolderId): Promise<Folder> {
    return this.pick("getFolder").getFolder(id);
  }
  createFolder(input: CreateFolderInput): Promise<FolderId> {
    return this.pick("createFolder").createFolder(input);
  }
  updateFolder(id: FolderId, patch: UpdateFolderInput): Promise<void> {
    return this.pick("updateFolder").updateFolder(id, patch);
  }
  deleteFolder(id: FolderId): Promise<void> {
    return this.pick("deleteFolder").deleteFolder(id);
  }

  // -- Sync -----------------------------------------------------------------

  searchTasks(
    filter: import("./OmniFocusAdapter.js").SearchFilter,
  ): Promise<import("../domain/task.js").Task[]> {
    return this.pick("searchTasks").searchTasks(filter);
  }

  getForecast(
    input: import("./OmniFocusAdapter.js").ForecastInput,
  ): Promise<import("./OmniFocusAdapter.js").ForecastResult> {
    return this.pick("getForecast").getForecast(input);
  }

  listPerspectives(): Promise<import("../domain/perspective.js").Perspective[]> {
    return this.pick("listPerspectives").listPerspectives();
  }

  evaluatePerspective(
    id: import("../domain/perspective.js").BuiltinPerspectiveId,
  ): Promise<import("../domain/task.js").Task[]> {
    return this.pick("evaluatePerspective").evaluatePerspective(id);
  }

  evaluateCustomPerspective(identifier: string): Promise<import("../domain/task.js").Task[]> {
    return this.pick("evaluateCustomPerspective").evaluateCustomPerspective(identifier);
  }

  syncTrigger(): Promise<SyncStatus> {
    return this.pick("syncTrigger").syncTrigger();
  }
  getLastSync(): Promise<SyncStatus> {
    return this.pick("getLastSync").getLastSync();
  }

  // -- Attachments ----------------------------------------------------------

  listAttachments(
    input: import("./OmniFocusAdapter.js").ListAttachmentsInput,
  ): Promise<import("../domain/attachment.js").Attachment[]> {
    return this.pick("listAttachments").listAttachments(input);
  }

  addAttachment(
    input: import("./OmniFocusAdapter.js").AddAttachmentInput,
  ): Promise<import("../domain/ids.js").AttachmentId> {
    return this.pick("addAttachment").addAttachment(input);
  }

  removeAttachment(input: import("./OmniFocusAdapter.js").RemoveAttachmentInput): Promise<void> {
    return this.pick("removeAttachment").removeAttachment(input);
  }

  saveAttachmentToPath(
    input: import("./OmniFocusAdapter.js").SaveAttachmentInput,
  ): Promise<import("./OmniFocusAdapter.js").SaveAttachmentResult> {
    return this.pick("saveAttachmentToPath").saveAttachmentToPath(input);
  }

  // -- App lifecycle --------------------------------------------------------

  appLaunch(): Promise<import("./OmniFocusAdapter.js").AppLaunchResult> {
    return this.pick("appLaunch").appLaunch();
  }

  // -- Plug-in invocation ---------------------------------------------------

  pluginInvoke(
    input: import("./OmniFocusAdapter.js").PluginInvokeInput,
  ): Promise<import("./OmniFocusAdapter.js").PluginInvokeResult> {
    return this.pick("pluginInvoke").pluginInvoke(input);
  }

  // -- Raw escape hatches ---------------------------------------------------
  //
  // The raw-script methods are optional on `OmniFocusAdapter` (they only
  // exist to satisfy the env-gated `run_*_script` tools). The router always
  // exposes them — if the chosen transport doesn't implement the method we
  // throw a `TypeError` at the boundary so the misconfiguration is loud.

  runJxaScript(script: string, arg?: unknown): Promise<unknown> {
    const target = this.pick("runJxaScript");
    if (typeof target.runJxaScript !== "function") {
      return Promise.reject(
        new TypeError("Router dispatched runJxaScript to a transport that does not implement it"),
      );
    }
    return target.runJxaScript(script, arg);
  }

  runOmniJsScript(script: string, arg?: unknown): Promise<unknown> {
    const target = this.pick("runOmniJsScript");
    if (typeof target.runOmniJsScript !== "function") {
      return Promise.reject(
        new TypeError(
          "Router dispatched runOmniJsScript to a transport that does not implement it",
        ),
      );
    }
    return target.runOmniJsScript(script, arg);
  }

  getChangesSince(sinceIso: string): Promise<{ taskIds: string[]; projectIds: string[] }> {
    return this.pick("getChangesSince").getChangesSince(sinceIso);
  }
}
