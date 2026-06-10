/**
 * Unit tests for `InMemoryAdapter`.
 *
 * Goldilocks coverage: round-trip behavior, filter semantics, derived-count
 * maintenance, and the typed error contract. The full cross-implementation
 * substitutability harness lands in #30; these tests cover the in-memory
 * double in isolation so it is trustworthy as a stand-in for OmniFocus in
 * service-layer unit tests.
 */

import { describe, expect, it } from "vitest";
import { NotFound, ValidationError } from "../../errors/index.js";
import { InMemoryAdapter } from "./InMemoryAdapter.js";

const FIXED_NOW = new Date("2026-04-21T12:00:00.000Z");

function makeAdapter(now: Date = FIXED_NOW): InMemoryAdapter {
  return new InMemoryAdapter({ now: () => now });
}

describe("InMemoryAdapter — Tasks", () => {
  it("creates an inbox task and returns it via getTask", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "buy milk" });
    const task = await a.getTask(id);
    expect(task.id).toBe(id);
    expect(task.name).toBe("buy milk");
    expect(task.projectId).toBeNull();
    expect(task.parentId).toBeNull();
    expect(task.completed).toBe(false);
    expect(task.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("rejects an empty name with ValidationError", async () => {
    const a = makeAdapter();
    await expect(a.createTask({ name: "  " })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects projectId + parentId both set", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const parentId = await a.createTask({ name: "parent" });
    await expect(a.createTask({ name: "child", projectId, parentId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("child created under a parent inherits the parent's project", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const parentId = await a.createTask({ name: "parent", projectId });
    const childId = await a.createTask({ name: "child", parentId });
    const child = await a.getTask(childId);
    expect(child.projectId).toBe(projectId);
    expect(child.parentId).toBe(parentId);
    expect((await a.getProject(projectId)).taskCount).toBe(2);
  });

  it("child created under an inbox parent stays projectless", async () => {
    const a = makeAdapter();
    const parentId = await a.createTask({ name: "parent" });
    const childId = await a.createTask({ name: "child", parentId });
    expect((await a.getTask(childId)).projectId).toBeNull();
  });

  it("rejects unknown projectId with NotFound", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    await a.deleteProject(projectId);
    await expect(a.createTask({ name: "x", projectId })).rejects.toBeInstanceOf(NotFound);
  });

  it("getTask throws NotFound for unknown id", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "tmp" });
    await a.deleteTask(id);
    await expect(a.getTask(id)).rejects.toBeInstanceOf(NotFound);
  });

  it("getTasksMany preserves input order, returning null for missing ids", async () => {
    const a = makeAdapter();
    const a1 = await a.createTask({ name: "one" });
    const a2 = await a.createTask({ name: "two" });
    await a.deleteTask(a2);
    const out = await a.getTasksMany([a2, a1]);
    expect(out[0]).toBeNull();
    expect(out[1]?.id).toBe(a1);
  });

  it("updateTask applies a partial patch and bumps modifiedAt via injected clock", async () => {
    const t1 = new Date("2026-04-21T12:00:00.000Z");
    const t2 = new Date("2026-04-22T08:00:00.000Z");
    let now = t1;
    const a = new InMemoryAdapter({ now: () => now });
    const id = await a.createTask({ name: "draft" });
    now = t2;
    await a.updateTask(id, { name: "final", flagged: true });
    const task = await a.getTask(id);
    expect(task.name).toBe("final");
    expect(task.flagged).toBe(true);
    expect(task.modifiedAt).toBe(t2.toISOString());
  });

  it("completeTask flips completed=true and tracks completedTaskCount on the project", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const id = await a.createTask({ name: "t", projectId });
    await a.completeTask(id);
    const task = await a.getTask(id);
    const project = await a.getProject(projectId);
    expect(task.completed).toBe(true);
    expect(task.completedAt).toBe(FIXED_NOW.toISOString());
    expect(project.taskCount).toBe(1);
    expect(project.completedTaskCount).toBe(1);
  });

  it("uncompleteTask is idempotent on already-uncompleted tasks", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "t" });
    await expect(a.uncompleteTask(id)).resolves.toBeUndefined();
  });

  it("re-completing an already-completed task does not double-count completedTaskCount", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const id = await a.createTask({ name: "t", projectId });
    await a.completeTask(id);
    await a.completeTask(id);
    const project = await a.getProject(projectId);
    expect(project.completedTaskCount).toBe(1);
  });

  it("dropTask + undropTask round-trip", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "t" });
    await a.dropTask(id);
    expect((await a.getTask(id)).dropped).toBe(true);
    await a.undropTask(id);
    expect((await a.getTask(id)).dropped).toBe(false);
  });

  it("moveTask updates projectId and rebalances counts", async () => {
    const a = makeAdapter();
    const p1 = await a.createProject({ name: "from" });
    const p2 = await a.createProject({ name: "to" });
    const id = await a.createTask({ name: "t", projectId: p1 });
    await a.moveTask(id, { projectId: p2 });
    expect((await a.getTask(id)).projectId).toBe(p2);
    expect((await a.getProject(p1)).taskCount).toBe(0);
    expect((await a.getProject(p2)).taskCount).toBe(1);
  });

  it("moveTask under a parent inherits the parent's project and rebalances counts", async () => {
    const a = makeAdapter();
    const p = await a.createProject({ name: "dest" });
    const parentId = await a.createTask({ name: "parent", projectId: p });
    const id = await a.createTask({ name: "child" });
    await a.moveTask(id, { parentId });
    const moved = await a.getTask(id);
    expect(moved.projectId).toBe(p);
    expect(moved.parentId).toBe(parentId);
    expect((await a.getProject(p)).taskCount).toBe(2);
  });

  it("moveTask rejects projectId + parentId both set", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const parentId = await a.createTask({ name: "parent" });
    const id = await a.createTask({ name: "child" });
    await expect(a.moveTask(id, { projectId, parentId })).rejects.toBeInstanceOf(ValidationError);
  });

  it("deleteTask decrements counts including completedTaskCount", async () => {
    const a = makeAdapter();
    const projectId = await a.createProject({ name: "p" });
    const id = await a.createTask({ name: "t", projectId });
    await a.completeTask(id);
    await a.deleteTask(id);
    const project = await a.getProject(projectId);
    expect(project.taskCount).toBe(0);
    expect(project.completedTaskCount).toBe(0);
  });
});

