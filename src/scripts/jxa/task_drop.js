/**
 * JXA: mark a task as dropped.
 *
 * Args (argv[0] JSON): { id: string, droppedAt?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  const found = lookupOrThrow(ofApp.defaultDocument.flattenedTasks.byId(args.id), "Task", args.id);

  // In OmniFocus 4.x JXA, `task.dropped = true` is rejected with -10003
  // ("Can't set that. Access not allowed."). Use ofApp.markDropped() instead.
  ofApp.markDropped(found);

  return JSON.stringify({ id: args.id });
}
