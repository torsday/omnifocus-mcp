/**
 * JXA: move a task to a different project or parent task.
 *
 * Args (argv[0] JSON): { id: string, projectId?: string|null, parentId?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const allTasks = ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: must resolve source task by id before knowing its container */
  let found = null;
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      found = allTasks[i];
      break;
    }
  }
  if (!found) throw new Error(`Task not found: ${args.id}`);

  // @inline _helpers/lookup_or_throw.js

  if (args.parentId) {
    const parent = lookupOrThrow(
      ofApp.defaultDocument.flattenedTasks.byId(args.parentId),
      "Parent task",
      args.parentId,
    );
    found.move({ to: parent });
  } else if (args.projectId) {
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
    found.move({ to: proj });
  } else {
    found.move({ to: ofApp.defaultDocument });
  }

  return JSON.stringify({ id: args.id });
}
