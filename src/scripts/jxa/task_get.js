/**
 * JXA: fetch one task by ID.
 *
 * Args (argv[0] JSON): { id: string }
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
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      return JSON.stringify({ task: buildTask(allTasks[i]) });
    }
  }

  throw new Error(`Task not found: ${args.id}`);
}
