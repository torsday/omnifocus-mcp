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
 * A task is a root if its `parentId` is null OR if its `parentId` does not
 * appear as the `id` of any other task in the input set. The latter case
 * matters for two reasons:
 *
 *   1. **Project-rooted tasks** (#499). OmniFocus's data model treats a
 *      project as a container task; top-level tasks of a project carry
 *      `parentId === <projectId>` rather than `parentId === null`. The
 *      project itself is never in the fetched task set, so those tasks
 *      surface as roots here. Without this rule, `export_taskpaper` returned
 *      `taskCount > 0` with an empty body for every real-database project.
 *
 *   2. **Defensive against fetch boundaries.** If a child appears without
 *      its parent (pagination, filtered fetch, race against a deletion),
 *      treat it as root rather than silently dropping it from the rendered
 *      tree.
 *
 * The map indexes children by their stringified parent ID, so recursive
 * renderers can look up a given task's children in O(1).
 */
export function partitionTasksByParent(tasks: Task[]): {
  rootTasks: Task[];
  byParent: Map<string, Task[]>;
} {
  // First pass: index every task ID present in the input set so the second
  // pass can recognize parentId references that point outside it.
  const idsInSet = new Set<string>();
  for (const task of tasks) {
    idsInSet.add(String(task.id));
  }

  const rootTasks: Task[] = [];
  const byParent = new Map<string, Task[]>();

  for (const task of tasks) {
    if (task.parentId === null || !idsInSet.has(String(task.parentId))) {
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
