/**
 * OmniJS: duplicate a task. Editable fields copy; completed/dropped state
 * reset on every clone. When `recursive: true`, the entire subtree is
 * cloned via `duplicateTasks(...)` (preserves order); otherwise the clone
 * is a single fresh task with copied props (no children).
 *
 * Routes through OmniJS rather than JXA per ADR-0019: JXA's
 * `task.duplicate()` and `container.make({...})` operate on transient
 * specifier IDs that don't match OmniFocus's persistent `id.primaryKey`,
 * so subsequent OmniJS reads of the clone fail. OmniJS's
 * `duplicateTasks([source], position)` and `new Task(name, position)`
 * return tasks whose IDs are interoperable with both transports.
 *
 * Sibling of `task_create.js` (#680) and `project_create.js` (#681).
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     id: string,                                   // source task id
 *     recursive: boolean,                           // clone subtree
 *     destination?: {
 *       projectId?: string,                         // top-level of project
 *       parentId?: string,                          // child of parent task
 *       toInbox?: true,                             // inbox
 *     }
 *     // No destination → "alongside source": prefer source.parent task,
 *     // else source.containingProject, else inbox.
 *   }
 *
 * Returns JSON: { newId: string, descendantCount: number }
 *
 * @see src/scripts/jxa/task_duplicate.js — predecessor
 * @see src/adapter/omnijs/OmniJsTransport.ts — caller
 * @see docs/adr/0019-cross-transport-id-interoperability.md — routing rationale
 */
(() => {
  const args = globalThis.__args;

  if (!args.id) {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "id is required" },
    });
  }

  const source = flattenedTasks.filter((t) => t.id.primaryKey === args.id)[0];
  if (!source) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Task not found: ${args.id}` },
    });
  }

  // Resolve destination placement.
  let position;
  if (args.destination?.projectId) {
    const proj = flattenedProjects.filter((p) => p.id.primaryKey === args.destination.projectId)[0];
    if (!proj) {
      return JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: `Project not found: ${args.destination.projectId}`,
        },
      });
    }
    position = proj.ending;
  } else if (args.destination?.parentId) {
    const parent = flattenedTasks.filter((t) => t.id.primaryKey === args.destination.parentId)[0];
    if (!parent) {
      return JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: `Parent task not found: ${args.destination.parentId}`,
        },
      });
    }
    position = parent.ending;
  } else if (args.destination && args.destination.toInbox === true) {
    position = inbox.ending;
  } else {
    // Default: alongside source. Prefer the source's parent task (if it's a
    // real task, not the project's wrapper), then containing project, then
    // inbox. Mirrors task_duplicate.js's JXA fallback chain.
    const containingProj = source.containingProject;
    const parentTask = source.parent;
    const parentIsProjectWrapper =
      parentTask &&
      containingProj &&
      parentTask.id.primaryKey === containingProj.task.id.primaryKey;
    if (parentTask && !parentIsProjectWrapper) {
      position = parentTask.ending;
    } else if (containingProj) {
      position = containingProj.ending;
    } else {
      position = inbox.ending;
    }
  }

  // Reset completion state on a cloned task. OmniJS's `duplicateTasks`
  // preserves the source's completed flag, but the JXA contract — and this
  // tool's contract — is to produce an uncompleted clone (the user
  // duplicates a finished task to do it again). Walk the subtree and clear.
  function resetSubtree(task) {
    if (task.completed) {
      task.markIncomplete();
    }
    if (task.children) {
      for (const child of task.children) {
        resetSubtree(child);
      }
    }
  }

  let newId;
  let descendantCount = 0;

  if (args.recursive) {
    // Subtree clone via OmniJS. `duplicateTasks` returns a TaskArray
    // whose elements are the new top-level clones (one per input).
    const result = duplicateTasks([source], position);
    const clone = result[0];
    if (!clone) {
      return JSON.stringify({
        error: { code: "VALIDATION", message: "duplicateTasks returned no clone" },
      });
    }
    resetSubtree(clone);
    // descendantCount = total descendants under the clone. On a Task,
    // `flattenedTasks` returns descendants only (NOT self) — no subtraction.
    descendantCount = clone.flattenedTasks?.length ?? 0;
    newId = clone.id.primaryKey;
  } else {
    // Non-recursive: build a fresh single task with copied editable props
    // (no children). Naturally produces an uncompleted clone — no
    // reset-completion call needed for the root.
    const clone = new Task(source.name, position);
    if (source.note) clone.note = source.note;
    clone.flagged = source.flagged;
    if (source.deferDate) clone.deferDate = source.deferDate;
    if (source.dueDate) clone.dueDate = source.dueDate;
    if (source.estimatedMinutes != null) {
      clone.estimatedMinutes = source.estimatedMinutes;
    }
    clone.sequential = source.sequential;
    // Tags
    if (source.tags) {
      for (const tag of source.tags) {
        clone.addTag(tag);
      }
    }
    newId = clone.id.primaryKey;
    descendantCount = 0;
  }

  return JSON.stringify({ newId, descendantCount });
})();
