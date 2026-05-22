// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: fetch the HTML note for a task or project by ID.
 *
 * Args (argv[0] JSON): { kind: "task" | "project", id: string }
 * Returns JSON: { noteHtml: string | null }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/tools/note/get_html.ts — MCP tool
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  let item;
  if (args.kind === "task") {
    item = lookupOrThrow(ofApp.defaultDocument.flattenedTasks.byId(args.id), "Task", args.id);
  } else {
    item = lookupOrThrow(ofApp.defaultDocument.flattenedProjects.byId(args.id), "Project", args.id);
  }

  let noteHtml = null;
  try {
    if (item.noteHtml) noteHtml = item.noteHtml() || null;
  } catch (_e) {
    /* OF 4.x: noteHtml may not exist on all item types — null used */
  }

  return JSON.stringify({ noteHtml });
}
