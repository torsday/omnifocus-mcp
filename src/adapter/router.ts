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
} from "./OmniFocusAdapter.js";
import type { JxaTransport } from "./jxa/JxaTransport.js";
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
  moveTask: "jxa",

  // -- Projects -------------------------------------------------------------
  listProjects: "jxa",
  getProject: "jxa",
  createProject: "jxa",
  updateProject: "jxa",
  completeProject: "jxa",
  dropProject: "jxa",
  moveProject: "jxa",
  deleteProject: "jxa",
  markProjectReviewed: "jxa",

  // -- Tags -----------------------------------------------------------------
  listTags: "jxa",
  getTag: "jxa",
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

  // -- Perspectives ---------------------------------------------------------
  listPerspectives: "jxa",

  // -- Sync -----------------------------------------------------------------
  syncTrigger: "jxa",
  getLastSync: "jxa",

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

  // -- Projects -------------------------------------------------------------

  listProjects(filter?: { folderId?: FolderId; status?: Project["status"] }): Promise<Project[]> {
    return this.pick("listProjects").listProjects(filter);
  }
  getProject(id: ProjectId): Promise<Project> {
    return this.pick("getProject").getProject(id);
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
  moveProject(id: ProjectId, destination: { folderId: FolderId | null }): Promise<void> {
    return this.pick("moveProject").moveProject(id, destination);
  }
  deleteProject(id: ProjectId): Promise<void> {
    return this.pick("deleteProject").deleteProject(id);
  }
  markProjectReviewed(id: ProjectId): Promise<void> {
    return this.pick("markProjectReviewed").markProjectReviewed(id);
  }

  // -- Tags -----------------------------------------------------------------

  listTags(filter?: { parentId?: TagId; status?: Tag["status"] }): Promise<Tag[]> {
    return this.pick("listTags").listTags(filter);
  }
  getTag(id: TagId): Promise<Tag> {
    return this.pick("getTag").getTag(id);
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

  listPerspectives(): Promise<import("../domain/perspective.js").Perspective[]> {
    return this.pick("listPerspectives").listPerspectives();
  }

  syncTrigger(): Promise<SyncStatus> {
    return this.pick("syncTrigger").syncTrigger();
  }
  getLastSync(): Promise<SyncStatus> {
    return this.pick("getLastSync").getLastSync();
  }

  // -- Raw escape hatches ---------------------------------------------------
  //
  // The raw-script methods are optional on `OmniFocusAdapter` (they only
  // exist to satisfy the env-gated `run_*_script` tools). The router always
  // exposes them — if the chosen transport doesn't implement the method we
  // throw a `TypeError` at the boundary so the misconfiguration is loud.

  runJxaScript(script: string): Promise<unknown> {
    const target = this.pick("runJxaScript");
    if (typeof target.runJxaScript !== "function") {
      return Promise.reject(
        new TypeError("Router dispatched runJxaScript to a transport that does not implement it"),
      );
    }
    return target.runJxaScript(script);
  }

  runOmniJsScript(script: string): Promise<unknown> {
    const target = this.pick("runOmniJsScript");
    if (typeof target.runOmniJsScript !== "function") {
      return Promise.reject(
        new TypeError(
          "Router dispatched runOmniJsScript to a transport that does not implement it",
        ),
      );
    }
    return target.runOmniJsScript(script);
  }
}
