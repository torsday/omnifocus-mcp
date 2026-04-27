/**
 * OmniJS: clear all alarms/notifications from a task.
 *
 * Args injected as `globalThis.__args`: { taskId: string }
 *
 * Returns JSON: { ok: true } | { error: { code, message } }
 *
 * Equivalent to `task_set_alarms` with an empty `alarms` array, but
 * exposed as a dedicated verb so the tool surface is consistent with
 * `task_clear_repetition`.
 *
 * @see #461
 */
(() => {
  const args = globalThis.__args || {};
  const taskId = args.taskId;

  if (typeof taskId !== "string" || !taskId) {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "taskId must be a non-empty string" },
    });
  }

  const task = Task.byIdentifier(taskId);
  if (!task) {
    return JSON.stringify({
      error: { code: "NOT_FOUND", message: `Task ${taskId} not found` },
    });
  }

  const existing = Array.from(task.notifications);
  for (const n of existing) {
    try {
      n.removeFromContainer();
    } catch (_e) {
      // Best-effort; continue
    }
  }

  return JSON.stringify({ ok: true });
})();
