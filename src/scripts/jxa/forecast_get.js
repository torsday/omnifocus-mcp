/**
 * JXA: get forecast-view tasks grouped by category (overdue, dueToday,
 * deferredToday, flagged).
 *
 * Args (argv[0] JSON): {
 *   from: string,              // ISO-8601 — start of range (inclusive)
 *   to: string,                // ISO-8601 — end of range (inclusive)
 *   includeOverdue?: boolean,  // default true
 *   includeDeferred?: boolean, // default true
 *   includeFlagged?: boolean   // default true
 * }
 * Returns JSON: {
 *   overdue: Task[],
 *   dueToday: Task[],
 *   deferredToday: Task[],
 *   flagged: Task[]
 * }
 *
 * @see src/adapter/jxa/JxaTransport.ts — getForecast() caller
 * @see src/adapter/OmniFocusAdapter.ts — ForecastInput / ForecastResult types
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const from = args.from;
  const to = args.to;
  const includeOverdue = args.includeOverdue !== false;
  const includeDeferred = args.includeDeferred !== false;
  const includeFlagged = args.includeFlagged !== false;

  // ---------------------------------------------------------------------------
  // buildTask — same shape as task_list.js / task_search.js
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

    let note = null;
    try {
      const raw = task.note ? task.note() : "";
      note = raw || null;
    } catch (_e) {}

    return {
      id: task.id(),
      name: task.name(),
      note,
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

      createdAt: (function () { try { return task.creationDate().toISOString(); } catch (_e) { return new Date().toISOString(); } })(),

      modifiedAt: (function () { try { return task.modificationDate().toISOString(); } catch (_e) { return new Date().toISOString(); } })(),
    };
  }

  // ---------------------------------------------------------------------------
  // Collect all active (not completed, not dropped) tasks
  // ---------------------------------------------------------------------------

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  const active = [];
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const built = buildTask(t);
    if (!built.completed && !built.dropped) {
      active.push(built);
    }
  }

  // ---------------------------------------------------------------------------
  // Bucket into forecast categories
  // ---------------------------------------------------------------------------

  const overdue = [];
  const dueToday = [];
  const deferredToday = [];
  const flaggedTasks = [];

  for (let i = 0; i < active.length; i++) {
    const t = active[i];

    if (includeOverdue && t.dueDate !== null && t.dueDate < from) {
      overdue.push(t);
    }
    if (t.dueDate !== null && t.dueDate >= from && t.dueDate <= to) {
      dueToday.push(t);
    }
    if (includeDeferred && t.deferDate !== null && t.deferDate >= from && t.deferDate <= to) {
      deferredToday.push(t);
    }
    if (includeFlagged && t.flagged) {
      flaggedTasks.push(t);
    }
  }

  return JSON.stringify({
    overdue,
    dueToday,
    deferredToday,
    flagged: flaggedTasks,
  });
}
