/**
 * JXA: update task fields.
 *
 * Args (argv[0] JSON): {
 *   id: string,
 *   name?: string, note?: string|null, flagged?: boolean,
 *   deferDate?: string|null, dueDate?: string|null,
 *   estimatedMinutes?: number|null, tagIds?: string[],
 *   sequential?: boolean, completedByChildren?: boolean
 * }
 * Returns JSON: { task: Task }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_task.js

  const allTasks = ofApp.defaultDocument.flattenedTasks(); /* narrow-scan-ok: must resolve task by id; no scope hint available */
  let found = null;
  for (let i = 0; i < allTasks.length; i++) {
    if (allTasks[i].id() === args.id) {
      found = allTasks[i];
      break;
    }
  }
  if (!found) throw new Error(`Task not found: ${args.id}`);

  if (args.name !== undefined) found.name = args.name;
  if (Object.hasOwn(args, "note")) {
    found.note = args.note ?? "";
  }
  if (args.flagged !== undefined) found.flagged = args.flagged;
  if (Object.hasOwn(args, "deferDate")) {
    found.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  }
  if (Object.hasOwn(args, "dueDate")) {
    found.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  }
  if (Object.hasOwn(args, "estimatedMinutes")) {
    found.estimatedMinutes = args.estimatedMinutes;
  }
  if (args.sequential !== undefined) found.sequential = args.sequential;
  if (args.completedByChildren !== undefined) {
    try {
      found.containsSingletonActions = args.completedByChildren;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  if (args.tagIds !== undefined) {
    // OmniFocus 4.x: JXA's task.addTag(tag) / task.removeTag(tag) silently
    // no-op on existing tasks resolved by id (#716) — the call returns without
    // error but no row is written to the underlying SQLite TaskToTag table.
    // OmniJS's Task.addTag / Task.removeTag are reliable, so delegate the
    // tag-set replacement to OmniJS via evaluateJavascript. Tag IDs missing
    // from the OmniJS store are silently skipped (matches caller-layer
    // semantics in src/tools/task/update.ts which validates existence first).
    const omniJsScript =
      "(() => {" +
      "  const t = Task.byIdentifier(" +
      JSON.stringify(args.id) +
      ");" +
      "  if (!t) return;" +
      "  const desired = " +
      JSON.stringify(args.tagIds) +
      ";" +
      "  const existing = t.tags.slice();" +
      "  for (let i = 0; i < existing.length; i++) t.removeTag(existing[i]);" +
      "  for (let i = 0; i < desired.length; i++) {" +
      "    const tg = Tag.byIdentifier(desired[i]);" +
      "    if (tg) t.addTag(tg);" +
      "  }" +
      "})()";
    ofApp.evaluateJavascript(omniJsScript);
  }

  return JSON.stringify({ task: buildTask(found) });
}
