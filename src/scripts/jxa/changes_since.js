/**
 * JXA: return task and project IDs modified since a given timestamp.
 *
 * This script powers the richer change-semantics layer: when the
 * FSEventStream watcher (or fs.watch fallback) detects a database write,
 * the server calls this script to discover *which* objects changed so it
 * can perform targeted cache invalidation and per-object resource
 * notifications instead of a blanket cache clear.
 *
 * Args (argv[0] JSON): {
 *   sinceIso: string     // ISO-8601 lower bound (exclusive)
 * }
 *
 * Returns JSON: {
 *   tasks:    Array<{ id: string, modificationDate: string }>
 *   projects: Array<{ id: string, modificationDate: string }>
 * }
 *
 * Performance: pushes the `modificationDate >= since` predicate into OF's
 * runtime via `whose({...})` (see #789, mirrors `forecast_get.js`'s 25×
 * pattern). On databases with thousands of tasks this avoids materializing
 * every task's accessor — typically a sub-second query vs the original
 * full-scan loop's hundreds-of-ms-per-thousand-tasks. The `try`/`catch`
 * around the `whose()` call is a safety net: if OF rejects the predicate
 * for any reason, we fall back to the previous client-side filter so this
 * script never returns wrong results because of a query-engine surprise.
 *
 * The Node side debounces change events to avoid stampeding this script.
 *
 * Note: `modificationDate` in OF reflects the last local write including
 * sync-incoming changes. It does NOT distinguish between field-level changes;
 * callers that need field-level diffs should re-fetch the object after
 * receiving the notification.
 *
 * @see src/watcher/types.ts — ChangedObjects shape
 * @see src/adapter/jxa/JxaTransport.ts — caller (getChangesSince)
 * @see src/scripts/jxa/forecast_get.js — same whose() pushdown pattern
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv)
function run(argv) {
  const args = JSON.parse(argv[0]);
  const since = new Date(args.sinceIso);

  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  // Try the whose() pushdown first; fall back to a full scan if OF rejects
  // the predicate for any reason (older OF, unexpected accessor behavior).
  function collectModifiedSince(collection) {
    let raw;
    try {
      raw = collection.whose({ modificationDate: { _greaterThanEquals: since } })();
    } catch (_e) {
      raw = collection();
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      try {
        const item = raw[i];
        const modDate = item.modificationDate();
        // The whose() filter already excludes earlier dates, but the
        // post-loop guard keeps the fallback path correct and defends
        // against whose() silently falling back to client-side
        // matching for some operators.
        if (modDate && modDate >= since) {
          out.push({ id: item.id(), modificationDate: modDate.toISOString() });
        }
      } catch (_e) {
        // Skip items that error (e.g. inbox pseudo-tasks with no stable id)
      }
    }
    return out;
  }

  const tasks = collectModifiedSince(doc.flattenedTasks);
  const projects = collectModifiedSince(doc.flattenedProjects);

  return JSON.stringify({ tasks, projects });
}
