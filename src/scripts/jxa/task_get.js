// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />

/**
 * JXA: fetch one task by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { task: Task }
 *
 * Beachhead script for the JXA static-typing rollout (#987 / #854): the
 * `@ts-check` directive plus the triple-slash reference make this file
 * the first consumer of `_types/omnifocus.d.ts`. The reference resolves
 * `Application("OmniFocus")` to the typed `Application` interface, so
 * the `defaultDocument.flattenedTasks()` chain below is statically
 * checked against the .sdef-derived signatures. The OF 4.x quirks
 * (Folder/Tag have no `parent()`, etc.) surface at `tsc` time here, not
 * at runtime in production.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

/**
 * `buildTask` is spliced into this file at build time by the
 * scriptInlinerPlugin (ADR-0020) via the `// @inline _helpers/build_task.js`
 * directive below. TypeScript can't see the inline expansion at typecheck
 * time, so declare the symbol explicitly. The helper's runtime contract
 * lives in `_helpers/build_task.js`.
 *
 * @type {(task: unknown, options?: { effectiveAvailability?: boolean }) => object}
 */
let buildTask;

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
