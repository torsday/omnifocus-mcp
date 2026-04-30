/**
 * JXA: mark a task complete.
 *
 * Args (argv[0] JSON): { id: string, completionDate?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  let found = null;
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      found = allTasks[i];
      break;
    }
  }
  if (!found) throw new Error(`Task not found: ${args.id}`);

  ofApp.markComplete(found);

  if (args.completionDate) {
    try {
      found.completionDate = new Date(args.completionDate);
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  return JSON.stringify({ id: args.id });
}
