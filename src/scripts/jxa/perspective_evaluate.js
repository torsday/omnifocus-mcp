/**
 * JXA: evaluate a built-in OmniFocus perspective and return its task list.
 *
 * Args (argv[0] JSON): { "perspectiveId": "inbox" | "projects" | "tags" | "forecast" | "flagged" | "nearby" | "review" }
 * Returns JSON: { tasks: Task[] }
 *
 * Performance: the `flagged` and `forecast` branches push their predicates
 * into OF's runtime via `whose({...})` (#789 / #894), mirroring the
 * `forecast_get.js` 25× speedup pattern. Try/catch fallback to the
 * full-scan keeps results correct on whose() rejection.
 *
 * The `projects` and `tags` branches still scan `flattenedTasks()` because
 * their predicates ("has a containingProject" / "has at least one tag")
 * don't translate to whose() — OF's whose() rejects `_isnt: null`
 * (documented in `forecast_get.js`'s comment block) and there's no clean
 * cardinality predicate. Source-collection rethink (e.g. iterating
 * `flattenedProjects()` per project, or `flattenedTags().tasks()` per
 * tag) is tracked separately — see #894's follow-up.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 * @see src/scripts/jxa/forecast_get.js — same whose() pushdown pattern
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  try {
    const args = JSON.parse(argv[0]);
    const perspectiveId = args.perspectiveId;
    const ofApp = Application("OmniFocus");
    ofApp.includeStandardAdditions = false;

    // Early returns for perspectives that can't be evaluated in script context
    if (perspectiveId === "review" || perspectiveId === "nearby") {
      return JSON.stringify({ tasks: [] });
    }

    // @inline _helpers/build_task.js

    // whose() pushdown helper — try the predicate, fall back to a full
    // scan on rejection so the post-loop guard still produces correct
    // results.
    function tasksMatching(predicate) {
      try {
        return ofApp.defaultDocument.flattenedTasks.whose(predicate)();
      } catch (_e) {
        return ofApp.flattenedTasks();
      }
    }

    const result = [];

    if (perspectiveId === "inbox") {
      // Inbox: tasks not yet assigned to a project
      const inboxTasks = ofApp.inboxTasks();
      for (let i = 0; i < inboxTasks.length; i++) {
        result.push(buildTask(inboxTasks[i]));
      }
    } else if (perspectiveId === "flagged") {
      // Flagged: flagged tasks that are not completed/dropped — pushed into
      // whose() so the long tail of unflagged tasks is never iterated.
      const matches = tasksMatching({ flagged: true, completed: false, dropped: false });
      for (let i = 0; i < matches.length; i++) {
        const t = matches[i];
        const built = buildTask(t);
        // Post-loop guard kept as a safety net in case whose() silently
        // falls back to client-side matching for a given operator.
        if (built.flagged && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    } else if (perspectiveId === "forecast") {
      // Forecast: tasks with dueDate <= end of today and not completed/dropped.
      // The dueDate predicate naturally excludes tasks with no dueDate.
      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const matches = tasksMatching({
        completed: false,
        dropped: false,
        dueDate: { _lessThanEquals: endOfDay },
      });
      for (let i = 0; i < matches.length; i++) {
        const t = matches[i];
        const built = buildTask(t);
        if (built.dueDate && !built.completed && !built.dropped) {
          const due = new Date(built.dueDate);
          if (due <= endOfDay) {
            result.push(built);
          }
        }
      }
    } else if (perspectiveId === "projects") {
      // Projects: top-level tasks of active projects (not completed/dropped).
      // No clean whose() predicate — `containingProject` is not nullable
      // through OF's whose() (rejects _isnt: null). Stays a full scan;
      // see #894's follow-up for source-collection rethink.
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.projectId !== null && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    } else if (perspectiveId === "tags") {
      // Tags: tasks that have at least one tag and are not completed/dropped.
      // Same constraint as `projects` — no clean cardinality predicate via
      // whose(). Stays a full scan; see #894's follow-up.
      const allTasks = ofApp.flattenedTasks();
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        const built = buildTask(t);
        if (built.tagIds.length > 0 && !built.completed && !built.dropped) {
          result.push(built);
        }
      }
    }

    return JSON.stringify({ tasks: result });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
