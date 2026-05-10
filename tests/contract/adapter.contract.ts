/**
 * `OmniFocusAdapter` contract harness (#30).
 *
 * A single parameterized test suite every adapter implementation must satisfy.
 * Drivers call `runAdapterContract(label, factory)` from a `*.test.ts` or
 * `*.contract.test.ts` file; the harness registers `describe`/`test` cases
 * against a fresh adapter for each test.
 *
 * **Scope** — CRUD on tasks/projects/tags/folders, filter semantics for
 * `listTasks` / `listProjects` / `listTags` / `listFolders`, and the typed
 * error taxonomy (`NotFound`, `ValidationError`).
 *
 * **Out of scope** (integration tier owns these):
 * - `available` / `blocked` derivation
 * - recurring-task cascade on completion
 * - perspective evaluation
 * - sync mechanics
 * - attachments
 * - TaskPaper / OPML round-trips
 * - plug-in invocation
 *
 * See `tests/README.md` for how to run the suite against InMemoryAdapter
 * (unit tier, always on) vs real transports (integration tier, gated on
 * `OMNIFOCUS_INTEGRATION=1`).
 *
 * @see DESIGN.md §19 — testing strategy and InMemoryAdapter scope
 * @see src/adapter/OmniFocusAdapter.ts — the interface under test
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type {
  CreateFolderInput,
  CreateProjectInput,
  CreateTagInput,
  CreateTaskInput,
  OmniFocusAdapter,
} from "../../src/adapter/OmniFocusAdapter.js";
import type { FolderId, TagId, TaskId } from "../../src/domain/ids.js";
import { NotFound, ValidationError } from "../../src/errors/index.js";

/**
 * Options accepted by {@link runAdapterContract}.
 *
 * `createAdapter` must return a clean adapter state per test — drivers
 * typically allocate a fresh `InMemoryAdapter`, or snapshot-and-restore a
 * real OmniFocus database for the integration tier.
 *
 * `cleanup` is optional and is called after each test to tear down any
 * fixtures the driver created (e.g. delete test projects from a real OF).
 *
 * `hookTimeoutMs` overrides vitest's 10s default for `beforeEach`/`afterEach`.
 * Live-OF cleanup deletes entities one round-trip at a time and frequently
 * needs >10s. The per-test `testTimeout` is set via the `--testTimeout` CLI
 * flag in `package.json` `test:integration` script (vitest doesn't accept a
 * per-driver test timeout from inside the harness).
 */
export interface AdapterContractOptions {
  createAdapter: () => OmniFocusAdapter | Promise<OmniFocusAdapter>;
  cleanup?: (adapter: OmniFocusAdapter) => void | Promise<void>;
  hookTimeoutMs?: number;
  /**
   * Optional **suite-scoped sandbox** for live drivers. When provided, the
   * harness creates one fixture folder before any test runs, transparently
   * routes top-level `createProject` / `createFolder` calls into that folder,
   * and bulk-deletes the folder once all tests finish (cascades projects,
   * nested folders, and contained tasks in a single round-trip).
   *
   * Inbox tasks (`createTask` without `projectId` or `parentId`) and tags
   * have no folder home; the harness tracks their IDs and bulk-deletes them
   * in parallel during teardown.
   *
   * In-memory drivers omit this — `createAdapter()` already returns fresh
   * state per test, so cleanup is a no-op.
   *
   * See #881 for the per-suite-sandbox motivation.
   */
  sandbox?: SandboxOptions;
}

export interface SandboxOptions {
  /**
   * Prefix for the fixture folder name. Reused by
   * `scripts/seed-integration-db.js`'s sweep so abandoned fixtures from
   * crashed runs eventually get cleaned up. Defaults to `"mcp-fixture"`.
   */
  prefix?: string;
}

/** Internal accumulator for sandbox-mode bulk teardown. */
interface SandboxAccumulated {
  inboxTaskIds: TaskId[];
  tagIds: TagId[];
}

