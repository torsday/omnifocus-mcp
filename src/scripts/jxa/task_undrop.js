// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: remove dropped status from a task.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  const found = lookupOrThrow(ofApp.defaultDocument.flattenedTasks.byId(args.id), "Task", args.id);

  // In OmniFocus 4.x JXA, `task.dropped = false` is rejected with -10003.
  // ofApp.markIncomplete() clears the dropped flag (restores to active status).
  ofApp.markIncomplete(found);

  return JSON.stringify({ id: args.id });
}
