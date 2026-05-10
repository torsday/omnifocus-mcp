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
 * Performance: when no source-narrowing branch applies (`projectId` /
 * `tagId` / `parentId` / `inbox`), the no-filter branch pushes the
 * boolean and date-range predicates into OF's runtime via `whose({...})`
 * (#789 / #893; mirrors the 25× speedup pattern from `forecast_get.js`
 * and `changes_since.js`). On a real-user DB (10k+ tasks) this avoids
 * materializing the long tail of unrelated tasks. The `try`/`catch`
 * fallback to a full scan keeps the script correct if OF rejects the
 * predicate for any reason; the post-loop filters are kept intact as a
 * safety net and to handle filters that don't push down (`tagId`,
 * `available`, `blocked`, `completedSince` — all need `buildTask`'s
 * computed values).
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 * @see src/scripts/jxa/forecast_get.js — same whose() pushdown pattern
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

  const completedSince = args.completedSince ? new Date(args.completedSince) : null;
  const dueBefore = args.dueBefore ? new Date(args.dueBefore) : null;
  const dueAfter = args.dueAfter ? new Date(args.dueAfter) : null;
  const deferredBefore = args.deferredBefore ? new Date(args.deferredBefore) : null;
  const deferredAfter = args.deferredAfter ? new Date(args.deferredAfter) : null;

  let tasks;
  if (args.inbox) {
    // inboxTasks() returns only tasks with no project assignment — exactly the Inbox scope.
    tasks = ofApp.defaultDocument.inboxTasks();
  } else if (args.projectId) {
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
    tasks = proj.flattenedTasks();
  } else if (args.parentId) {
    const parent = lookupOrThrow(
      ofApp.defaultDocument.flattenedTasks.byId(args.parentId),
      "Parent task",
      args.parentId,
    );
    // Use .tasks() (direct children only) not .flattenedTasks() (all descendants).
    // flattenedTasks() would include grandchildren and deeper, violating the
    // direct-children contract documented on OmniFocusAdapter.listTasks — see #695.
    tasks = parent.tasks();
  } else if (args.tagId) {
    // Scoping the source to the tag's own tasks is asymptotically required:
    // scanning flattenedTasks() over a real user DB (10k+ tasks) and calling
    // buildTask on each can exceed the 30s scriptRunner timeout. The tag-rooted
    // collection is bounded by the tag's actual usage. The post-loop tagId
    // filter is then a no-op for this branch but kept as a safety net.
    const tag = lookupOrThrow(
      ofApp.defaultDocument.flattenedTags.byId(args.tagId),
      "Tag",
      args.tagId,
    );
    tasks = tag.tasks();
  } else {
    // No source-narrowing branch — push every pushable predicate into
    // OF's runtime via whose(). Predicates that don't push down (tag /
    // available / blocked / completedSince — all need buildTask's
    // computed values) stay client-side in the loop below.
    const predicate = {};
    if (args.flagged !== null && args.flagged !== undefined) {
      predicate.flagged = args.flagged;
    }
    if (args.completed !== null && args.completed !== undefined) {
      predicate.completed = args.completed;
    }
    if (dueBefore !== null || dueAfter !== null) {
      predicate.dueDate = {};
      if (dueBefore !== null) predicate.dueDate._lessThan = dueBefore;
      if (dueAfter !== null) predicate.dueDate._greaterThan = dueAfter;
    }
    if (deferredBefore !== null || deferredAfter !== null) {
      predicate.deferDate = {};
      if (deferredBefore !== null) predicate.deferDate._lessThan = deferredBefore;
      if (deferredAfter !== null) predicate.deferDate._greaterThan = deferredAfter;
    }
    const hasPushable = Object.keys(predicate).length > 0;
    if (hasPushable) {
      try {
        tasks = ofApp.defaultDocument.flattenedTasks.whose(predicate)();
      } catch (_e) {
        // OF rejected the predicate for some reason — fall back to the
        // full scan so the post-loop filters still produce correct results.
        tasks =
          ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: whose() pushdown rejected by OF, full scan is the documented fallback */
      }
    } else {
      tasks =
        ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: else-branch fallback when no scope filter provided */
    }
  }

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
