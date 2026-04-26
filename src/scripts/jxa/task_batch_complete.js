/**
 * JXA: batch-complete tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { items: Array<{ id, at? }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Per-item failures do not abort the batch. `at` is the completion
 * timestamp (ISO-8601); omit to use "now".
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
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
      const when = it.at ? new Date(it.at) : new Date();
      try {
        task.markComplete({ completionDate: when });
      } catch (_e) {
        task.completed = true;
        try {
          task.completionDate = when;
        } catch (_e2) {}
      }
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
