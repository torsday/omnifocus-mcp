// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: fetch multiple tasks by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { tasks: (Task | null)[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_task.js
  // @inline _helpers/lookup_or_throw.js

  const doc = ofApp.defaultDocument;

  // byId() per requested id instead of one full flattenedTasks() linear scan
  // (#788/#1083). lookupOrThrow forces resolution and throws on a missing id
  // (-1728); we catch that and emit `null`, preserving the (Task | null)[]
  // contract (get_many never throws on a miss).
  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    let task = null;
    try {
      task = buildTask(lookupOrThrow(doc.flattenedTasks.byId(args.ids[i]), "Task", args.ids[i]));
    } catch (_e) {
      task = null;
    }
    results.push(task);
  }

  return JSON.stringify({ tasks: results });
}
