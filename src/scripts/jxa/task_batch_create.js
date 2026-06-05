// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: batch-create tasks in a single round-trip.
 *
 * Args (argv[0] JSON): { inputs: CreateTaskInput[] }
 * Returns JSON: { succeeded: [{index, value}], failed: [{index, errorCode, message}] }
 *
 * Best-effort: per-item errors are captured into `failed[]` and the rest of
 * the batch proceeds. Validation (atomic all-or-nothing) is the tool layer's
 * job — by the time we get here the inputs are already schema-valid.
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

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < args.inputs.length; i++) {
    const input = args.inputs[i];
    try {
      /** @type {Record<string, unknown>} */
      const props = { name: input.name };
      if (input.note != null) props.note = input.note;
      if (input.flagged != null) props.flagged = input.flagged;
      if (input.deferDate != null) props.deferDate = new Date(input.deferDate);
      if (input.dueDate != null) props.dueDate = new Date(input.dueDate);
      if (input.estimatedMinutes != null) props.estimatedMinutes = input.estimatedMinutes;
      if (input.sequential != null) props.sequential = input.sequential;

      // OmniFocus 4.x rejects `container.make({ new: "task", withProperties })`
      // with -10024 ("Can't make or move that element into that container").
      // Mirror the working pattern singular task_create.js uses (#275/#319):
      // construct a `Task`/`InboxTask` specifier and push it onto the target
      // collection. `.id()` is safe immediately after push (see #1074).
      let newTask;
      if (input.parentId) {
        const parent = lookupOrThrow(
          doc.flattenedTasks.byId(input.parentId),
          "OF_NOT_FOUND: parent task",
          input.parentId,
        );
        newTask = ofApp.Task(props);
        parent.tasks.push(newTask);
      } else if (input.projectId) {
        const proj = lookupOrThrow(
          doc.flattenedProjects.byId(input.projectId),
          "OF_NOT_FOUND: project",
          input.projectId,
        );
        newTask = ofApp.Task(props);
        proj.tasks.push(newTask);
      } else {
        // Inbox creation: `doc.make({ new: "inboxTask" })` fails with -10024
        // on OmniFocus 4.x. See issue #275.
        newTask = ofApp.InboxTask(props);
        doc.inboxTasks.push(newTask);
      }

      if (input.tagIds) {
        for (let t = 0; t < input.tagIds.length; t++) {
          try {
            const tag = doc.flattenedTags.byId(input.tagIds[t]);
            newTask.addTag(tag);
          } catch (_e) {
            /* OF 4.x: property access may not exist on all object types — default used */
          }
        }
      }

      if (input.completedByChildren != null) {
        try {
          newTask.containsSingletonActions = input.completedByChildren;
        } catch (_e) {
          /* OF 4.x: property access may not exist on all object types — default used */
        }
      }

      succeeded.push({ index: i, value: newTask.id() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/^(OF_[A-Z_]+):/);
      const errorCode = m ? m[1] : "OF_UNKNOWN";
      failed.push({ index: i, errorCode: errorCode, message: msg });
    }
  }

  return JSON.stringify({ succeeded: succeeded, failed: failed });
}
