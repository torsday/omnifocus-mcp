// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: batch-uncomplete (mark incomplete) tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { items: Array<{ id: string }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Per-item failures do not abort the batch. Uncompleted tasks are returned
 * to their previous incomplete state.
 *
 * NOTE: completed tasks may not be reachable via flattenedTasks.byId() in
 * all OmniFocus versions. We build an ID→task map by iterating all tasks
 * once (O(n)) then look up each item in O(1) — consistent with task_uncomplete.js.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/scripts/jxa/task_batch_complete.js — sibling pattern
 * @see src/scripts/jxa/task_uncomplete.js — singular counterpart
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  // Build a set of requested IDs for early-exit if the batch is small.
  /** @type {Record<string, true>} */
  const wantedIds = {};
  for (let k = 0; k < args.items.length; k++) {
    wantedIds[args.items[k].id] = true;
  }

  // Single O(n) pass over all tasks to build id → task map.
  const allTasks = doc.flattenedTasks();
  /** @type {Record<string, unknown>} */
  const taskMap = {};
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    const tid = t.id();
    if (wantedIds[tid]) {
      taskMap[tid] = t;
    }
  }

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < args.items.length; i++) {
    const it = args.items[i];
    try {
      const task = taskMap[it.id];
      if (!task) throw new Error(`OF_NOT_FOUND: task ${it.id}`);
      ofApp.markIncomplete(task);
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
