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

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { OmniFocusAdapter } from "../../src/adapter/OmniFocusAdapter.js";
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
 */
export interface AdapterContractOptions {
  createAdapter: () => OmniFocusAdapter | Promise<OmniFocusAdapter>;
  cleanup?: (adapter: OmniFocusAdapter) => void | Promise<void>;
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
  describe(`adapter contract — ${label}`, () => {
    let adapter: OmniFocusAdapter;

    beforeEach(async () => {
      adapter = await options.createAdapter();
    });

    afterEach(async () => {
      if (options.cleanup) await options.cleanup(adapter);
    });

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
        await adapter.createTask({ name: "a", flagged: true });
        await adapter.createTask({ name: "b", flagged: false });
        const result = await adapter.listTasks({ flagged: true });
        expect(result.map((t) => t.name)).toEqual(["a"]);
      });

      test("completed filter narrows to (un)completed tasks", async () => {
        const a = await adapter.createTask({ name: "a" });
        await adapter.createTask({ name: "b" });
        await adapter.completeTask(a);
        const open = await adapter.listTasks({ completed: false });
        const done = await adapter.listTasks({ completed: true });
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
        await adapter.createTask({ name: "before", dueDate: "2026-04-21T00:00:00Z" });
        await adapter.createTask({ name: "same", dueDate: "2026-04-22T00:00:00Z" });
        await adapter.createTask({ name: "after", dueDate: "2026-04-23T00:00:00Z" });
        const result = await adapter.listTasks({ dueBefore: "2026-04-22T00:00:00Z" });
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
        const onHold = await adapter.createProject({ name: "p1", status: "on-hold" });
        await adapter.createProject({ name: "p2", status: "active" });
        const result = await adapter.listProjects({ status: "on-hold" });
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
