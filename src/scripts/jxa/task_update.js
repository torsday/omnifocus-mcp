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

  // @inline _helpers/build_task.js

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
  if (Object.hasOwn(args, "note")) {
    found.note = args.note ?? "";
  }
  if (args.flagged !== undefined) found.flagged = args.flagged;
  if (Object.hasOwn(args, "deferDate")) {
    found.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  }
  if (Object.hasOwn(args, "dueDate")) {
    found.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  }
  if (Object.hasOwn(args, "estimatedMinutes")) {
    found.estimatedMinutes = args.estimatedMinutes;
  }
  if (args.sequential !== undefined) found.sequential = args.sequential;
  if (args.completedByChildren !== undefined) {
    try {
      found.containsSingletonActions = args.completedByChildren;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  if (args.tagIds !== undefined) {
    try {
      const currentTags = found.tags();
      for (let i = 0; i < currentTags.length; i++) {
        found.removeTag(currentTags[i]);
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    for (let i = 0; i < args.tagIds.length; i++) {
      try {
        const tag = ofApp.defaultDocument.flattenedTags.byId(args.tagIds[i]);
        found.addTag(tag);
      } catch (_e) {
        /* OF 4.x: property access may not exist on all object types — default used */
      }
    }
  }

  return JSON.stringify({ task: buildTask(found) });
}
