/**
 * OmniJS: move a task to a different project, parent task, or the inbox.
 *
 * JXA's `task.move({ to: container })` is unimplemented in OmniFocus 4.x
 * (error 9 "Replacement not supported currently"). The OmniJS
 * `Database.moveTasks(tasks, location)` API performs genuine reparenting
 * while preserving the task's persistent ID — hence this script routes
 * through the OmniJS transport instead.
 *
 * Args injected as `globalThis.__args`:
 *   { id: string, projectId?: string|null, parentId?: string|null }
 *   Pass neither projectId nor parentId to move the task to the inbox.
 *
 * Returns JSON: { id: string }
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — moveTask() caller
 * @see docs/adr/0002-omnifocus-transport-dual.md — JXA/OmniJS split rationale
 */
(() => {
  const { id, projectId, parentId } = globalThis.__args;

  if (!id) {
    return JSON.stringify({ error: { code: "VALIDATION", message: "id is required" } });
  }

  const task = flattenedTasks.filter((t) => t.id.primaryKey === id)[0];
  if (!task) {
    return JSON.stringify({ error: { code: "NOT_FOUND", message: `Task not found: ${id}` } });
  }

  if (parentId != null) {
    // Move under a parent task.
    const parent = flattenedTasks.filter((t) => t.id.primaryKey === parentId)[0];
    if (!parent) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Parent task not found: ${parentId}` },
      });
    }
    moveTasks([task], parent);
  } else if (projectId != null) {
    // Move into a project (as a top-level action of that project).
    const proj = flattenedProjects.filter((p) => p.id.primaryKey === projectId)[0];
    if (!proj) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Project not found: ${projectId}` },
      });
    }
    moveTasks([task], proj);
  } else {
    // No destination specified — move to inbox.
    // `inbox` alone is not a valid moveTasks position; use inbox.beginning.
    moveTasks([task], inbox.beginning);
  }

  return JSON.stringify({ id });
})();
