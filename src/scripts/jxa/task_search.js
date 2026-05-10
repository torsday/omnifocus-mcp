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
 * Performance: when no `projectId` is provided, the script pushes
 * `flagged` / `completed` / `dueDate` predicates into OF's runtime via
 * `whose({...})` (#789 / #895; mirrors the `forecast_get.js` pattern).
 * Tag, available, and text-search predicates stay client-side because
 * they need `buildTask`'s computed values. The text-search `_contains`
 * pushdown is intentionally skipped for v1 — `_contains` support in OF
 * 4.x's whose() is unverified; landing it would need a hands-on test
 * against live OF that's outside this loop. See the parent #789 audit.
 *
 * @see src/adapter/jxa/JxaTransport.ts — searchTasks() caller
 * @see src/domain/task.ts — Task domain type
 * @see src/scripts/jxa/forecast_get.js — same whose() pushdown pattern
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

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

  // ---------------------------------------------------------------------------
  // Collect candidate tasks
  // ---------------------------------------------------------------------------

  let tasks;
  if (args.projectId) {
    // Source-narrowed: project's own tasks. The whose() pushdown still
    // applies but we'd need to attach it to proj.flattenedTasks — skip
    // for v1 since the project scope is already bounded.
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
    tasks = proj.flattenedTasks();
  } else {
<<<<<<< HEAD
    // No source-narrowing — push pushable predicates into whose() so the
    // long tail of non-matching tasks is never iterated.
    const predicate = {};
    if (args.flagged !== null && args.flagged !== undefined) {
      predicate.flagged = args.flagged;
    }
    if (completed === "exclude") {
      predicate.completed = false;
    } else if (completed === "only") {
      predicate.completed = true;
    }
    // "any" passes through — no completed predicate.
    if (dueBefore !== null || dueAfter !== null) {
      predicate.dueDate = {};
      if (dueBefore !== null) predicate.dueDate._lessThan = dueBefore;
      if (dueAfter !== null) predicate.dueDate._greaterThan = dueAfter;
    }
    const hasPushable = Object.keys(predicate).length > 0;
    if (hasPushable) {
      try {
        tasks = ofApp.defaultDocument.flattenedTasks.whose(predicate)();
      } catch (_e) {
        // OF rejected the predicate — fall back to the full scan so the
        // post-loop filters still produce correct results.
        tasks = ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: whose() pushdown rejected by OF, full scan is the documented fallback */
      }
    } else {
      tasks = ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: else-branch fallback when no scope filter provided */
    }
  }

  // ---------------------------------------------------------------------------
  // Filter (post-loop guards — defensive against whose() partial coverage,
  // and required for predicates that didn't push down: tag, available, q)
  // ---------------------------------------------------------------------------

  const result = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const built = buildTask(t, { effectiveAvailability: true });

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

    // Tag filter — task must carry ALL listed tags.
    // Build a Set<string> once per task for O(1) membership checks instead of
    // O(filterTags × taskTags) nested scan (#803).
    if (args.tagIds && args.tagIds.length > 0) {
      const taskTagSet = new Set(built.tagIds);
      const allPresent = args.tagIds.every((tid) => taskTagSet.has(tid));
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
