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

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
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

  // @inline _helpers/build_task.js

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
    const b = buildTask(task, { effectiveAvailability: true });
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