/**
 * Register the adapter contract suite under `describe(label)`.
 *
 * A typical driver file looks like:
 *
 * ```ts
 * import { runAdapterContract } from "./adapter.contract.js";
 * import { InMemoryAdapter } from "../../src/adapter/inMemory/InMemoryAdapter.js";
 * runAdapterContract("InMemoryAdapter", { createAdapter: () => new InMemoryAdapter() });
 * ```
 */
export function runAdapterContract(label: string, options: AdapterContractOptions): void {
  const hookTimeout = options.hookTimeoutMs;
  const sandboxEnabled = options.sandbox !== undefined;

  describe(`adapter contract — ${label}`, () => {
    let adapter: OmniFocusAdapter;
    let sandboxFolderId: FolderId | null = null;
    const accumulated: SandboxAccumulated = { inboxTaskIds: [], tagIds: [] };

    // Suite-scoped sandbox — one fixture folder for all tests in this
    // describe. Tests' top-level project/folder creates are routed inside;
    // teardown does one recursive folder delete plus parallel sweeps for
    // inbox tasks and top-level tags. Replaces the per-test cleanup loop
    // for live drivers (#881).
    beforeAll(async () => {
      if (!sandboxEnabled) return;
      const setupAdapter = await options.createAdapter();
      const prefix = options.sandbox?.prefix ?? "mcp-fixture";
      const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sandboxFolderId = await setupAdapter.createFolder({ name: `${prefix}-${runId}` });
    }, hookTimeout);

    beforeEach(async () => {
      const base = await options.createAdapter();
      adapter = sandboxFolderId ? wrapWithSandbox(base, sandboxFolderId, accumulated) : base;
    }, hookTimeout);

    afterEach(async () => {
      // Per-test cleanup only fires for non-sandbox drivers. Sandbox mode
      // accumulates IDs and bulk-deletes once in afterAll.
      if (!sandboxEnabled && options.cleanup) await options.cleanup(adapter);
    }, hookTimeout);

    afterAll(async () => {
      if (!sandboxEnabled || !sandboxFolderId) return;
      const teardownAdapter = await options.createAdapter();
      // Inbox tasks and tags first (in parallel) — folder cascade kills
      // everything else. Errors are swallowed: tests may have already
      // deleted these IDs intentionally.
      await Promise.allSettled(
        accumulated.inboxTaskIds.map((id) => teardownAdapter.deleteTask(id)),
      );
      await Promise.allSettled(accumulated.tagIds.map((id) => teardownAdapter.deleteTag(id)));
      await teardownAdapter.deleteFolder(sandboxFolderId).catch(() => {});
    }, hookTimeout);

    // ---------------------------------------------------------------------
    // Tasks — CRUD
    // ---------------------------------------------------------------------

    describe("tasks — CRUD", () => {
      test("createTask + getTask round-trip (inbox)", async () => {
        const id = await adapter.createTask({ name: "buy milk" });
        const task = await adapter.getTask(id);
        expect(task.id).toBe(id);
        expect(task.name).toBe("buy milk");
        expect(task.projectId).toBeNull();
        expect(task.parentId).toBeNull();
        expect(task.completed).toBe(false);
      });

      test("createTask with projectId places the task in that project", async () => {
        const projectId = await adapter.createProject({ name: "errands" });
        const taskId = await adapter.createTask({ name: "milk", projectId });
        const task = await adapter.getTask(taskId);
        expect(task.projectId).toBe(projectId);
      });

      test("updateTask applies a patch", async () => {
        const id = await adapter.createTask({ name: "milk" });
        await adapter.updateTask(id, { name: "oat milk", flagged: true });
        const task = await adapter.getTask(id);
        expect(task.name).toBe("oat milk");
        expect(task.flagged).toBe(true);
      });

      test("completeTask flips completed to true and records completedAt", async () => {
        const id = await adapter.createTask({ name: "milk" });
        await adapter.completeTask(id);
        const task = await adapter.getTask(id);
        expect(task.completed).toBe(true);
        expect(task.completedAt).not.toBeNull();
      });

      test("uncompleteTask is idempotent on an already-open task", async () => {
        const id = await adapter.createTask({ name: "milk" });
        await expect(adapter.uncompleteTask(id)).resolves.toBeUndefined();
      });

      test("dropTask + undropTask round-trip", async () => {
        const id = await adapter.createTask({ name: "milk" });
        await adapter.dropTask(id);
        expect((await adapter.getTask(id)).dropped).toBe(true);
        await adapter.undropTask(id);
        expect((await adapter.getTask(id)).dropped).toBe(false);
      });

      test("deleteTask removes the task", async () => {
        const id = await adapter.createTask({ name: "milk" });
        await adapter.deleteTask(id);
        await expect(adapter.getTask(id)).rejects.toBeInstanceOf(NotFound);
      });

      test("moveTask into a project updates projectId", async () => {
        const id = await adapter.createTask({ name: "milk" });
        const projectId = await adapter.createProject({ name: "errands" });
        await adapter.moveTask(id, { projectId });
        expect((await adapter.getTask(id)).projectId).toBe(projectId);
      });

      test("reorderTask — before moves task in front of reference", async () => {
        const projectId = await adapter.createProject({ name: "ordering" });
        const a = await adapter.createTask({ name: "a", projectId });
        const b = await adapter.createTask({ name: "b", projectId });
        const c = await adapter.createTask({ name: "c", projectId });
        await adapter.reorderTask(c, { before: a });
        const ids = (await adapter.listTasks({ projectId })).map((t) => t.id);
        expect(ids).toEqual([c, a, b]);
      });

      test("reorderTask — after moves task behind reference", async () => {
        const projectId = await adapter.createProject({ name: "ordering2" });
        const a = await adapter.createTask({ name: "a", projectId });
        const b = await adapter.createTask({ name: "b", projectId });
        const c = await adapter.createTask({ name: "c", projectId });
        await adapter.reorderTask(a, { after: b });
        const ids = (await adapter.listTasks({ projectId })).map((t) => t.id);
        expect(ids).toEqual([b, a, c]);
      });

      test("reorderTask — at:start moves task to start of container", async () => {
        const projectId = await adapter.createProject({ name: "ordering3" });
        const a = await adapter.createTask({ name: "a", projectId });
        const b = await adapter.createTask({ name: "b", projectId });
        const c = await adapter.createTask({ name: "c", projectId });
        await adapter.reorderTask(c, { at: "start", in: { projectId } });
        const ids = (await adapter.listTasks({ projectId })).map((t) => t.id);
        expect(ids).toEqual([c, a, b]);
      });

      test("reorderTask — at:end moves task to end of container", async () => {
        const projectId = await adapter.createProject({ name: "ordering4" });
        const a = await adapter.createTask({ name: "a", projectId });
        const b = await adapter.createTask({ name: "b", projectId });
        const c = await adapter.createTask({ name: "c", projectId });
        await adapter.reorderTask(a, { at: "end", in: { projectId } });
        const ids = (await adapter.listTasks({ projectId })).map((t) => t.id);
        expect(ids).toEqual([b, c, a]);
      });

      test("reorderTask — { at, in } to a different project reparents", async () => {
        const p1 = await adapter.createProject({ name: "src" });
        const p2 = await adapter.createProject({ name: "dest" });
        const a = await adapter.createTask({ name: "a", projectId: p1 });
        await adapter.reorderTask(a, { at: "start", in: { projectId: p2 } });
        expect((await adapter.getTask(a)).projectId).toBe(p2);
      });

      test("reorderTask — ValidationError when reference has different parent", async () => {
        const p1 = await adapter.createProject({ name: "p1" });
        const p2 = await adapter.createProject({ name: "p2" });
        const a = await adapter.createTask({ name: "a", projectId: p1 });
        const b = await adapter.createTask({ name: "b", projectId: p2 });
        await expect(adapter.reorderTask(a, { before: b })).rejects.toBeInstanceOf(ValidationError);
      });

      test("duplicateTask — clones a task alongside the source by default", async () => {
        const projectId = await adapter.createProject({ name: "p" });
        const src = await adapter.createTask({
          name: "Original",
          projectId,
          note: "n",
          flagged: true,
        });
        const { newId, descendantCount } = await adapter.duplicateTask(src, { recursive: false });
        expect(newId).not.toBe(src);
        expect(descendantCount).toBe(0);
        const clone = await adapter.getTask(newId);
        expect(clone.name).toBe("Original");
        expect(clone.note).toBe("n");
        expect(clone.flagged).toBe(true);
        expect(clone.projectId).toBe(projectId);
      });

      test("duplicateTask — recursive clones full subtree depth-first", async () => {
        const root = await adapter.createTask({ name: "root" });
        const c1 = await adapter.createTask({ name: "c1", parentId: root });
        await adapter.createTask({ name: "c2", parentId: root });
        await adapter.createTask({ name: "g1", parentId: c1 });
        const { newId, descendantCount } = await adapter.duplicateTask(root, { recursive: true });
        expect(descendantCount).toBe(3);
        const cloneChildren = await adapter.listTasks({ parentId: newId });
        expect(cloneChildren.map((t) => t.name).sort()).toEqual(["c1", "c2"]);
      });

      test("duplicateTask — destination.projectId reparents the clone", async () => {
        const p1 = await adapter.createProject({ name: "p1" });
        const p2 = await adapter.createProject({ name: "p2" });
        const src = await adapter.createTask({ name: "x", projectId: p1 });
        const { newId } = await adapter.duplicateTask(src, {
          recursive: false,
          destination: { projectId: p2 },
        });
        expect((await adapter.getTask(newId)).projectId).toBe(p2);
      });

      test("duplicateTask — resets completed state on the clone", async () => {
        const src = await adapter.createTask({ name: "done" });
        await adapter.completeTask(src);
        const { newId } = await adapter.duplicateTask(src, { recursive: false });
        const clone = await adapter.getTask(newId);
        expect(clone.completed).toBe(false);
        expect(clone.completedAt).toBeNull();
      });

      test("getTasksMany preserves input order and returns null for missing IDs", async () => {
        const a = await adapter.createTask({ name: "a" });
        const b = await adapter.createTask({ name: "b" });
        const missing = a.replace(/.$/, "z") as typeof a; // structurally valid branded ID that isn't assigned
        const result = await adapter.getTasksMany([b, missing, a]);
        expect(result).toHaveLength(3);
        expect(result[0]?.id).toBe(b);
        expect(result[1]).toBeNull();
        expect(result[2]?.id).toBe(a);
      });
    });

    // ---------------------------------------------------------------------
    // Tasks — filter semantics (listTasks)
    // ---------------------------------------------------------------------

    describe("tasks — filter semantics", () => {
      test("projectId filter returns only tasks in the project", async () => {
        const p1 = await adapter.createProject({ name: "p1" });
        const p2 = await adapter.createProject({ name: "p2" });
        await adapter.createTask({ name: "a", projectId: p1 });
        await adapter.createTask({ name: "b", projectId: p2 });
        await adapter.createTask({ name: "inbox" }); // no project
        const result = await adapter.listTasks({ projectId: p1 });
        expect(result.map((t) => t.name).sort()).toEqual(["a"]);
      });

      test("flagged filter narrows to flagged tasks", async () => {
        // Scope to a test project so the filter doesn't race against the user's
        // existing flagged tasks (which would cause timeouts or false positives).
        const projectId = await adapter.createProject({ name: "flagged-filter-test" });
        await adapter.createTask({ name: "a", flagged: true, projectId });
        await adapter.createTask({ name: "b", flagged: false, projectId });
        const result = await adapter.listTasks({ flagged: true, projectId });
        expect(result.map((t) => t.name)).toEqual(["a"]);
      });

      test("completed filter narrows to (un)completed tasks", async () => {
        // Scope to a test project for isolation (user's DB may have many completed tasks).
        const projectId = await adapter.createProject({ name: "completed-filter-test" });
        const a = await adapter.createTask({ name: "a", projectId });
        await adapter.createTask({ name: "b", projectId });
        await adapter.completeTask(a);
        const open = await adapter.listTasks({ completed: false, projectId });
        const done = await adapter.listTasks({ completed: true, projectId });
        expect(open.map((t) => t.name)).toEqual(["b"]);
        expect(done.map((t) => t.name)).toEqual(["a"]);
      });

      test("tagId filter returns tasks carrying that tag", async () => {
        const tagId = await adapter.createTag({ name: "home" });
        await adapter.createTask({ name: "a", tagIds: [tagId] });
        await adapter.createTask({ name: "b" });
        const result = await adapter.listTasks({ tagId });
        expect(result.map((t) => t.name)).toEqual(["a"]);
      });

      test("dueBefore filter is strictly exclusive on the upper bound", async () => {
        // Scope to a test project so the filter only sees these three tasks.
        const projectId = await adapter.createProject({ name: "duebefore-filter-test" });
        await adapter.createTask({
          name: "before",
          dueDate: "2026-04-21T00:00:00Z",
          projectId,
        });
        await adapter.createTask({ name: "same", dueDate: "2026-04-22T00:00:00Z", projectId });
        await adapter.createTask({ name: "after", dueDate: "2026-04-23T00:00:00Z", projectId });
        const result = await adapter.listTasks({
          dueBefore: "2026-04-22T00:00:00Z",
          projectId,
        });
        expect(result.map((t) => t.name).sort()).toEqual(["before"]);
      });

      test("parentId filter returns only subtasks of the parent", async () => {
        const parentId = await adapter.createTask({ name: "parent" });
        await adapter.createTask({ name: "child", parentId });
        await adapter.createTask({ name: "other" });
        const result = await adapter.listTasks({ parentId });
        expect(result.map((t) => t.name)).toEqual(["child"]);
      });
    });

    // ---------------------------------------------------------------------
    // Projects — CRUD + filter
    // ---------------------------------------------------------------------

    describe("projects — CRUD + filter", () => {
      test("createProject + getProject round-trip", async () => {
        const id = await adapter.createProject({ name: "proj" });
        const project = await adapter.getProject(id);
        expect(project.id).toBe(id);
        expect(project.name).toBe("proj");
        expect(project.status).toBe("active");
      });

      test("updateProject applies a patch", async () => {
        const id = await adapter.createProject({ name: "proj" });
        await adapter.updateProject(id, { name: "renamed", status: "on-hold" });
        const project = await adapter.getProject(id);
        expect(project.name).toBe("renamed");
        expect(project.status).toBe("on-hold");
      });

      test("listProjects filters by folderId", async () => {
        const folderId = await adapter.createFolder({ name: "work" });
        const inFolder = await adapter.createProject({ name: "inF", folderId });
        await adapter.createProject({ name: "outF" });
        const result = await adapter.listProjects({ folderId });
        expect(result.map((p) => p.id)).toEqual([inFolder]);
      });

      test("listProjects filters by status", async () => {
        // Scope to a test folder so the filter only sees this test's projects.
        // Live OF DBs typically have other on-hold projects from real use; an
        // unscoped status filter would race against them. Mirrors how the
        // other filter tests (flagged, completed, dueBefore) scope to a project.
        const folderId = await adapter.createFolder({ name: "status-filter-test" });
        const onHold = await adapter.createProject({
          name: "p1",
          status: "on-hold",
          folderId,
        });
        await adapter.createProject({ name: "p2", status: "active", folderId });
        const result = await adapter.listProjects({ status: "on-hold", folderId });
        expect(result.map((p) => p.id)).toEqual([onHold]);
      });

      test("moveProject to a different folder updates folderId", async () => {
        const folderA = await adapter.createFolder({ name: "a" });
        const folderB = await adapter.createFolder({ name: "b" });
        const projectId = await adapter.createProject({ name: "p", folderId: folderA });
        await adapter.moveProject(projectId, { folderId: folderB });
        expect((await adapter.getProject(projectId)).folderId).toBe(folderB);
      });
    });

    // ---------------------------------------------------------------------
    // Tags — CRUD + filter
    // ---------------------------------------------------------------------

    describe("tags — CRUD + filter", () => {
      test("createTag + getTag round-trip", async () => {
        const id = await adapter.createTag({ name: "home" });
        const tag = await adapter.getTag(id);
        expect(tag.id).toBe(id);
        expect(tag.name).toBe("home");
        expect(tag.status).toBe("active");
      });

      test("updateTag renames", async () => {
        const id = await adapter.createTag({ name: "home" });
        await adapter.updateTag(id, { name: "house" });
        expect((await adapter.getTag(id)).name).toBe("house");
      });

      test("listTags filters by parentId (nested tag hierarchy)", async () => {
        const parentId = await adapter.createTag({ name: "parent" });
        const childId = await adapter.createTag({ name: "child", parentId });
        await adapter.createTag({ name: "top" });
        const result = await adapter.listTags({ parentId });
        expect(result.map((t) => t.id)).toEqual([childId]);
      });

      test("deleteTag removes the tag from any tasks that carried it", async () => {
        const tagId = await adapter.createTag({ name: "t" });
        const taskId = await adapter.createTask({ name: "a", tagIds: [tagId] });
        await adapter.deleteTag(tagId);
        expect((await adapter.getTask(taskId)).tagIds).toEqual([]);
      });
    });

    // ---------------------------------------------------------------------
    // Folders — CRUD + filter
    // ---------------------------------------------------------------------

    describe("folders — CRUD + filter", () => {
      test("createFolder + getFolder round-trip", async () => {
        const id = await adapter.createFolder({ name: "work" });
        const folder = await adapter.getFolder(id);
        expect(folder.id).toBe(id);
        expect(folder.name).toBe("work");
      });

      test("updateFolder renames", async () => {
        const id = await adapter.createFolder({ name: "work" });
        await adapter.updateFolder(id, { name: "office" });
        expect((await adapter.getFolder(id)).name).toBe("office");
      });

      test("listFolders filters by parentId (nested folders)", async () => {
        const parentId = await adapter.createFolder({ name: "parent" });
        const childId = await adapter.createFolder({ name: "child", parentId });
        await adapter.createFolder({ name: "top" });
        const result = await adapter.listFolders({ parentId });
        expect(result.map((f) => f.id)).toEqual([childId]);
      });

      test("deleteFolder removes an empty folder", async () => {
        const id = await adapter.createFolder({ name: "empty" });
        await adapter.deleteFolder(id);
        await expect(adapter.getFolder(id)).rejects.toBeInstanceOf(NotFound);
      });
    });

    // ---------------------------------------------------------------------
    // Error mapping — NotFound on unknown IDs, ValidationError on bad input
    // ---------------------------------------------------------------------

    describe("error mapping", () => {
      test("getTask on an unknown ID throws NotFound", async () => {
        await expect(adapter.getTask("task_does_not_exist" as never)).rejects.toBeInstanceOf(
          NotFound,
        );
      });

      test("getProject on an unknown ID throws NotFound", async () => {
        await expect(adapter.getProject("proj_does_not_exist" as never)).rejects.toBeInstanceOf(
          NotFound,
        );
      });

      test("getTag on an unknown ID throws NotFound", async () => {
        await expect(adapter.getTag("tag_does_not_exist" as never)).rejects.toBeInstanceOf(
          NotFound,
        );
      });

      test("getFolder on an unknown ID throws NotFound", async () => {
        await expect(adapter.getFolder("fold_does_not_exist" as never)).rejects.toBeInstanceOf(
          NotFound,
        );
      });

      test("createTask with an empty name throws ValidationError", async () => {
        await expect(adapter.createTask({ name: "   " })).rejects.toBeInstanceOf(ValidationError);
      });

      test("createTask with both projectId and parentId throws ValidationError", async () => {
        const projectId = await adapter.createProject({ name: "p" });
        const parentId = await adapter.createTask({ name: "parent" });
        await expect(
          adapter.createTask({ name: "child", projectId, parentId }),
        ).rejects.toBeInstanceOf(ValidationError);
      });

      test("createTask with an unknown projectId throws NotFound", async () => {
        await expect(
          adapter.createTask({ name: "x", projectId: "proj_missing" as never }),
        ).rejects.toBeInstanceOf(NotFound);
      });

      test("createProject with an empty name throws ValidationError", async () => {
        await expect(adapter.createProject({ name: "" })).rejects.toBeInstanceOf(ValidationError);
      });

      test("createTag with an empty name throws ValidationError", async () => {
        await expect(adapter.createTag({ name: "" })).rejects.toBeInstanceOf(ValidationError);
      });

      test("createFolder with an empty name throws ValidationError", async () => {
        await expect(adapter.createFolder({ name: "" })).rejects.toBeInstanceOf(ValidationError);
      });
    });
  });
}

