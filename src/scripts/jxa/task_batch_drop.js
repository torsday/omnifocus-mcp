// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: batch-drop (cancel) tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { items: Array<{ id: string }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Per-item failures do not abort the batch. Dropped tasks remain in
 * OmniFocus but are treated as cancelled/inactive.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/scripts/jxa/task_batch_complete.js — sibling pattern
 * @see src/scripts/jxa/task_drop.js — singular counterpart
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  // @inline _helpers/lookup_or_throw.js

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < args.items.length; i++) {
    const it = args.items[i];
    try {
      const task = lookupOrThrow(doc.flattenedTasks.byId(it.id), "OF_NOT_FOUND: task", it.id);
      // In OmniFocus 4.x JXA, `task.dropped = true` is rejected with -10003
      // ("Can't set that. Access not allowed."). Use ofApp.markDropped() instead.
      ofApp.markDropped(task);
      succeeded.push({ index: i, value: it.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/^(OF_[A-Z_]+):/);
      const errorCode = m ? m[1] : "OF_UNKNOWN";
      failed.push({ index: i, errorCode: errorCode, message: msg });
    }
  }

  return JSON.stringify({ succeeded: succeeded, failed: failed });
}