describe("InMemoryAdapter — listTasks filters", () => {
  it("filters by projectId, flagged, and completed", async () => {
    const a = makeAdapter();
    const p = await a.createProject({ name: "p" });
    const t1 = await a.createTask({ name: "flag", projectId: p, flagged: true });
    const t2 = await a.createTask({ name: "plain", projectId: p });
    await a.completeTask(t2);

    const flagged = await a.listTasks({ flagged: true });
    expect(flagged.map((t) => t.id)).toEqual([t1]);

    const completed = await a.listTasks({ completed: true });
    expect(completed.map((t) => t.id)).toEqual([t2]);

    const inProject = await a.listTasks({ projectId: p });
    expect(inProject).toHaveLength(2);
  });

  it("filters by tagId", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "next" });
    const tagged = await a.createTask({ name: "x", tagIds: [tag] });
    await a.createTask({ name: "y" });
    const out = await a.listTasks({ tagId: tag });
    expect(out.map((t) => t.id)).toEqual([tagged]);
  });

  it("filters by dueBefore / dueAfter date bounds", async () => {
    const a = makeAdapter();
    const early = await a.createTask({ name: "e", dueDate: "2026-01-01T00:00:00Z" });
    const late = await a.createTask({ name: "l", dueDate: "2026-12-01T00:00:00Z" });
    await a.createTask({ name: "n" }); // no due date

    const before = await a.listTasks({ dueBefore: "2026-06-01T00:00:00Z" });
    expect(before.map((t) => t.id)).toEqual([early]);

    const after = await a.listTasks({ dueAfter: "2026-06-01T00:00:00Z" });
    expect(after.map((t) => t.id)).toEqual([late]);
  });

  it("compares date filters chronologically across mixed UTC offsets", async () => {
    const a = makeAdapter();
    // 23:00+02:00 == 21:00Z — chronologically before the 22:00Z bound, but
    // lexicographically AFTER it ("23" > "22" at the hour digits).
    const id = await a.createTask({ name: "offset", dueDate: "2026-06-09T23:00:00+02:00" });
    const before = await a.listTasks({ dueBefore: "2026-06-09T22:00:00Z" });
    expect(before.map((t) => t.id)).toEqual([id]);
    const after = await a.listTasks({ dueAfter: "2026-06-09T22:00:00Z" });
    expect(after).toEqual([]);
  });

  it("getForecast classifies mixed-offset due dates chronologically", async () => {
    const a = makeAdapter();
    // 23:00+02:00 == 21:00Z — chronologically before the window start, so
    // the task is overdue, not dueToday (lexicographic order says otherwise).
    const id = await a.createTask({ name: "offset", dueDate: "2026-06-09T23:00:00+02:00" });
    const fc = await a.getForecast({
      from: "2026-06-09T22:00:00Z",
      to: "2026-06-10T21:59:59Z",
    });
    expect(fc.overdue.map((t) => t.id)).toEqual([id]);
    expect(fc.dueToday).toEqual([]);
  });

  it("filters by completedSince inclusively", async () => {
    const t0 = new Date("2026-04-21T12:00:00.000Z");
    const t1 = new Date("2026-04-21T13:00:00.000Z");
    let now = t0;
    const a = new InMemoryAdapter({ now: () => now });
    const id = await a.createTask({ name: "x" });
    now = t1;
    await a.completeTask(id);
    const out = await a.listTasks({ completedSince: t1.toISOString() });
    expect(out.map((t) => t.id)).toEqual([id]);
    const none = await a.listTasks({ completedSince: "2027-01-01T00:00:00Z" });
    expect(none).toEqual([]);
  });
});

