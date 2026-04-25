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
 * Performance: scans all flattenedTasks and flattenedProjects in a single
 * JXA invocation. On databases with 1 000–5 000 tasks this takes ~300–700 ms
 * (same budget as any other task-list call). The Node side debounces change
 * events to avoid stampeding this script.
 *
 * Note: `modificationDate` in OF reflects the last local write including
 * sync-incoming changes. It does NOT distinguish between field-level changes;
 * callers that need field-level diffs should re-fetch the object after
 * receiving the notification.
 *
 * @see src/watcher/types.ts — ChangedObjects shape
 * @see src/adapter/jxa/JxaTransport.ts — caller (getChangesSince)
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv)
function run(argv) {
  const args = JSON.parse(argv[0]);
  const since = new Date(args.sinceIso);

  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // ------- Tasks -----------------------------------------------------------

  const rawTasks = ofApp.defaultDocument.flattenedTasks();
  const tasks = [];
  for (let i = 0; i < rawTasks.length; i++) {
    try {
      const t = rawTasks[i];
      const modDate = t.modificationDate();
      if (modDate && modDate >= since) {
        tasks.push({ id: t.id(), modificationDate: modDate.toISOString() });
      }
    } catch (_e) {
      // Skip tasks that error (e.g. inbox pseudo-tasks with no stable id)
    }
  }

  // ------- Projects --------------------------------------------------------

  const rawProjects = ofApp.defaultDocument.flattenedProjects();
  const projects = [];
  for (let i = 0; i < rawProjects.length; i++) {
    try {
      const p = rawProjects[i];
      const modDate = p.modificationDate();
      if (modDate && modDate >= since) {
        projects.push({ id: p.id(), modificationDate: modDate.toISOString() });
      }
    } catch (_e) {
      // Skip
    }
  }

  return JSON.stringify({ tasks, projects });
}
