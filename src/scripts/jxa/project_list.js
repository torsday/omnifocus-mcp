// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: list projects, optionally filtered by folderId or status.
 *
 * Args (argv[0] JSON): { folderId?: string|null, status?: string|null }
 * Returns JSON: { projects: Project[] }
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

  // @inline _helpers/build_project.js

  let projects;
  if (args.folderId) {
    try {
      const folder = ofApp.defaultDocument.folders.byId(args.folderId);
      projects = folder.projects();
    } catch (_e) {
      throw new Error(`Folder not found: ${args.folderId}`);
    }
  } else {
    projects = ofApp.defaultDocument.flattenedProjects();
  }

  const result = [];
  for (let i = 0; i < projects.length; i++) {
    const built = buildProject(projects[i]);
    if (args.status !== null && args.status !== undefined && built.status !== args.status) continue;
    result.push(built);
  }

  return JSON.stringify({ projects: result });
}
