// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: move a project to a folder (or to the root if folderId is null).
 *
 * Args (argv[0] JSON): { id: string, folderId?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/lookup_or_throw.js

  // byId() instead of a flattenedProjects() linear scan (#788/#1091).
  const target = lookupOrThrow(
    ofApp.defaultDocument.flattenedProjects.byId(args.id),
    "Project",
    args.id,
  );

  if (args.folderId) {
    // Folder resolution stays a flattenedFolders iteration on purpose: a
    // `flattenedFolders.byId(...)` specifier has a nil `.projects.end` (the move
    // target on the next line) — the #674 JXA quirk. byId is correct for the
    // project above, but not for a folder we then read `.projects.end` off.
    const allFolders = ofApp.defaultDocument.flattenedFolders();
    let folder = null;
    for (let i = 0; i < allFolders.length; i++) {
      if (allFolders[i].id() === args.folderId) {
        folder = allFolders[i];
        break;
      }
    }
    if (!folder) throw new Error(`Folder not found: ${args.folderId}`);
    target.move({ to: folder.projects.end });
  } else {
    target.move({ to: ofApp.defaultDocument.projects.end });
  }

  return JSON.stringify({ id: args.id });
}
