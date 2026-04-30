/**
 * JXA: fetch multiple tasks by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { tasks: (Task | null)[] }
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

  const idSet = {};
  for (let i = 0; i < args.ids.length; i++) {
    idSet[args.ids[i]] = null;
  }

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  for (let i = 0; i < allTasks.length; i++) {
    const tid = allTasks[i].id();
    if (Object.hasOwn(idSet, tid)) {
      idSet[tid] = buildTask(allTasks[i]);
    }
  }

  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    results.push(idSet[args.ids[i]]);
  }

  return JSON.stringify({ tasks: results });
}