describe("InMemoryAdapter — searchTasks", () => {
  it("omitted completed defaults to 'exclude', matching the JXA transport", async () => {
    const a = makeAdapter();
    const active = await a.createTask({ name: "report draft" });
    const done = await a.createTask({ name: "report final" });
    await a.completeTask(done);

    const defaulted = await a.searchTasks({ q: "report" });
    expect(defaulted.map((t) => t.id)).toEqual([active]);
  });

  it("completed 'any' includes completed tasks; 'only' returns just them", async () => {
    const a = makeAdapter();
    const active = await a.createTask({ name: "report draft" });
    const done = await a.createTask({ name: "report final" });
    await a.completeTask(done);

    const any = await a.searchTasks({ q: "report", completed: "any" });
    expect(any.map((t) => t.id)).toEqual([active, done]);

    const only = await a.searchTasks({ q: "report", completed: "only" });
    expect(only.map((t) => t.id)).toEqual([done]);
  });
});

describe("InMemoryAdapter — Projects", () => {
  it("creates a project and lists by status", async () => {
    const a = makeAdapter();
    const p1 = await a.createProject({ name: "active1" });
    const p2 = await a.createProject({ name: "hold", status: "on-hold" });
    const active = await a.listProjects({ status: "active" });
    const onHold = await a.listProjects({ status: "on-hold" });
    expect(active.map((p) => p.id)).toEqual([p1]);
    expect(onHold.map((p) => p.id)).toEqual([p2]);
  });

  it("rejects creation with unknown folderId", async () => {
    const a = makeAdapter();
    const folderId = await a.createFolder({ name: "f" });
    await a.deleteFolder(folderId);
    await expect(a.createProject({ name: "p", folderId })).rejects.toBeInstanceOf(NotFound);
  });

  it("moveProject rebalances folder.projectCount", async () => {
    const a = makeAdapter();
    const f1 = await a.createFolder({ name: "f1" });
    const f2 = await a.createFolder({ name: "f2" });
    const p = await a.createProject({ name: "p", folderId: f1 });
    await a.moveProject(p, { folderId: f2 });
    expect((await a.getFolder(f1)).projectCount).toBe(0);
    expect((await a.getFolder(f2)).projectCount).toBe(1);
  });

  it("deleteProject orphans its tasks (projectId becomes null)", async () => {
    const a = makeAdapter();
    const p = await a.createProject({ name: "p" });
    const t = await a.createTask({ name: "t", projectId: p });
    await a.deleteProject(p);
    expect((await a.getTask(t)).projectId).toBeNull();
  });

  it("markProjectReviewed advances nextReviewDate by reviewIntervalDays", async () => {
    const a = makeAdapter();
    const p = await a.createProject({ name: "p", reviewIntervalDays: 7 });
    await a.markProjectReviewed(p);
    const proj = await a.getProject(p);
    expect(proj.lastReviewDate).toBe(FIXED_NOW.toISOString());
    expect(proj.nextReviewDate).toBe("2026-04-28T12:00:00.000Z");
  });

  it("completeProject flips status to done", async () => {
    const a = makeAdapter();
    const p = await a.createProject({ name: "p" });
    await a.completeProject(p);
    const proj = await a.getProject(p);
    expect(proj.status).toBe("done");
    expect(proj.completed).toBe(true);
  });
});

