/**
 * Unit tests for partitionTasksByParent.
 *
 * Covers two real-world parentId shapes:
 *   1. In-memory / test fixture shape  — top-level tasks have parentId: null
 *   2. Real OmniFocus shape            — top-level tasks have parentId: projectId
 *
 * The bug fixed by #499: the old implementation only checked `parentId === null`,
 * so real OF tasks (parentId === projectId) were all treated as non-root and
 * the export rendered only the project header with no tasks.
 */

import { describe, expect, it } from "vitest";
import type { TaskId } from "../../domain/ids.js";
import { ProjectId as ProjectIdCtor, TaskId as TaskIdCtor } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { partitionTasksByParent } from "./tree.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-01-01T00:00:00.000Z";

// Real OF IDs are 3-64 alphanumeric / _ / - characters.
const IDS = {
  proj: ProjectIdCtor.of("proj-abc"),
  t1: TaskIdCtor.of("task-aaa"),
  t2: TaskIdCtor.of("task-bbb"),
  t3: TaskIdCtor.of("task-ccc"),
  bug: ProjectIdCtor.of("dWSBU3hkJ8h"),
};

function makeTask(overrides: Partial<Task> & { id: TaskId }): Task {
  return {
    name: "Task",
    note: null,
    noteHtml: null,
    projectId: null,
    parentId: null,
    tagIds: [],
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    flagged: false,
    completed: false,
    completedAt: null,
    dropped: false,
    droppedAt: null,
    available: true,
    blocked: false,
    sequential: false,
    completedByChildren: false,
    repetition: null,
    createdAt: NOW,
    modifiedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — in-memory fixture shape (parentId: null for top-level tasks)
// ---------------------------------------------------------------------------

describe("partitionTasksByParent — in-memory fixture shape", () => {
  it("treats null-parentId tasks as roots", () => {
    const a = makeTask({ id: IDS.t1, name: "A" });
    const b = makeTask({ id: IDS.t2, name: "B" });

    const { rootTasks, byParent } = partitionTasksByParent([a, b]);

    expect(rootTasks).toHaveLength(2);
    expect(byParent.size).toBe(0);
  });

  it("places children under their parent", () => {
    const parent = makeTask({ id: IDS.t1, name: "Parent" });
    const child = makeTask({ id: IDS.t2, name: "Child", parentId: IDS.t1 });

    const { rootTasks, byParent } = partitionTasksByParent([parent, child]);

    expect(rootTasks).toHaveLength(1);
    expect(rootTasks[0]?.id).toBe(IDS.t1);
    expect(byParent.get(String(IDS.t1))).toHaveLength(1);
    expect(byParent.get(String(IDS.t1))?.[0]?.id).toBe(IDS.t2);
  });

  it("handles empty list", () => {
    const { rootTasks, byParent } = partitionTasksByParent([]);
    expect(rootTasks).toHaveLength(0);
    expect(byParent.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — real OmniFocus shape (parentId: projectId for top-level tasks)
// This is the bug fixed by #499.
// ---------------------------------------------------------------------------

describe("partitionTasksByParent — real OmniFocus shape", () => {
  it("treats tasks whose parentId equals projectId (not in task set) as roots", () => {
    // Real OF shape: top-level tasks reference the project as parent.
    // ProjectId and TaskId share the same branded-string format.
    const projAsParent = IDS.proj as unknown as TaskId;
    const taskA = makeTask({ id: IDS.t1, name: "A", parentId: projAsParent });
    const taskB = makeTask({ id: IDS.t2, name: "B", parentId: projAsParent });

    const { rootTasks, byParent } = partitionTasksByParent([taskA, taskB]);

    expect(rootTasks).toHaveLength(2);
    expect(byParent.size).toBe(0);
  });

  it("correctly roots project-level tasks while nesting their subtasks", () => {
    const projAsParent = IDS.proj as unknown as TaskId;

    // t1 and t2 are directly under the project; t3 is a subtask of t1
    const t1 = makeTask({ id: IDS.t1, name: "Root A", parentId: projAsParent });
    const t2 = makeTask({ id: IDS.t2, name: "Root B", parentId: projAsParent });
    const t3 = makeTask({ id: IDS.t3, name: "Child of A", parentId: IDS.t1 });

    const { rootTasks, byParent } = partitionTasksByParent([t1, t2, t3]);

    expect(rootTasks).toHaveLength(2);
    expect(rootTasks.map((t) => t.id)).toContain(IDS.t1);
    expect(rootTasks.map((t) => t.id)).toContain(IDS.t2);

    expect(byParent.get(String(IDS.t1))).toHaveLength(1);
    expect(byParent.get(String(IDS.t1))?.[0]?.id).toBe(IDS.t3);
  });

  it("handles 38-task project — regression for the exact shape from bug report", () => {
    // Bug report: task_list returns 38 tasks each with parentId = projectId.
    // Old implementation: rootTasks was empty → export rendered only the header line.
    // New implementation: all 38 should be roots.
    const projAsParent = IDS.bug as unknown as TaskId;
    const tasks = Array.from({ length: 38 }, (_, i) =>
      makeTask({
        id: TaskIdCtor.of(`bug-task-${String(i).padStart(2, "0")}`),
        name: `Task ${i}`,
        parentId: projAsParent,
      }),
    );

    const { rootTasks, byParent } = partitionTasksByParent(tasks);

    expect(rootTasks).toHaveLength(38);
    expect(byParent.size).toBe(0);
  });
});
