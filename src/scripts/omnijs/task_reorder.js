/**
 * OmniJS: reorder a task among its siblings.
 *
 * JXA's `task.move({ to: ref, positioned: ... })` shares the same broken
 * code path as `task.move({ to: container })` — both throw error 9
 * ("Replacement not supported currently") in OmniFocus 4.x. The OmniJS
 * `Database.moveTasks(tasks, ChildInsertionLocation)` API supports precise
 * sibling positioning via `.before` / `.after` / `.beginning` / `.ending`
 * and is the Omni-recommended automation route — hence this script.
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     id: string,               // task to reorder
 *     mode: "before" | "after" | "start" | "end",
 *     refId?: string,           // required for before/after
 *     container?: {             // required for start/end
 *       projectId?: string,
 *       parentId?: string,
 *       inbox?: true,
 *     }
 *   }
 *
 * Returns JSON: { id: string }
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — reorderTask() caller
 * @see docs/spikes/2026-04-task-reorder.md — Route A vs Route B rationale
 * @see docs/adr/0002-omnifocus-transport-dual.md — JXA/OmniJS split
 */
(() => {
  const { id, mode, refId, container } = globalThis.__args;

  if (!id) {
    return JSON.stringify({ error: { code: "VALIDATION", message: "id is required" } });
  }
  if (!mode) {
    return JSON.stringify({ error: { code: "VALIDATION", message: "mode is required" } });
  }

  const task = flattenedTasks.filter((t) => t.id.primaryKey === id)[0];
  if (!task) {
    return JSON.stringify({ error: { code: "NOT_FOUND", message: `Task not found: ${id}` } });
  }

  let location;

  if (mode === "before" || mode === "after") {
    if (!refId) {
      return JSON.stringify({
        error: { code: "VALIDATION", message: `refId is required for mode "${mode}"` },
      });
    }
    const ref = flattenedTasks.filter((t) => t.id.primaryKey === refId)[0];
    if (!ref) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Reference task not found: ${refId}` },
      });
    }
    location = mode === "before" ? ref.before : ref.after;
  } else if (mode === "start" || mode === "end") {
    let c;
    if (container?.projectId) {
      c = flattenedProjects.filter((p) => p.id.primaryKey === container.projectId)[0];
      if (!c) {
        return JSON.stringify({
          error: { code: "NOT_FOUND", message: `Project not found: ${container.projectId}` },
        });
      }
    } else if (container?.parentId) {
      c = flattenedTasks.filter((t) => t.id.primaryKey === container.parentId)[0];
      if (!c) {
        return JSON.stringify({
          error: { code: "NOT_FOUND", message: `Parent task not found: ${container.parentId}` },
        });
      }
    } else {
      // inbox.beginning / inbox.ending
      c = inbox;
    }
    location = mode === "start" ? c.beginning : c.ending;
  } else {
    return JSON.stringify({
      error: { code: "VALIDATION", message: `Unknown mode: ${mode}` },
    });
  }

  moveTasks([task], location);
  return JSON.stringify({ id });
})();
