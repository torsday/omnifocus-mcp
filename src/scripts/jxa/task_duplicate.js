// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: duplicate a task. Editable fields copy; completed/dropped state reset.
 * When recursive=true, subtask tree is cloned depth-first, preserving order.
 *
 * Args (argv[0] JSON):
 *   { id: string,
 *     recursive: boolean,
 *     destination?: { projectId?: string, parentId?: string, toInbox?: true }
 *   }
 * Returns JSON: { newId: string, descendantCount: number }
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

  const source = lookupOrThrow(doc.flattenedTasks.byId(args.id), "Task", args.id);

  let destContainer; // OF object: project | parent task | document (inbox)
  if (args.destination?.projectId) {
    destContainer = lookupOrThrow(
      doc.flattenedProjects.byId(args.destination.projectId),
      "Project",
      args.destination.projectId,
    );
  } else if (args.destination?.parentId) {
    destContainer = lookupOrThrow(
      doc.flattenedTasks.byId(args.destination.parentId),
      "Parent task",
      args.destination.parentId,
    );
  } else if (args.destination && args.destination.toInbox === true) {
    destContainer = doc; // inbox = document-level make
  } else {
    // Default: alongside source. Prefer parent task, else containing project, else inbox.
    const pt = source.parentTask();
    if (pt) {
      destContainer = pt;
    } else {
      // See task_get.js — `cp.class()` throws on real projects in OF 4.x
      // (#673), and the throw used to escape this if-condition unhandled,
      // exiting the whole script with `JXA script failed (exit 1)`.
      const cp = source.containingProject();
      if (cp) {
        let isDocument = false;
        try {
          // @ts-expect-error — OF 4.x: `.class()` is a runtime call on Project
          // that throws on real projects (#673); the typed sdef omits it.
          isDocument = cp.class() === "document";
        } catch (_classErr) {
          /* OF 4.x: real projects throw here */
        }
        destContainer = isDocument ? doc : cp;
      } else {
        destContainer = doc;
      }
    }
  }

  /** @param {Task} task */
  function copyProps(task) {
    /** @type {Record<string, unknown>} */
    const props = { name: task.name() };
    try {
      const n = task.note();
      if (n) props.note = n;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    try {
      props.flagged = task.flagged();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    try {
      const dd = task.deferDate();
      if (dd) props.deferDate = dd;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    try {
      const due = task.dueDate();
      if (due) props.dueDate = due;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    try {
      const em = task.estimatedMinutes();
      if (em != null) props.estimatedMinutes = em;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    try {
      props.sequential = task.sequential();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
    return props;
  }

  /**
   * @param {Task | Project | Document} container
   * @param {Record<string, unknown>} props
   */
  function makeInto(container, props) {
    if (container === doc) {
      // Inbox creation requires `InboxTask + inboxTasks.push` — OmniFocus 4.x
      // rejects `doc.make({ new: "inboxTask" })` with -10024. See issue #275.
      const task = Application("OmniFocus").InboxTask(props);
      doc.inboxTasks.push(task);
      return task;
    }
    // `container === doc` already returned above, but TS doesn't narrow
    // identity equality with a non-literal singleton; cast to the post-narrow
    // union so `.make()` (added in slice 19 to Task and Project) resolves.
    return /** @type {Task | Project} */ (container).make({
      new: "task",
      withProperties: props,
    });
  }

  /**
   * @param {Task} from
   * @param {Task} to
   */
  function copyTags(from, to) {
    try {
      const tags = from.tags();
      for (let i = 0; i < tags.length; i++) {
        try {
          to.addTag(tags[i]);
        } catch (_e) {
          /* OF 4.x: property access may not exist on all object types — default used */
        }
      }
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }
  }

  const rootClone = makeInto(destContainer, copyProps(source));
  copyTags(source, rootClone);

  let descendantCount = 0;
  if (args.recursive) {
    /**
     * @param {Task} srcTask
     * @param {Task} cloneTask
     */
    function walk(srcTask, cloneTask) {
      /** @type {any[]} */
      let children = [];
      try {
        children = srcTask.tasks();
      } catch (_e) {
        /* OF 4.x: property access may not exist on all object types — default used */
      }
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childClone = cloneTask.make({ new: "task", withProperties: copyProps(child) });
        copyTags(child, childClone);
        descendantCount += 1;
        walk(child, childClone);
      }
    }
    walk(source, rootClone);
  }

  return JSON.stringify({ newId: rootClone.id(), descendantCount: descendantCount });
}