describe("InMemoryAdapter — review", () => {
  it("listProjectsDueForReview compares against the clock instant, not end of day", async () => {
    // JXA's review_list_due.js treats "due" as nextReviewDate <= now. A
    // review scheduled for later today must NOT count as due yet, and the
    // comparison must go through the injected clock (FIXED_NOW), not wall time.
    const a = makeAdapter();
    const past = await a.createProject({ name: "past" });
    await a.setProjectNextReviewDate(past, "2026-04-21T06:00:00.000Z");
    const laterToday = await a.createProject({ name: "later" });
    await a.setProjectNextReviewDate(laterToday, "2026-04-21T18:00:00.000Z");
    const due = await a.listProjectsDueForReview();
    expect(due.map((p) => p.id)).toEqual([past]);
  });
});

describe("InMemoryAdapter — Tags", () => {
  it("creates, updates, and deletes a tag", async () => {
    const a = makeAdapter();
    const id = await a.createTag({ name: "errand" });
    expect((await a.getTag(id)).name).toBe("errand");
    await a.updateTag(id, { name: "errands", status: "on-hold" });
    const t = await a.getTag(id);
    expect(t.name).toBe("errands");
    expect(t.status).toBe("on-hold");
    await a.deleteTag(id);
    await expect(a.getTag(id)).rejects.toBeInstanceOf(NotFound);
  });

  it("deleteTag strips the tag from any task carrying it", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "x" });
    const task = await a.createTask({ name: "t", tagIds: [tag] });
    await a.deleteTag(tag);
    expect((await a.getTask(task)).tagIds).toEqual([]);
  });

  it("createTask rejects unknown tagId with NotFound", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "x" });
    await a.deleteTag(tag);
    await expect(a.createTask({ name: "t", tagIds: [tag] })).rejects.toBeInstanceOf(NotFound);
  });
});

describe("InMemoryAdapter — Forecast tag (composite #849)", () => {
  it("getForecastTagWithName returns null/null when unset", async () => {
    const a = makeAdapter();
    expect(await a.getForecastTagWithName()).toEqual({ tagId: null, name: null });
  });

  it("setForecastTagWithName returns the paired id+name in one call", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "@today" });
    expect(await a.setForecastTagWithName(tag)).toEqual({ tagId: tag, name: "@today" });
    expect(await a.getForecastTagWithName()).toEqual({ tagId: tag, name: "@today" });
  });

  it("setForecastTagWithName(null) clears and returns null/null", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "@today" });
    await a.setForecastTagWithName(tag);
    expect(await a.setForecastTagWithName(null)).toEqual({ tagId: null, name: null });
    expect(await a.getForecastTagWithName()).toEqual({ tagId: null, name: null });
  });

  it("setForecastTagWithName rejects an unknown tag with NotFound", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "@gone" });
    await a.deleteTag(tag);
    await expect(a.setForecastTagWithName(tag)).rejects.toBeInstanceOf(NotFound);
  });

  it("getForecastTagWithName surfaces an orphan id as name:null (tag deleted after set)", async () => {
    const a = makeAdapter();
    const tag = await a.createTag({ name: "@today" });
    await a.setForecastTagWithName(tag);
    await a.deleteTag(tag);
    // The stored preference id remains; the name resolves to null since the
    // tag is gone — the composite read surfaces the orphan rather than throwing.
    expect(await a.getForecastTagWithName()).toEqual({ tagId: tag, name: null });
  });
});

