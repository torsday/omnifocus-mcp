/**
 * JXA: batch-update tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { updates: Array<{ id, patch }> }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * `patch` follows the same shape as `task_update.js` — any subset of
 * editable fields. Per-item failures do not abort the batch.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/scripts/jxa/task_update.js — single-update reference
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  const succeeded = [];
  const failed = [];

  function applyPatch(task, patch) {
    if (patch.name != null) task.name = patch.name;
    if (patch.note !== undefined) task.note = patch.note == null ? "" : patch.note;
    if (patch.flagged != null) task.flagged = patch.flagged;
    if (patch.deferDate !== undefined) {
      task.deferDate = patch.deferDate == null ? null : new Date(patch.deferDate);
    }
    if (patch.dueDate !== undefined) {
      task.dueDate = patch.dueDate == null ? null : new Date(patch.dueDate);
    }
    if (patch.estimatedMinutes !== undefined) {
      task.estimatedMinutes = patch.estimatedMinutes;
    }
    if (patch.sequential != null) task.sequential = patch.sequential;
    if (patch.completedByChildren != null) {
      task.containsSingletonActions = patch.completedByChildren;
    }
    if (patch.tagIds) {
      const existing = task.tags();
      for (let i = 0; i < existing.length; i++) {
        try {
          task.removeTag(existing[i]);
        } catch (_e) {}
      }
      for (let i = 0; i < patch.tagIds.length; i++) {
        try {
          const tag = doc.flattenedTags.byId(patch.tagIds[i]);
          if (tag) task.addTag(tag);
        } catch (_e) {}
      }
    }
  }

  for (let i = 0; i < args.updates.length; i++) {
    const u = args.updates[i];
    try {
      const task = doc.flattenedTasks.byId(u.id);
      if (!task) throw new Error(`OF_NOT_FOUND: task ${u.id}`);
      applyPatch(task, u.patch || {});
      succeeded.push({ index: i, value: u.id });
    } catch (e) {
      const msg = e?.message || String(e);
      const m = msg.match(/^(OF_[A-Z_]+):/);
      const errorCode = m ? m[1] : "OF_UNKNOWN";
      failed.push({ index: i, errorCode: errorCode, message: msg });
    }
  }

  return JSON.stringify({ succeeded: succeeded, failed: failed });
}
