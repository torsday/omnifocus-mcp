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

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  const source = doc.flattenedTasks.byId(args.id);
  if (!source) throw new Error(`Task not found: ${args.id}`);

  let destContainer; // OF object: project | parent task | document (inbox)
  if (args.destination && args.destination.projectId) {
    destContainer = doc.flattenedProjects.byId(args.destination.projectId);
    if (!destContainer) throw new Error(`Project not found: ${args.destination.projectId}`);
  } else if (args.destination && args.destination.parentId) {
    destContainer = doc.flattenedTasks.byId(args.destination.parentId);
    if (!destContainer) throw new Error(`Parent task not found: ${args.destination.parentId}`);
  } else if (args.destination && args.destination.toInbox === true) {
    destContainer = doc; // inbox = document-level make
  } else {
    // Default: alongside source. Prefer parent task, else containing project, else inbox.
    const pt = source.parentTask();
    if (pt) {
      destContainer = pt;
    } else {
      const cp = source.containingProject();
      if (cp && cp.class() !== "document") destContainer = cp;
      else destContainer = doc;
    }
  }

  function copyProps(task) {
    const props = { name: task.name() };
    try {
      const n = task.note();
      if (n) props.note = n;
    } catch (_e) {}
    try {
      props.flagged = task.flagged();
    } catch (_e) {}
    try {
      const dd = task.deferDate();
      if (dd) props.deferDate = dd;
    } catch (_e) {}
    try {
      const due = task.dueDate();
      if (due) props.dueDate = due;
    } catch (_e) {}
    try {
      const em = task.estimatedMinutes();
      if (em != null) props.estimatedMinutes = em;
    } catch (_e) {}
    try {
      props.sequential = task.sequential();
    } catch (_e) {}
    return props;
  }

  function makeInto(container, props) {
    if (container === doc) {
      return doc.make({ new: "inboxTask", withProperties: props });
    }
    return container.make({ new: "task", withProperties: props });
  }

  function copyTags(from, to) {
    try {
      const tags = from.tags();
      for (let i = 0; i < tags.length; i++) {
        try {
          to.addTag(tags[i]);
        } catch (_e) {}
      }
    } catch (_e) {}
  }

  const rootClone = makeInto(destContainer, copyProps(source));
  copyTags(source, rootClone);

  let descendantCount = 0;
  if (args.recursive) {
    function walk(srcTask, cloneTask) {
      let children = [];
      try {
        children = srcTask.tasks();
      } catch (_e) {}
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
