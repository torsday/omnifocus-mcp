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

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

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
  let newTask;
  if (args.parentId) {
    const parent = lookupOrThrow(
      ofApp.defaultDocument.flattenedTasks.byId(args.parentId),
      "Parent task",
      args.parentId,
    );
    newTask = ofApp.Task(props);
    parent.tasks.push(newTask);
  } else if (args.projectId) {
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
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
      } catch (_e) {
        /* OF 4.x: property access may not exist on all object types — default used */
      }
    }
  }

  if (args.completedByChildren != null) {
    try {
      newTask.containsSingletonActions = args.completedByChildren;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
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
