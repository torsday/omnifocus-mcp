import { describe, expect, it } from "vitest";
import { ProjectId, TaskId } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";
import { partitionTasksByParent } from "./tree.js";

/**
 * Minimal Task fixture — only the fields `partitionTasksByParent` reads. The
 * full `Task` shape carries dozens of fields; copying them all just to test
 * tree partitioning would be noise.
 */
function task(id: string, parentId: string | null): Task {
  return {
    id: TaskId.of(id),
    name: id,
    parentId: parentId === null ? null : (parentId as Task["parentId"]),
    projectId: null,
    note: null,
    flagged: false,
    completed: false,
    completedAt: null,
    dropped: false,
    droppedAt: null,
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    sequential: false,
    completedByChildren: false,
    creationDate: new Date().toISOString(),
    modificationDate: new Date().toISOString(),
    tags: [],
    repetition: null,
  } as unknown as Task;
}

describe("partitionTasksByParent", () => {
  it("treats null-parent tasks as roots (inbox case)", () => {
    const tasks = [task("aaa", null), task("bbb", null)];
    const { rootTasks, byParent } = partitionTasksByParent(tasks);
    expect(rootTasks.map((t) => t.id)).toEqual(["aaa", "bbb"]);
    expect(byParent.size).toBe(0);
  });

  it("groups children under their parent task", () => {
    const tasks = [task("root", null), task("kid1", "root"), task("kid2", "root")];
    const { rootTasks, byParent } = partitionTasksByParent(tasks);
    expect(rootTasks.map((t) => t.id)).toEqual(["root"]);
    expect(byParent.get("root")?.map((t) => t.id)).toEqual(["kid1", "kid2"]);
  });

  // Regression — #499. Real OmniFocus data: top-level tasks of a project
  // carry `parentId === <projectId>` rather than `parentId === null`. The
  // previous partition logic only treated null-parent tasks as roots, so
  // every project-rooted task was silently dropped from the tree, every
  // export rendered an empty body despite a non-zero taskCount.
  it("treats project-rooted tasks (parentId not in set) as roots — #499", () => {
    const projectId = ProjectId.of("dWSBU3hkJ8h");
    const tasks = [task("topA", projectId), task("topB", projectId), task("childA1", "topA")];
    const { rootTasks, byParent } = partitionTasksByParent(tasks);
    expect(rootTasks.map((t) => t.id)).toEqual(["topA", "topB"]);
    expect(byParent.get("topA")?.map((t) => t.id)).toEqual(["childA1"]);
    // The project ID must NOT appear as a parent key — it's not in the set.
    expect(byParent.has(projectId)).toBe(false);
  });

  it("treats tasks whose parent is missing from the set as roots", () => {
    // Defensive: if a child somehow appears without its parent (pagination
    // boundary, filtered fetch), treat it as root rather than silently
    // dropping it. The renderer surfaces orphaned subtrees instead of
    // returning an empty body.
    const tasks = [task("orphan", "missing-parent"), task("child", "orphan")];
    const { rootTasks, byParent } = partitionTasksByParent(tasks);
    expect(rootTasks.map((t) => t.id)).toEqual(["orphan"]);
    expect(byParent.get("orphan")?.map((t) => t.id)).toEqual(["child"]);
  });

  it("handles empty input cleanly", () => {
    const { rootTasks, byParent } = partitionTasksByParent([]);
    expect(rootTasks).toEqual([]);
    expect(byParent.size).toBe(0);
  });

  it("preserves input order within each bucket", () => {
    const tasks = [
      task("par", null),
      task("kid2", "par"),
      task("kid1", "par"),
      task("kid3", "par"),
    ];
    const { byParent } = partitionTasksByParent(tasks);
    expect(byParent.get("par")?.map((t) => t.id)).toEqual(["kid2", "kid1", "kid3"]);
  });
});
