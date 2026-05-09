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

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

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