describe("InMemoryAdapter — Folders", () => {
  it("createFolder maintains parent.subfolderCount", async () => {
    const a = makeAdapter();
    const parent = await a.createFolder({ name: "p" });
    await a.createFolder({ name: "c", parentId: parent });
    expect((await a.getFolder(parent)).subfolderCount).toBe(1);
  });

  it("deleteFolder refuses non-empty folder", async () => {
    const a = makeAdapter();
    const f = await a.createFolder({ name: "f" });
    await a.createProject({ name: "p", folderId: f });
    await expect(a.deleteFolder(f)).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateFolder reparenting rebalances subfolderCount on both sides", async () => {
    const a = makeAdapter();
    const p1 = await a.createFolder({ name: "p1" });
    const p2 = await a.createFolder({ name: "p2" });
    const child = await a.createFolder({ name: "c", parentId: p1 });
    await a.updateFolder(child, { parentId: p2 });
    expect((await a.getFolder(p1)).subfolderCount).toBe(0);
    expect((await a.getFolder(p2)).subfolderCount).toBe(1);
  });
});

describe("InMemoryAdapter — floating timezone flags", () => {
  it("createTask round-trips deferDateFloating and dueDateFloating", async () => {
    const a = makeAdapter();
    const id = await a.createTask({
      name: "floating task",
      deferDate: "2026-06-01T09:00:00+00:00",
      deferDateFloating: true,
      dueDate: "2026-06-30T17:00:00+00:00",
      dueDateFloating: true,
    });
    const task = await a.getTask(id);
    expect(task.deferDateFloating).toBe(true);
    expect(task.dueDateFloating).toBe(true);
  });

  it("createTask omits floating flags when not supplied", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "fixed task", dueDate: "2026-06-30T17:00:00+00:00" });
    const task = await a.getTask(id);
    expect(task.deferDateFloating).toBeUndefined();
    expect(task.dueDateFloating).toBeUndefined();
  });

  it("updateTask sets floating flags when true", async () => {
    const a = makeAdapter();
    const id = await a.createTask({ name: "t", dueDate: "2026-06-30T17:00:00+00:00" });
    await a.updateTask(id, { dueDateFloating: true });
    expect((await a.getTask(id)).dueDateFloating).toBe(true);
  });

  it("updateTask clears floating flags when false", async () => {
    const a = makeAdapter();
    const id = await a.createTask({
      name: "t",
      dueDate: "2026-06-30T17:00:00+00:00",
      dueDateFloating: true,
    });
    await a.updateTask(id, { dueDateFloating: false });
    expect((await a.getTask(id)).dueDateFloating).toBeUndefined();
  });

  it("createProject round-trips deferDateFloating and dueDateFloating", async () => {
    const a = makeAdapter();
    const id = await a.createProject({
      name: "floating project",
      deferDate: "2026-06-01T09:00:00+00:00",
      deferDateFloating: true,
      dueDate: "2026-06-30T17:00:00+00:00",
      dueDateFloating: true,
    });
    const project = await a.getProject(id);
    expect(project.deferDateFloating).toBe(true);
    expect(project.dueDateFloating).toBe(true);
  });

  it("updateProject clears floating flags when false", async () => {
    const a = makeAdapter();
    const id = await a.createProject({
      name: "p",
      dueDate: "2026-06-30T17:00:00+00:00",
      dueDateFloating: true,
    });
    await a.updateProject(id, { dueDateFloating: false });
    expect((await a.getProject(id)).dueDateFloating).toBeUndefined();
  });
});

describe("InMemoryAdapter — Sync", () => {
  it("syncTrigger sets lastSyncAt to the current clock", async () => {
    const a = makeAdapter();
    expect((await a.getLastSync()).lastSyncAt).toBeNull();
    const status = await a.syncTrigger();
    expect(status.lastSyncAt).toBe(FIXED_NOW.toISOString());
    expect(status.inFlight).toBe(false);
    expect((await a.getLastSync()).lastSyncAt).toBe(FIXED_NOW.toISOString());
  });
});
