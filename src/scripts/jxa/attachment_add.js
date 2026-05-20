// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: add an attachment to a task or project from a local file path.
 *
 * Args (argv[0] JSON): { taskId?: string, projectId?: string, filePath: string }
 * Exactly one of taskId / projectId must be provided.
 *
 * Returns JSON: { id: string }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = true;
  const doc = ofApp.defaultDocument;

  function findOwner() {
    if (args.taskId) {
      const tasks = doc.flattenedTasks();
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].id() === args.taskId) return tasks[i];
      }
      throw new Error(`Task not found: ${args.taskId}`);
    }
    if (args.projectId) {
      const projects = doc.flattenedProjects();
      for (let i = 0; i < projects.length; i++) {
        if (projects[i].id() === args.projectId) return projects[i];
      }
      throw new Error(`Project not found: ${args.projectId}`);
    }
    throw new Error("One of taskId or projectId is required");
  }

  const owner = findOwner();

  // Build a FileAttachment from the path and push it onto the owner
  const fileUrl = Path(args.filePath);
  const att = ofApp.FileAttachment({ file: fileUrl });
  owner.fileAttachments.push(att);

  // The new attachment is the last element in the collection
  const atts = owner.fileAttachments();
  const newAtt = atts[atts.length - 1];
  return JSON.stringify({ id: newAtt.id() });
}
