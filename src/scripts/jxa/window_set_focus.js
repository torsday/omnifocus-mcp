// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: set or clear the front window's focus container.
 *
 * Args (argv[0] JSON): { containerId: string | null }
 *   - `containerId` non-null → set focus to that project or folder
 *   - `containerId` null     → clear focus (window shows the perspective's
 *                              default scope)
 *
 * Returns JSON: { focusContainerIds }
 *   - When set: array containing the supplied containerId (so callers can
 *     verify in one round-trip)
 *   - When cleared: empty array
 *  or { error: { code: "NO_FRONT_WINDOW" | "NOT_FOUND", message } }
 *
 * Container resolution: tries projects first, then folders. If the same ID
 * matches both (shouldn't happen but defensive), the project wins.
 *
 * @see GH issue 466
 * @see src/adapter/jxa/JxaTransport.ts — setWindowFocus() caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const wins = ofApp.windows();
  if (!wins || wins.length === 0) {
    return JSON.stringify({
      error: { code: "NO_FRONT_WINDOW", message: "OmniFocus has no front window" },
    });
  }

  const w = wins[0];

  if (args.containerId === null || args.containerId === undefined) {
    // Clear focus — assigning an empty array unfocuses the window.
    w.focus = [];
    return JSON.stringify({ focusContainerIds: [] });
  }

  // Resolve to a project or folder.
  const doc = ofApp.defaultDocument;
  let target = null;

  const projects = doc.flattenedProjects();
  for (let i = 0; i < projects.length; i++) {
    if (projects[i].id() === args.containerId) {
      target = projects[i];
      break;
    }
  }

  if (!target) {
    const folders = doc.flattenedFolders();
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].id() === args.containerId) {
        target = folders[i];
        break;
      }
    }
  }

  if (!target) {
    return JSON.stringify({
      error: {
        code: "NOT_FOUND",
        message: `Container not found (project or folder): ${args.containerId}`,
      },
    });
  }

  w.focus = [target];
  return JSON.stringify({ focusContainerIds: [args.containerId] });
}
