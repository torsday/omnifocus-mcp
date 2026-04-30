/**
 * JXA: list tasks, optionally filtered.
 *
 * Args (argv[0] JSON): {
 *   projectId?: string|null, tagId?: string|null, parentId?: string|null,
 *   flagged?: boolean|null, available?: boolean|null, blocked?: boolean|null,
 *   completed?: boolean|null, completedSince?: string|null,
 *   dueBefore?: string|null, dueAfter?: string|null,
 *   deferredBefore?: string|null, deferredAfter?: string|null
 * }
 * Returns JSON: { tasks: Task[] }
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
        // Guard per-element: a single bad tag object must not abort the loop
        // and zero-out all tagIds, which would silently exclude this task
        // from tagId-filter results (see #682).
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

    const droppedAt = null;
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

    // See #498 — JXA reports creationDate/modificationDate as truthy
    // functions even on tasks where invocation throws "Can't get object."
    // The call must be guarded, not just the property reference.
    let createdAt;
    try {
      createdAt = task.creationDate().toISOString();
    } catch (_e) {
      createdAt = new Date().toISOString();
    }
    let modifiedAt;
    try {
      modifiedAt = task.modificationDate().toISOString();
    } catch (_e) {
      modifiedAt = new Date().toISOString();
    }

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
      droppedAt: droppedAt,
      available: available,
      blocked: blocked,
      sequential: sequential,
      completedByChildren: completedByChildren,
      repetition: buildRepetition(task),
      createdAt: createdAt,
      modifiedAt: modifiedAt,
    };
  }

  let tasks;
  if (args.inbox) {
    // inboxTasks() returns only tasks with no project assignment — exactly the Inbox scope.
    tasks = ofApp.defaultDocument.inboxTasks();
  } else if (args.projectId) {
    try {
      tasks = ofApp.defaultDocument.flattenedProjects.byId(args.projectId).flattenedTasks();
    } catch (_e) {
      throw new Error(`Project not found: ${args.projectId}`);
    }
  } else if (args.parentId) {
    try {
      tasks = ofApp.defaultDocument.flattenedTasks.byId(args.parentId).flattenedTasks();
    } catch (_e) {
      throw new Error(`Parent task not found: ${args.parentId}`);
    }
  } else {
    tasks = ofApp.defaultDocument.flattenedTasks();
  }

  const completedSince = args.completedSince ? new Date(args.completedSince) : null;
  const dueBefore = args.dueBefore ? new Date(args.dueBefore) : null;
  const dueAfter = args.dueAfter ? new Date(args.dueAfter) : null;
  const deferredBefore = args.deferredBefore ? new Date(args.deferredBefore) : null;
  const deferredAfter = args.deferredAfter ? new Date(args.deferredAfter) : null;

  const result = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const built = buildTask(t);

    if (args.tagId !== null && args.tagId !== undefined) {
      if (!built.tagIds.includes(args.tagId)) continue;
    }
    if (args.flagged !== null && args.flagged !== undefined && built.flagged !== args.flagged)
      continue;
    if (
      args.available !== null &&
      args.available !== undefined &&
      built.available !== args.available
    )
      continue;
    if (args.blocked !== null && args.blocked !== undefined && built.blocked !== args.blocked)
      continue;
    if (
      args.completed !== null &&
      args.completed !== undefined &&
      built.completed !== args.completed
    )
      continue;
    if (completedSince && built.completedAt) {
      if (new Date(built.completedAt) < completedSince) continue;
    }
    if (dueBefore && built.dueDate) {
      if (new Date(built.dueDate) >= dueBefore) continue;
    }
    if (dueAfter && built.dueDate) {
      if (new Date(built.dueDate) <= dueAfter) continue;
    }
    if (deferredBefore && built.deferDate) {
      if (new Date(built.deferDate) >= deferredBefore) continue;
    }
    if (deferredAfter && built.deferDate) {
      if (new Date(built.deferDate) <= deferredAfter) continue;
    }

    result.push(built);
  }

  return JSON.stringify({ tasks: result });
}
