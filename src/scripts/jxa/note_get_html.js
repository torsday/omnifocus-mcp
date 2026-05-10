/**
 * JXA: fetch the HTML note for a task or project by ID.
 *
 * Args (argv[0] JSON): { kind: "task" | "project", id: string }
 * Returns JSON: { noteHtml: string | null }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/tools/note/get_html.ts — MCP tool
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  let item;
  if (args.kind === "task") {
    item = ofApp.defaultDocument.flattenedTasks.byId(args.id);
  } else {
    item = ofApp.defaultDocument.flattenedProjects.byId(args.id);
  }

  // biome-ignore lint/complexity/useOptionalChain: JXA runtime — optional chain breaks bridge calls
  if (!item || !item.id || !item.id()) {
    throw new Error(`NotFound: ${args.kind} not found: ${args.id}`);
  }

  let noteHtml = null;
  try {
    if (item.noteHtml) noteHtml = item.noteHtml() || null;
  } catch (_e) {
    /* OF 4.x: noteHtml may not exist on all item types — null used */
  }

  return JSON.stringify({ noteHtml });
}
