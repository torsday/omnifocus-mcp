/**
 * JXA: fetch one project by ID.
 *
 * Args (argv[0] JSON): { id: string }
 * Returns JSON: { project: Project }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_project.js

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  for (let i = 0; i < allProjects.length; i++) {
    if (allProjects[i].id() === args.id) {
      return JSON.stringify({ project: buildProject(allProjects[i]) });
    }
  }

  throw new Error(`Project not found: ${args.id}`);
}
