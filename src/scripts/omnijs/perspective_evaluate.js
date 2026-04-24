/**
 * perspective_evaluate.js — evaluate a custom OmniFocus perspective and
 * return its task list as domain `Task` objects.
 *
 * Called via the OmniJS transport (evaluateJavascript bridge).
 * Args injected as `globalThis.__args`:
 *   { identifier: string }
 *
 * Returns a JSON string: { tasks: Task[] } on success, or a JSON error
 * envelope `{ error: { code, message } }` for typed failures (Pro-gating,
 * unknown perspective identifier) that the caller maps to typed errors.
 *
 * Evaluation strategy (per Omni Automation): the perspective is set on the
 * front document window, and the resulting `content.rootNode.descendants`
 * are walked to collect every `Task` object. This mirrors what the user
 * would see if they switched to the perspective in the UI — the only API
 * surface OmniFocus exposes for perspective evaluation.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — evaluateCustomPerspective()
 * @see src/domain/task.ts — Task domain type
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */
(() => {
  const { identifier } = globalThis.__args;

  if (typeof Perspective === "undefined" || typeof Perspective.Custom === "undefined") {
    return JSON.stringify({
      error: { code: "FEATURE_REQUIRES_PRO", message: "Custom perspectives require OmniFocus Pro" },
    });
  }

  const persp = Perspective.Custom.byIdentifier(identifier);
  if (persp === null || persp === undefined) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Custom perspective not found: ${identifier}` },
    });
  }

  const win = document.windows[0];
  win.perspective = persp;

  function isoOrNull(d) {
    return d ? d.toISOString() : null;
  }

  function buildRepetition(task) {
    try {
      const rr = task.repetitionRule;
      if (!rr) return null;
      return { method: String(rr.method), unit: String(rr.unit), steps: rr.steps };
    } catch (_e) {
      return null;
    }
  }

  function buildTask(task) {
    const tagIds = [];
    try {
      const tags = task.tags;
      for (let i = 0; i < tags.length; i++) tagIds.push(tags[i].id.primaryKey);
    } catch (_e) {}

    let projectId = null;
    try {
      if (task.containingProject) projectId = task.containingProject.id.primaryKey;
    } catch (_e) {}

    let parentId = null;
    try {
      if (task.parent && task.parent instanceof Task) parentId = task.parent.id.primaryKey;
    } catch (_e) {}

    return {
      id: task.id.primaryKey,
      name: task.name,
      note: task.note || null,
      noteHtml: null,
      projectId,
      parentId,
      tagIds,
      deferDate: isoOrNull(task.deferDate),
      dueDate: isoOrNull(task.dueDate),
      estimatedMinutes: task.estimatedMinutes ?? null,
      flagged: !!task.flagged,
      completed: !!task.completed,
      completedAt: isoOrNull(task.completionDate),
      dropped: !!task.dropped,
      droppedAt: isoOrNull(task.dropDate),
      available: !task.blocked && !task.completed && !task.dropped,
      blocked: !!task.blocked,
      sequential: !!task.sequential,
      completedByChildren: !!task.completedByChildren,
      repetition: buildRepetition(task),
      createdAt: isoOrNull(task.added) ?? new Date().toISOString(),
      modifiedAt: isoOrNull(task.modified) ?? new Date().toISOString(),
    };
  }

  const tasks = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node) return;
    try {
      const obj = node.object;
      if (obj instanceof Task && !seen.has(obj.id.primaryKey)) {
        seen.add(obj.id.primaryKey);
        tasks.push(buildTask(obj));
      }
    } catch (_e) {}
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) walk(children[i]);
  };
  walk(win.content.rootNode);

  return JSON.stringify({ tasks });
})();
