/**
 * JXA: search tasks by keyword and/or structured filters.
 *
 * Args (argv[0] JSON): {
 *   q?: string,                    // optional keyword (case-insensitive)
 *   scope?: "name"|"note"|"all",   // which fields to search (default "all")
 *   projectId?: string|null,
 *   tagIds?: string[]|null,        // task must carry ALL listed tags
 *   available?: boolean|null,      // true = available tasks only
 *   dueBefore?: string|null,       // ISO-8601 upper bound (exclusive)
 *   dueAfter?: string|null,        // ISO-8601 lower bound (exclusive)
 *   flagged?: boolean|null,
 *   completed?: "any"|"only"|"exclude"|null   // default "exclude"
 * }
 * Returns JSON: { tasks: Task[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — searchTasks() caller
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const q = args.q ? args.q.toLowerCase() : null;
  const scope = args.scope || "all";
  const completed =
    args.completed !== undefined && args.completed !== null ? args.completed : "exclude";
  const dueBefore = args.dueBefore ? new Date(args.dueBefore) : null;
  const dueAfter = args.dueAfter ? new Date(args.dueAfter) : null;

  // ---------------------------------------------------------------------------
  // buildTask — same shape as task_list.js
  // ---------------------------------------------------------------------------

  function buildRepetition(task) {
    try {
      const rr = task.repetitionRule();
      if (!rr) return null;
      return { method: rr.method(), unit: rr.unit(), steps: rr.steps() };
    } catch (_e) {
      return null;
    }
  }

  function buildTask(task) {
    // See task_get.js — `cp.class()` throws on real projects in OF 4.x (#673).
    let projectId = null;
    try {
      const cp = task.containingProject();
      if (cp) {
        let isDocument = false;
        try {
          isDocument = cp.class() === "document";
        } catch (_classErr) {
          /* OF 4.x: real projects throw here */
        }
        if (!isDocument) projectId = cp.id();
      }
    } catch (_e) {}

    let parentId = null;
    try {
      const pt = task.parentTask();
      if (pt) parentId = pt.id();
    } catch (_e) {}

    const tagIds = [];
    try {
      const tags = task.tags();
      for (let i = 0; i < tags.length; i++) {
        try {
          tagIds.push(tags[i].id());
        } catch (_tagErr) {}
      }
    } catch (_e) {}

    let deferDate = null;
    try {
      const dd = task.deferDate();
      if (dd) deferDate = dd.toISOString();
    } catch (_e) {}

    let dueDate = null;
    try {
      const due = task.dueDate();
      if (due) dueDate = due.toISOString();
    } catch (_e) {}

    let completedAt = null;
    try {
      const cd = task.completionDate();
      if (cd) completedAt = cd.toISOString();
    } catch (_e) {}

    let dropped = false;
    try {
      dropped = task.dropped();
    } catch (_e) {}

    let flagged = false;
    try {
      flagged = task.flagged();
    } catch (_e) {}

    let isCompleted = false;
    try {
      isCompleted = task.completed();
    } catch (_e) {}

    let available = false;
    try {
      available = task.effectivelyAvailable ? task.effectivelyAvailable() : false;
    } catch (_e) {}

    let blocked = false;
    try {
      blocked = task.blocked ? task.blocked() : false;
    } catch (_e) {}

    let sequential = false;
    try {
      sequential = task.sequential ? task.sequential() : false;
    } catch (_e) {}

    let completedByChildren = false;
    try {
      completedByChildren = task.completedByChildren ? task.completedByChildren() : false;
    } catch (_e) {}

    let note = "";
    try {
      note = task.note ? task.note() : "";
    } catch (_e) {}

    return {
      id: task.id(),
      name: task.name(),
      note: note || null,
      noteHtml: null,
      projectId,
      parentId,
      tagIds,
      flagged,
      dueDate,
      deferDate,
      completedAt,
      droppedAt: null,
      completed: isCompleted,
      dropped,
      available,
      blocked,
      sequential,
      completedByChildren,
      estimatedMinutes: null,
      repetition: buildRepetition(task),
      // Guard against "Can't get object." thrown when invoking these — see #498.

      createdAt: (() => {
        try {
          return task.creationDate().toISOString();
        } catch (_e) {
          return new Date().toISOString();
        }
      })(),

      modifiedAt: (() => {
        try {
          return task.modificationDate().toISOString();
        } catch (_e) {
          return new Date().toISOString();
        }
      })(),
    };
  }

  // ---------------------------------------------------------------------------
  // Collect candidate tasks
  // ---------------------------------------------------------------------------

  let tasks;
  if (args.projectId) {
    try {
      tasks = ofApp.defaultDocument.flattenedProjects.byId(args.projectId).flattenedTasks();
    } catch (_e) {
      throw new Error(`Project not found: ${args.projectId}`);
    }
  } else {
    tasks = ofApp.defaultDocument.flattenedTasks();
  }

  // ---------------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------------

  const result = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const built = buildTask(t);

    // Completion filter
    if (completed === "exclude" && built.completed) continue;
    if (completed === "only" && !built.completed) continue;
    // "any" passes through both

    // Available filter
    if (args.available === true && !built.available) continue;
    if (args.available === false && built.available) continue;

    // Flagged filter
    if (args.flagged !== null && args.flagged !== undefined && built.flagged !== args.flagged)
      continue;

    // Due date range filters
    if (dueBefore !== null || dueAfter !== null) {
      if (!built.dueDate) continue; // tasks with no due date never match a date filter
      const due = new Date(built.dueDate);
      if (dueBefore !== null && due >= dueBefore) continue;
      if (dueAfter !== null && due <= dueAfter) continue;
    }

    // Tag filter — task must carry ALL listed tags
    if (args.tagIds && args.tagIds.length > 0) {
      const allPresent = args.tagIds.every((tid) => built.tagIds.includes(tid));
      if (!allPresent) continue;
    }

    // Text search (only applied when q is provided)
    if (q) {
      const nameMatch = built.name.toLowerCase().includes(q);
      const noteMatch = built.note ? built.note.toLowerCase().includes(q) : false;
      const matches =
        scope === "name" ? nameMatch : scope === "note" ? noteMatch : nameMatch || noteMatch; // "all"
      if (!matches) continue;
    }

    result.push(built);
  }

  return JSON.stringify({ tasks: result });
}
