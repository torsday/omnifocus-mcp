// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: move a task to a different project or parent task.
 *
 * Args (argv[0] JSON): { id: string, projectId?: string|null, parentId?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  // byId() instead of a flattenedTasks() linear scan (#788/#1091).
  const found = lookupOrThrow(ofApp.defaultDocument.flattenedTasks.byId(args.id), "Task", args.id);

  if (args.parentId) {
    const parent = lookupOrThrow(
      ofApp.defaultDocument.flattenedTasks.byId(args.parentId),
      "Parent task",
      args.parentId,
    );
    found.move({ to: parent });
  } else if (args.projectId) {
    const proj = lookupOrThrow(
      ofApp.defaultDocument.flattenedProjects.byId(args.projectId),
      "Project",
      args.projectId,
    );
    found.move({ to: proj });
  } else {
    found.move({ to: ofApp.defaultDocument });
  }

  return JSON.stringify({ id: args.id });
}
