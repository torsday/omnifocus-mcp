/**
 * JXA: create a new task.
 *
 * Args (argv[0] JSON): {
 *   name: string, projectId?: string|null, parentId?: string|null,
 *   note?: string|null, flagged?: boolean, deferDate?: string|null,
 *   dueDate?: string|null, estimatedMinutes?: number|null,
 *   tagIds?: string[], sequential?: boolean, completedByChildren?: boolean
 * }
 * Returns JSON: { task: Task }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  function buildRepetition(task) {
    try {
      const rr = task.repetitionRule();
      if (!rr) return null;
      return {
        method: rr.method(),
        unit: rr.unit(),
        steps: rr.steps(),
      };
    } catch (_e) {
      return null;
    }
  }

  function buildTask(task) {
    // See task_get.js — `cp.class()` throws on real projects in OF 4.x
    // (#673). Treat a throw as "real project", a successful return as
    // "document — skip".
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
        tagIds.push(tags[i].id());
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

    let estimatedMinutes = null;
    try {
      const em = task.estimatedMinutes();
      if (em != null) estimatedMinutes = em;
    } catch (_e) {}

    let note = null;
    try {
      note = task.note() || null;
    } catch (_e) {}

    let noteHtml = null;
    try {
      if (task.noteHtml) noteHtml = task.noteHtml() || null;
    } catch (_e) {}

    let flagged = false;
    try {
      flagged = task.flagged();
    } catch (_e) {}

    let completed = false;
    try {
      completed = task.completed();
    } catch (_e) {}

    let sequential = false;
    try {
      sequential = task.sequential();
    } catch (_e) {}

    let completedByChildren = false;
    try {
      completedByChildren = task.containsSingletonActions();
    } catch (_e) {}

    let available = false;
    try {
      available = task.available();
    } catch (_e) {}

    let blocked = false;
    try {
      blocked = task.blocked();
    } catch (_e) {}

    return {
      id: task.id(),
      name: task.name(),
      note: note,
      noteHtml: noteHtml,
      projectId: projectId,
      parentId: parentId,
      tagIds: tagIds,
      deferDate: deferDate,
      dueDate: dueDate,
      estimatedMinutes: estimatedMinutes,
      flagged: flagged,
      completed: completed,
      completedAt: completedAt,
      dropped: dropped,
      droppedAt: null,
      available: available,
      blocked: blocked,
      sequential: sequential,
      completedByChildren: completedByChildren,
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

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }
  if (args.projectId != null && args.parentId != null) {
    throw new Error("ValidationError: projectId and parentId are mutually exclusive");
  }

  const props = { name: args.name };
  if (args.note != null) props.note = args.note;
  if (args.flagged != null) props.flagged = args.flagged;
  if (args.deferDate != null) props.deferDate = new Date(args.deferDate);
  if (args.dueDate != null) props.dueDate = new Date(args.dueDate);
  if (args.estimatedMinutes != null) props.estimatedMinutes = args.estimatedMinutes;
  if (args.sequential != null) props.sequential = args.sequential;

  // OmniFocus 4.x rejects `container.make({ new: "task", withProperties })` with
  // error -10024 ("Can't make or move that element into that container").
  // The working pattern mirrors the inbox-task fix in #275 and the
  // project/folder/tag fix in #319: construct a specifier via the class name
  // and push it onto the target collection.
  // JXA's `byId(...)` returns a lazy specifier that's always truthy; the
  // actual lookup happens on the first method call (#674). Force it early
  // by calling `.id()` so a missing target produces a structured
  // "X not found: <id>" message that the classifier maps to NotFound, not
  // an opaque "Can't get object. (-1728)" surfaced as ScriptError.
  let newTask;
  if (args.parentId) {
    const parent = ofApp.defaultDocument.flattenedTasks.byId(args.parentId);
    try {
      parent.id();
    } catch (_e) {
      throw new Error(`Parent task not found: ${args.parentId}`);
    }
    newTask = ofApp.Task(props);
    parent.tasks.push(newTask);
  } else if (args.projectId) {
    const proj = ofApp.defaultDocument.flattenedProjects.byId(args.projectId);
    try {
      proj.id();
    } catch (_e) {
      throw new Error(`Project not found: ${args.projectId}`);
    }
    newTask = ofApp.Task(props);
    proj.tasks.push(newTask);
  } else {
    // Inbox tasks cannot be created via `doc.make({ new: "inboxTask" })` —
    // OmniFocus 4.x rejects that with error -10024. Construct an InboxTask
    // specifier and push it onto `doc.inboxTasks`; the reference stays
    // usable and exposes `.id()` for the read-back (see issue #275).
    newTask = ofApp.InboxTask(props);
    ofApp.defaultDocument.inboxTasks.push(newTask);
  }

  if (args.tagIds) {
    for (let i = 0; i < args.tagIds.length; i++) {
      try {
        const tag = ofApp.defaultDocument.flattenedTags.byId(args.tagIds[i]);
        newTask.addTag(tag);
      } catch (_e) {}
    }
  }

  if (args.completedByChildren != null) {
    try {
      newTask.containsSingletonActions = args.completedByChildren;
    } catch (_e) {}
  }

  // Re-fetch via a stable specifier for projectId/parentId branches.
  // After push(), calling containingProject() / parentTask() on the pushed
  // specifier returns stale null data until the JXA bridge flushes deferred
  // events. .id() is safe immediately; all other properties require re-fetch.
  if (args.parentId || args.projectId) {
    const taskId = newTask.id();
    const fetchedTask = ofApp.defaultDocument.flattenedTasks.byId(taskId);
    return JSON.stringify({ task: buildTask(fetchedTask) });
  }
  return JSON.stringify({ task: buildTask(newTask) });
}
