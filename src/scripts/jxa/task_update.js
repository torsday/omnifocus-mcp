/**
 * JXA: update task fields.
 *
 * Args (argv[0] JSON): {
 *   id: string,
 *   name?: string, note?: string|null, flagged?: boolean,
 *   deferDate?: string|null, dueDate?: string|null,
 *   estimatedMinutes?: number|null, tagIds?: string[],
 *   sequential?: boolean, completedByChildren?: boolean
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
    let projectId = null;
    try {
      const cp = task.containingProject();
      if (cp && cp.class() !== "document") projectId = cp.id();
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
      createdAt: task.creationDate ? task.creationDate().toISOString() : new Date().toISOString(),
      modifiedAt: task.modificationDate
        ? task.modificationDate().toISOString()
        : new Date().toISOString(),
    };
  }

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  let found = null;
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      found = allTasks[i];
      break;
    }
  }
  if (!found) throw new Error(`Task not found: ${args.id}`);

  if (args.name !== undefined) found.name = args.name;
  if (Object.prototype.hasOwnProperty.call(args, "note")) {
    found.note = args.note ?? "";
  }
  if (args.flagged !== undefined) found.flagged = args.flagged;
  if (Object.prototype.hasOwnProperty.call(args, "deferDate")) {
    found.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  }
  if (Object.prototype.hasOwnProperty.call(args, "dueDate")) {
    found.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  }
  if (Object.prototype.hasOwnProperty.call(args, "estimatedMinutes")) {
    found.estimatedMinutes = args.estimatedMinutes;
  }
  if (args.sequential !== undefined) found.sequential = args.sequential;
  if (args.completedByChildren !== undefined) {
    try {
      found.containsSingletonActions = args.completedByChildren;
    } catch (_e) {}
  }

  if (args.tagIds !== undefined) {
    try {
      const currentTags = found.tags();
      for (let i = 0; i < currentTags.length; i++) {
        found.removeTag(currentTags[i]);
      }
    } catch (_e) {}
    for (let i = 0; i < args.tagIds.length; i++) {
      try {
        const tag = ofApp.defaultDocument.flattenedTags.byId(args.tagIds[i]);
        found.addTag(tag);
      } catch (_e) {}
    }
  }

  return JSON.stringify({ task: buildTask(found) });
}
