/**
 * JXA: fetch multiple projects by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { projects: (Project | null)[] }
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

  const idSet = {};
  for (let i = 0; i < args.ids.length; i++) {
    idSet[args.ids[i]] = null;
  }

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  for (let i = 0; i < allProjects.length; i++) {
    const pid = allProjects[i].id();
    if (Object.hasOwn(idSet, pid)) {
      idSet[pid] = buildProject(allProjects[i]);
    }
  }

  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    results.push(idSet[args.ids[i]]);
  }

  return JSON.stringify({ projects: results });
}
