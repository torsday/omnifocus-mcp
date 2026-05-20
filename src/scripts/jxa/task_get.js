// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />

/**
 * JXA: fetch one task by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { task: Task }
 *
 * Beachhead script for the JXA static-typing rollout (#987 / #854): the
 * `@ts-check` directive plus the triple-slash references make this file
 * the first consumer of `_types/omnifocus.d.ts`. The references resolve
 * `Application("OmniFocus")` to the typed `Application` interface and
 * `buildTask` to its ambient declaration in `jxa-helpers.d.ts`, so the
 * `defaultDocument.flattenedTasks()` chain below is statically checked
 * against the .sdef-derived signatures. The OF 4.x quirks (Folder/Tag
 * have no `parent()`, etc.) surface at `tsc` time here, not at runtime
 * in production.
 *
 * The `// @inline _helpers/build_task.js` directive below splices the
 * helper into the bundled script (ADR-0020); the `jxa-helpers.d.ts`
 * reference is what lets `// @ts-check` resolve the call.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

/**
 * @param {string[]} argv — argv[0] is the JSON-encoded input payload.
 * @returns {string} JSON-encoded `{ task: ... }`.
 */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_task.js

  const allTasks = ofApp.defaultDocument.flattenedTasks();
  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    if (t.id() === args.id) {
      return JSON.stringify({ task: buildTask(t) });
    }
  }

  throw new Error(`Task not found: ${args.id}`);
}
