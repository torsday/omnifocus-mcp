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
  // Collect candidates and bucket them — see #500.
  //
  // Push every filter into OF's runtime via `whose()`, one query per bucket.
  // Each query returns only the tasks that actually match — typically a
  // handful — so we never pay the per-task JXA accessor cost on the long
  // tail of unrelated tasks.
  //
  // Empirical comparison (~240 active tasks, OF 4.8.x):
  //
  //   Original (build every task)                      ~12 s
  //   whose() + per-task probe of 3 accessors          ~12 s   (probe wins
  //                                                            nothing —
  //                                                            JXA per-call
  //                                                            overhead is
  //                                                            the limit)
  //   Four whose() queries (this implementation)       <0.5 s
  //
  // OF's whose() supports equality and date range comparisons (`_lessThan`,
  // `_greaterThan`, `_greaterThanEquals`, `_lessThanEquals`) on individual
  // properties, but rejects `_or` / `_isnt: null`. Hence one query per bucket
  // rather than a single `_or`-combined query.
  //
  // Tasks that match multiple buckets are built once and pushed into each
  // matching bucket. Dedup is keyed on persistent ID.
  // ---------------------------------------------------------------------------

  const fromDate = new Date(from);
  const toDate = new Date(to);

  // ID → built task, populated lazily so each task is constructed once.
  const builtById = {};
  function builtFor(task) {
    const id = task.id();
    if (builtById[id] !== undefined) return builtById[id];
    const b = buildTask(task);
    builtById[id] = b;
    return b;
  }

  function runQuery(predicate) {
    try {
      return ofApp.defaultDocument.flattenedTasks.whose(predicate)();
    } catch (_e) {
      return [];
    }
  }

  const overdue = [];
  const dueToday = [];
  const deferredToday = [];
  const flaggedTasks = [];

  if (includeOverdue) {
    const matches = runQuery({
      completed: false,
      dropped: false,
      dueDate: { _lessThan: fromDate },
    });
    for (let i = 0; i < matches.length; i++) overdue.push(builtFor(matches[i]));
  }

  // dueToday is always populated regardless of include flags (mirrors the
  // pre-#500 behaviour).
  {
    const matches = runQuery({
      completed: false,
      dropped: false,
      dueDate: { _greaterThanEquals: fromDate, _lessThanEquals: toDate },
    });
    for (let i = 0; i < matches.length; i++) dueToday.push(builtFor(matches[i]));
  }

  if (includeDeferred) {
    const matches = runQuery({
      completed: false,
      dropped: false,
      deferDate: { _greaterThanEquals: fromDate, _lessThanEquals: toDate },
    });
    for (let i = 0; i < matches.length; i++) deferredToday.push(builtFor(matches[i]));
  }

  if (includeFlagged) {
    const matches = runQuery({ completed: false, dropped: false, flagged: true });
    for (let i = 0; i < matches.length; i++) flaggedTasks.push(builtFor(matches[i]));
  }

  return JSON.stringify({
    overdue,
    dueToday,
    deferredToday,
    flagged: flaggedTasks,
  });
}
