/**
 * JXA: reorder a task relative to its siblings.
 *
 * Args (argv[0] JSON):
 *   { id: string,
 *     mode: "before" | "after" | "start" | "end",
 *     refId?: string,             // required when mode = before|after
 *     container?: {               // required when mode = start|end
 *       projectId?: string | null,
 *       parentId?: string | null,
 *       inbox?: true
 *     }
 *   }
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
  const doc = ofApp.defaultDocument;

  // @inline _helpers/lookup_or_throw.js

  const task = lookupOrThrow(doc.flattenedTasks.byId(args.id), "Task", args.id);

  if (args.mode === "before" || args.mode === "after") {
    if (!args.refId) throw new Error(`reorderTask: refId required for mode=${args.mode}`);
    const ref = lookupOrThrow(doc.flattenedTasks.byId(args.refId), "Reference task", args.refId);
    // OmniFocus JXA: move <task> to <before|after> <reference>
    task.move({ to: ref, positioned: args.mode });
  } else if (args.mode === "start" || args.mode === "end") {
    const c = args.container || {};
    let container;
    if (c.projectId) {
      container = lookupOrThrow(doc.flattenedProjects.byId(c.projectId), "Project", c.projectId);
    } else if (c.parentId) {
      container = lookupOrThrow(doc.flattenedTasks.byId(c.parentId), "Parent task", c.parentId);
    } else {
      // Inbox: move into the document's inbox.
      container = doc.inboxTasks;
      // For inbox, move() expects a list reference.
      task.move({ to: container, positioned: args.mode === "start" ? "beginning" : "end" });
      return JSON.stringify({ id: args.id });
    }
    task.move({ to: container, positioned: args.mode === "start" ? "beginning" : "end" });
  } else {
    throw new Error(`reorderTask: unknown mode: ${args.mode}`);
  }

  return JSON.stringify({ id: args.id });
}
