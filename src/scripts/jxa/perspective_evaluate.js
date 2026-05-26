// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

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
 * The `projects` and `tags` branches use a **source-collection** rethink
 * (#899) — `containingProject !== null` and `tagCount > 0` aren't
 * expressible in OF's `whose()` (rejects `_isnt: null` and has no clean
 * cardinality predicate), but the same semantics fall out of iterating
 * `flattenedProjects()` (every task in a project has a containing
 * project by definition) and `flattenedTags()` (every task in a tag's
 * `.tasks()` collection has at least one tag). Inbox tasks and untagged
 * tasks are therefore never iterated. Both branches still apply a
 * post-loop guard for completed/dropped as a safety net mirroring the
 * `changes_since` / `task_list` slices.
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

    // whose() pushdown helper — apply the predicate to the given source
    // collection (`ofApp.defaultDocument.flattenedTasks`, a project's
    // `flattenedTasks`, a tag's `tasks`, etc.). Try whose() first; on
    // rejection, fall back to the bare source so the post-loop guard
    // still produces correct results.
    /**
     * @param {any} source — a JXA element collection (callable returning the
     *   array; also exposes `.whose(predicate)` and other element verbs).
     *   Typed `any` because the OF runtime shape (callable + property
     *   accessor + whose() method) doesn't model cleanly as a JSDoc
     *   intersection without forcing every call site through a guard.
     *   The try/catch fallback below absorbs any shape mismatch.
     * @param {Record<string, unknown>} predicate
     * @returns {unknown[]}
     */
    function tasksMatching(source, predicate) {
      try {
        return source.whose(predicate)();
      } catch (_e) {
        try {
          return source();
        } catch (_e2) {
          return [];
        }
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
      const matches = tasksMatching(ofApp.defaultDocument.flattenedTasks, {
        flagged: true,
        completed: false,
        dropped: false,
      });
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
      const matches = tasksMatching(ofApp.defaultDocument.flattenedTasks, {
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
      // Projects: tasks under any project, not completed/dropped (#899).
      // Source-narrow to `flattenedProjects()` then iterate each project's
      // `flattenedTasks` with whose() pushdown. Inbox tasks live on
      // `doc.inboxTasks` (never on any project's flattenedTasks) so they
      // are naturally excluded from this branch — the old full-scan
      // filtered them via `built.projectId !== null`, the new path
      // achieves the same semantics by source choice. Post-loop guard
      // keeps `completed`/`dropped` correct when whose() falls back.
      const projects = ofApp.defaultDocument.flattenedProjects();
      for (let p = 0; p < projects.length; p++) {
        const matches = tasksMatching(projects[p].flattenedTasks, {
          completed: false,
          dropped: false,
        });
        for (let i = 0; i < matches.length; i++) {
          const built = buildTask(matches[i]);
          if (!built.completed && !built.dropped) {
            result.push(built);
          }
        }
      }
    } else if (perspectiveId === "tags") {
      // Tags: tasks with ≥ 1 tag, not completed/dropped (#899). Source-narrow
      // to `flattenedTags()`, then per-tag iterate `tag.tasks` with whose()
      // pushdown. A task with N tags appears in N tag collections — dedupe
      // by id via a Set before emitting. Untagged tasks never appear in
      // any tag's `.tasks()` collection so the old "tagIds.length > 0"
      // post-filter is now structural.
      const tags = ofApp.defaultDocument.flattenedTags();
      /** @type {Record<string, boolean>} */
      const seen = {};
      for (let g = 0; g < tags.length; g++) {
        const matches = tasksMatching(tags[g].tasks, { completed: false, dropped: false });
        for (let i = 0; i < matches.length; i++) {
          const built = buildTask(matches[i]);
          if (built.completed || built.dropped) continue;
          if (seen[built.id]) continue;
          seen[built.id] = true;
          result.push(built);
        }
      }
    }

    return JSON.stringify({ tasks: result });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
}
