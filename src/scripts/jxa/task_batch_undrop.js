/**
 * JXA: batch-undrop (restore) tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { items: Array<{ id: string }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Per-item failures do not abort the batch. Undropped tasks are restored to
 * active status in OmniFocus.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/scripts/jxa/task_batch_drop.js — sibling pattern
 * @see src/scripts/jxa/task_undrop.js — singular counterpart
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < args.items.length; i++) {
    const it = args.items[i];
    try {
      const task = doc.flattenedTasks.byId(it.id);
      if (!task) throw new Error(`OF_NOT_FOUND: task ${it.id}`);
      // In OmniFocus 4.x JXA, `task.dropped = false` is rejected with -10003
      // ("Can't set that. Access not allowed."). Use ofApp.markIncomplete() instead,
      // which clears the dropped flag and restores the task to active status.
      ofApp.markIncomplete(task);
      succeeded.push({ index: i, value: it.id });
    } catch (e) {
      const msg = e?.message || String(e);
      const m = msg.match(/^(OF_[A-Z_]+):/);
      const errorCode = m ? m[1] : "OF_UNKNOWN";
      failed.push({ index: i, errorCode: errorCode, message: msg });
    }
  }

  return JSON.stringify({ succeeded: succeeded, failed: failed });
}
