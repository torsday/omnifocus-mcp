/**
 * OmniJS: batch-move tasks to different destinations in a single round-trip.
 *
 * JXA's `task.move()` is unimplemented in OmniFocus 4.x (error 9 "Replacement
 * not supported currently"). The OmniJS `moveTasks(tasks, location)` API performs
 * genuine reparenting while preserving persistent IDs — hence this script routes
 * through OmniJS.
 *
 * Args injected as `globalThis.__args`:
 *   { items: Array<{ id: string, projectId?: string|null, parentId?: string|null }> }
 *   For each item: pass projectId to move into a project, parentId to move under a
 *   parent task, or neither to move to the inbox.
 *
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — batchMoveTasks() caller
 * @see src/scripts/omnijs/task_move.js — singular counterpart
 * @see docs/adr/0002-omnifocus-transport-dual.md — JXA/OmniJS split rationale
 */
(() => {
  const { items } = globalThis.__args;

  if (!items || !Array.isArray(items)) {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "items array is required" },
    });
  }

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const task = flattenedTasks.filter((t) => t.id.primaryKey === it.id)[0];
      if (!task) {
        failed.push({ index: i, errorCode: "OF_NOT_FOUND", message: `Task not found: ${it.id}` });
        continue;
      }

      if (it.parentId != null) {
        const parent = flattenedTasks.filter((t) => t.id.primaryKey === it.parentId)[0];
        if (!parent) {
          failed.push({
            index: i,
            errorCode: "OF_NOT_FOUND",
            message: `Parent task not found: ${it.parentId}`,
          });
          continue;
        }
        moveTasks([task], parent);
      } else if (it.projectId != null) {
        const proj = flattenedProjects.filter((p) => p.id.primaryKey === it.projectId)[0];
        if (!proj) {
          failed.push({
            index: i,
            errorCode: "OF_NOT_FOUND",
            message: `Project not found: ${it.projectId}`,
          });
          continue;
        }
        moveTasks([task], proj);
      } else {
        // No destination — move to inbox.
        moveTasks([task], inbox.beginning);
      }

      succeeded.push({ index: i, value: it.id });
    } catch (e) {
      const msg = String(e?.message ?? e);
      failed.push({ index: i, errorCode: "OF_UNKNOWN", message: msg });
    }
  }

  return JSON.stringify({ succeeded, failed });
})();
