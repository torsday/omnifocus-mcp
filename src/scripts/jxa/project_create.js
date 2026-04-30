/**
 * JXA: create a new project.
 *
 * Args (argv[0] JSON): { name: string, folderId?: string|null, note?: string|null,
 *   deferDate?: string|null, dueDate?: string|null, estimatedMinutes?: number|null,
 *   flagged?: boolean, status?: string|null, tagIds?: string[] }
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

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }

  const props = { name: args.name };
  if (args.note != null) props.note = args.note;
  if (args.deferDate != null) props.deferDate = new Date(args.deferDate);
  if (args.dueDate != null) props.dueDate = new Date(args.dueDate);
  if (args.estimatedMinutes != null) props.estimatedMinutes = args.estimatedMinutes;
  if (args.flagged != null) props.flagged = args.flagged;
  if (args.status != null) {
    // OmniFocus 4.8.8+ requires the " status" suffix on assignment values
    // (without it the assignment silently no-ops on `on hold`). Same as the
    // fix in project_update.js. Note: createProject now routes through
    // OmniJS per ADR-0019, so this JXA path is effectively dead code; the
    // fix is here for defense in depth in case the routing flips back.
    props.status = args.status === "on-hold" ? "on hold status" : "active status";
  }

  // OmniFocus 4.x rejects `doc.make({ new: "project", withProperties })` with
  // error -10024. The working pattern mirrors the inbox-task fix in #275:
  // construct a specifier via the class name and push it onto the collection.
  // @inline _helpers/lookup_or_throw.js

  let newProj;
  if (args.folderId) {
    const folder = lookupOrThrow(
      ofApp.defaultDocument.folders.byId(args.folderId),
      "Folder",
      args.folderId,
    );
    newProj = ofApp.Project(props);
    folder.projects.push(newProj);
  } else {
    newProj = ofApp.Project(props);
    ofApp.defaultDocument.projects.push(newProj);
  }

  return JSON.stringify({ project: buildProject(newProj) });
}
