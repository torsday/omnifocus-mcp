/**
 * Task-tree helpers shared by the export formats.
 *
 * Both OPML and TaskPaper rendering walk a project's tasks as a parent/child
 * tree. The two operations needed — fetching the full descendant set from the
 * adapter and partitioning a flat list into root/children — are format-
 * agnostic and belong here rather than duplicated in each format module.
 *
 * @see src/services/export/opml.ts
 * @see src/services/export/taskpaper.ts
 */

import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ProjectId } from "../../domain/ids.js";
import type { Task } from "../../domain/task.js";

/**
 * Fetch ALL tasks belonging to a project, including subtasks at every depth.
 *
 * `adapter.listTasks({ projectId })` only returns tasks whose `projectId`
 * field equals the given ID — subtasks (which carry `parentId` but have
 * `projectId: null`) are excluded. This helper does a BFS expansion to
 * collect every descendant.
 */
export async function fetchProjectTaskTree(
  adapter: OmniFocusAdapter,
  projectId: ProjectId,
): Promise<Task[]> {
  // Fetch root-level tasks (directly in the project)
  const direct = await adapter.listTasks({ projectId });
  const all: Task[] = [...direct];

  // BFS: for each task, fetch its children. `for (;;)` with break-on-empty
  // keeps `current` narrowed to Task without needing a non-null assertion
  // on `queue.shift()`.
  const queue: Task[] = [...direct];
  for (;;) {
    const current = queue.shift();
    if (current === undefined) break;
    const children = await adapter.listTasks({ parentId: current.id });
    for (const child of children) {
      all.push(child);
      queue.push(child);
    }
  }

  return all;
}

/**
 * Partition a flat task list into root tasks and a `parentId → children` map.
 *
 * A task is a root when its `parentId` is absent from the task set — either
 * because `parentId` is `null` (inbox tasks) or because the parent ID belongs
 * to a project rather than another task in the list (OmniFocus top-level
 * tasks carry `parentId === projectId`).
 *
 * Using set membership instead of a null-check makes this robust to both the
 * in-memory fixture shape (`parentId: null`) and real OmniFocus data
 * (`parentId: "<projectId>"`).
 *
 * The map indexes children by their stringified parent ID so recursive
 * renderers can look up a given task's children in O(1).
 */
export function partitionTasksByParent(tasks: Task[]): {
  rootTasks: Task[];
  byParent: Map<string, Task[]>;
} {
  const taskIds = new Set(tasks.map((t) => String(t.id)));
  const rootTasks: Task[] = [];
  const byParent = new Map<string, Task[]>();

  for (const task of tasks) {
    const isRoot = task.parentId === null || !taskIds.has(String(task.parentId));
    if (isRoot) {
      rootTasks.push(task);
    } else {
      const key = String(task.parentId);
      const existing = byParent.get(key);
      if (existing) {
        existing.push(task);
      } else {
        byParent.set(key, [task]);
      }
    }
  }

  return { rootTasks, byParent };
}
