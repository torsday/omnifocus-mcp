/**
 * Tests for `ExportService.exportTaskPaper` and `ExportService.importTaskPaper`.
 *
 * Covers:
 * - Export: project/folder/all scopes, tag serialisation, flag/done tags,
 *   notes, nested subtasks, lossiness warnings for HTML notes
 * - Import: task creation, subtask nesting, tag resolution (existing + new),
 *   @due/@defer/@flagged/@done, project heading matching, targetProjectId,
 *   round-trip fidelity for the supported subset
 * - Edge cases: empty text, unknown project headings, malformed date tokens
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import type { ProjectId } from "../domain/ids.js";
import { ExportService } from "./exportService.js";

function makeService() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const service = new ExportService({ adapter });
  return { adapter, service };
}

// ---------------------------------------------------------------------------
// exportTaskPaper — scope: all
// ---------------------------------------------------------------------------

describe("ExportService.exportTaskPaper — scope: all", () => {
  it("returns empty string for an empty database", async () => {
    const { service } = makeService();
    const result = await service.exportTaskPaper({ kind: "all" });
    expect(result.projectCount).toBe(0);
    expect(result.taskCount).toBe(0);
    expect(result.taskpaper.trim()).toBe("");
  });

  it("includes all active projects as headings", async () => {
    const { adapter, service } = makeService();
    await adapter.createProject({ name: "Work" });
    await adapter.createProject({ name: "Personal" });
    const result = await service.exportTaskPaper({ kind: "all" });
    expect(result.taskpaper).toContain("Work:");
    expect(result.taskpaper).toContain("Personal:");
    expect(result.projectCount).toBe(2);
  });

  it("excludes dropped projects", async () => {
    const { adapter, service } = makeService();
    const id = await adapter.createProject({ name: "Gone" });
    await adapter.dropProject(id);
    const result = await service.exportTaskPaper({ kind: "all" });
    expect(result.taskpaper).not.toContain("Gone");
  });
});

// ---------------------------------------------------------------------------
// exportTaskPaper — scope: project
// ---------------------------------------------------------------------------

describe("ExportService.exportTaskPaper — scope: project", () => {
  it("exports a project with its tasks", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "Alpha" });
    await adapter.createTask({ name: "Task A", projectId: projId as ProjectId });
    await adapter.createTask({ name: "Task B", projectId: projId as ProjectId });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("Alpha:");
    expect(result.taskpaper).toContain("\t- Task A");
    expect(result.taskpaper).toContain("\t- Task B");
    expect(result.projectCount).toBe(1);
    expect(result.taskCount).toBe(2);
  });

  it("emits @due and @defer tags when dates are set", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({
      name: "Dated",
      projectId: projId as ProjectId,
      dueDate: "2026-05-01T00:00:00Z",
      deferDate: "2026-04-25T00:00:00Z",
    });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("@due(2026-05-01)");
    expect(result.taskpaper).toContain("@defer(2026-04-25)");
  });

  it("emits @flagged for flagged tasks", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "Important", projectId: projId as ProjectId, flagged: true });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("@flagged");
  });

  it("emits @done for completed tasks", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    const taskId = await adapter.createTask({ name: "Finished", projectId: projId as ProjectId });
    await adapter.completeTask(taskId);

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("@done");
  });

  it("renders subtasks with deeper indentation", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    const parentId = await adapter.createTask({ name: "Parent", projectId: projId as ProjectId });
    await adapter.createTask({ name: "Child", parentId: parentId });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("\t- Parent");
    expect(result.taskpaper).toContain("\t\t- Child");
  });

  it("includes plain note as indented continuation", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "Task", projectId: projId as ProjectId, note: "My note" });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.taskpaper).toContain("My note");
  });

  it("emits lossiness warning when task has HTML note but no plain note", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({
      name: "Rich",
      projectId: projId as ProjectId,
      noteHtml: "<b>bold</b>",
    });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/HTML note downgraded/);
  });

  it("returns no warnings for a clean project", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "Clean", projectId: projId as ProjectId });

    const result = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// importTaskPaper — basic creation
// ---------------------------------------------------------------------------

describe("ExportService.importTaskPaper — basic creation", () => {
  it("throws ValidationError on empty text", async () => {
    const { service } = makeService();
    await expect(service.importTaskPaper("   ")).rejects.toThrow();
  });

  it("creates a single task from one line", async () => {
    const { adapter, service } = makeService();
    const result = await service.importTaskPaper("- My task");
    expect(result.created).toHaveLength(1);
    expect(result.warnings).toEqual([]);

    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.name).toBe("My task");
  });

  it("creates multiple top-level tasks", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Task A\n- Task B\n- Task C");
    const tasks = await adapter.listTasks({});
    expect(tasks.map((t) => t.name)).toContain("Task A");
    expect(tasks.map((t) => t.name)).toContain("Task B");
    expect(tasks.map((t) => t.name)).toContain("Task C");
  });

  it("creates subtasks nested under their parent", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Parent\n\t- Child");
    const tasks = await adapter.listTasks({});
    const parent = tasks.find((t) => t.name === "Parent");
    const child = tasks.find((t) => t.name === "Child");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentId).toBe(parent?.id);
  });
});

// ---------------------------------------------------------------------------
// importTaskPaper — tag parsing
// ---------------------------------------------------------------------------

describe("ExportService.importTaskPaper — @due/@defer/@flagged/@done", () => {
  it("parses @due(date) into dueDate", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Urgent @due(2026-06-01)");
    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.dueDate).toBe("2026-06-01T00:00:00Z");
  });

  it("parses @defer(date) into deferDate", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Later @defer(2026-05-15)");
    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.deferDate).toBe("2026-05-15T00:00:00Z");
  });

  it("parses @flagged", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Priority @flagged");
    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.flagged).toBe(true);
  });

  it("marks task as completed when @done is present", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Finished @done");
    const tasks = await adapter.listTasks({ completed: true });
    expect(tasks.some((t) => t.name === "Finished")).toBe(true);
  });

  it("emits a warning for unrecognised date format", async () => {
    const { adapter, service } = makeService();
    const result = await service.importTaskPaper("- Task @due(next-week)");
    // Task still created; warning emitted
    expect(result.created).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("due"))).toBe(true);

    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.dueDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// importTaskPaper — tag name resolution
// ---------------------------------------------------------------------------

describe("ExportService.importTaskPaper — tag resolution", () => {
  it("reuses an existing tag when name matches (case-insensitive)", async () => {
    const { adapter, service } = makeService();
    const existingTagId = await adapter.createTag({ name: "Work" });

    await service.importTaskPaper("- Task @Work");
    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.tagIds).toContain(existingTagId);
  });

  it("creates a new tag when name is unknown", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Task @NewTag");

    const tags = await adapter.listTags();
    expect(tags.some((t) => t.name === "NewTag")).toBe(true);
  });

  it("assigns the new tag to the imported task", async () => {
    const { adapter, service } = makeService();
    await service.importTaskPaper("- Task @Shiny");

    const tags = await adapter.listTags();
    const tag = tags.find((t) => t.name === "Shiny");
    const tasks = await adapter.listTasks({});
    expect(tasks[0]?.tagIds).toContain(tag?.id);
  });
});

// ---------------------------------------------------------------------------
// importTaskPaper — project heading
// ---------------------------------------------------------------------------

describe("ExportService.importTaskPaper — project headings", () => {
  it("assigns tasks to a matching existing project", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "Alpha" });

    await service.importTaskPaper("Alpha:\n- Task in alpha");
    const tasks = await adapter.listTasks({ projectId: projId as ProjectId });
    expect(tasks.some((t) => t.name === "Task in alpha")).toBe(true);
  });

  it("falls back to inbox and emits a warning for unknown project", async () => {
    const { adapter, service } = makeService();
    const result = await service.importTaskPaper("Ghost Project:\n- Task");
    expect(result.warnings.some((w) => w.includes("Ghost Project"))).toBe(true);

    const tasks = await adapter.listTasks({});
    const task = tasks.find((t) => t.name === "Task");
    expect(task?.projectId).toBeNull();
  });

  it("targetProjectId overrides project headings in the text", async () => {
    const { adapter, service } = makeService();
    const projA = await adapter.createProject({ name: "A" });
    const projB = await adapter.createProject({ name: "B" });

    await service.importTaskPaper("A:\n- Task", projB as ProjectId);
    const tasksInB = await adapter.listTasks({ projectId: projB as ProjectId });
    expect(tasksInB.some((t) => t.name === "Task")).toBe(true);
    const tasksInA = await adapter.listTasks({ projectId: projA as ProjectId });
    expect(tasksInA.some((t) => t.name === "Task")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("ExportService — round-trip (export → import)", () => {
  it("preserves task names and project structure through a round-trip", async () => {
    const { adapter, service } = makeService();
    const projId = await adapter.createProject({ name: "RT" });
    await adapter.createTask({ name: "Alpha", projectId: projId as ProjectId });
    await adapter.createTask({ name: "Beta", projectId: projId as ProjectId, flagged: true });

    const exported = await service.exportTaskPaper({ kind: "project", id: projId as ProjectId });

    // Import into a fresh project
    const proj2 = await adapter.createProject({ name: "RT2" });
    await service.importTaskPaper(exported.taskpaper, proj2 as ProjectId);

    const tasks = await adapter.listTasks({ projectId: proj2 as ProjectId });
    expect(tasks.map((t) => t.name)).toContain("Alpha");
    expect(tasks.map((t) => t.name)).toContain("Beta");
    const beta = tasks.find((t) => t.name === "Beta");
    expect(beta?.flagged).toBe(true);
  });
});