/**
 * Wrap an adapter so top-level entity creates land inside a fixture folder
 * (or — for inbox tasks and tags, which have no folder home — get tracked
 * for parallel bulk-delete during teardown).
 *
 * Routing rules:
 * - `createProject` without `folderId` → inject sandbox folder
 * - `createFolder` without `parentId` → inject sandbox folder
 * - `createTask` without `projectId` AND `parentId` → tracked for sweep
 * - `createTag` without `parentId` → tracked for sweep
 * - `duplicateTask` → newId tracked (over-tracks: clones inside sandboxed
 *   projects also die in the folder cascade, but the second deleteTask
 *   throws NotFound which `Promise.allSettled` swallows).
 *
 * Tests that explicitly set `tagIds` on a task (or `parentId` on a tag)
 * are not interfered with — those tests typically test specific semantics
 * (e.g. "deleteTag removes the tag from any tasks that carried it") and
 * the wrapper would otherwise leak fixture-tag IDs into their assertions.
 */
function wrapWithSandbox(
  base: OmniFocusAdapter,
  sandboxFolderId: FolderId,
  accumulated: SandboxAccumulated,
): OmniFocusAdapter {
  return new Proxy(base, {
    get(target, prop: string | symbol) {
      if (prop === "createProject") {
        return async (
          input: CreateProjectInput,
        ): Promise<ReturnType<OmniFocusAdapter["createProject"]>> => {
          const routed = input.folderId ? input : { ...input, folderId: sandboxFolderId };
          return target.createProject(routed);
        };
      }
      if (prop === "createFolder") {
        return async (
          input: CreateFolderInput,
        ): Promise<ReturnType<OmniFocusAdapter["createFolder"]>> => {
          const routed = input.parentId ? input : { ...input, parentId: sandboxFolderId };
          return target.createFolder(routed);
        };
      }
      if (prop === "createTask") {
        return async (input: CreateTaskInput): Promise<TaskId> => {
          const id = await target.createTask(input);
          if (!input.projectId && !input.parentId) accumulated.inboxTaskIds.push(id);
          return id;
        };
      }
      if (prop === "createTag") {
        return async (input: CreateTagInput): Promise<TagId> => {
          const id = await target.createTag(input);
          if (!input.parentId) accumulated.tagIds.push(id);
          return id;
        };
      }
      if (prop === "duplicateTask") {
        return async (
          ...args: Parameters<OmniFocusAdapter["duplicateTask"]>
        ): Promise<ReturnType<OmniFocusAdapter["duplicateTask"]>> => {
          const result = await target.duplicateTask(...args);
          accumulated.inboxTaskIds.push(result.newId);
          return result;
        };
      }
      const val = Reflect.get(target, prop, target);
      return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(target) : val;
    },
  }) as OmniFocusAdapter;
}
