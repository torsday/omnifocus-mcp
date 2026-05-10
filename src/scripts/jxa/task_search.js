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

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

  // ---------------------------------------------------------------------------
  // Collect candidate tasks
  // ---------------------------------------------------------------------------

  let tasks;
  if (args.projectId) {
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
    tasks = proj.flattenedTasks();
  } else {
    tasks = ofApp.defaultDocument.flattenedTasks();
  }

  // ---------------------------------------------------------------------------
  // Filter
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
