/**
 * JXA: mark a project complete.
 *
 * Args (argv[0] JSON): { id: string, completionDate?: string|null }
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  let target = null;
  for (let i = 0; i < allProjects.length; i++) {
    if (allProjects[i].id() === args.id) {
      target = allProjects[i];
      break;
    }
  }
  if (!target) throw new Error(`Project not found: ${args.id}`);

  ofApp.markComplete(target);

  if (args.completionDate != null) {
    try {
      target.completionDate = new Date(args.completionDate);
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  return JSON.stringify({ id: args.id });
}
