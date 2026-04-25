# Spike: Task Reorder — JXA splice vs OmniJS ChildInsertionLocation

**Date:** 2026-04-24  
**Issue:** [#360](https://github.com/torsday/omnifocus-mcp/issues/360)  
**Blocks:** [#350](https://github.com/torsday/omnifocus-mcp/issues/350) — Implement reorderTask and task_reorder MCP tool  
**Time-boxed:** 1 hour

---

## Question

Which transport should `task_reorder` use — JXA `task.move()` with `positioned:` (Route A) or OmniJS `moveTasks()` with `ChildInsertionLocation` (Route B)?

---

## What Already Exists

`src/scripts/jxa/task_reorder.js` and `JxaTransport.reorderTask()` are already wired and call `task.move({ to: ref, positioned: ... })`. The router currently routes `reorderTask → jxa`. This spike evaluates whether that approach is reliable.

---

## Route A — JXA `task.move()` with `positioned:`

### API

```javascript
// before/after a sibling
task.move({ to: refTask, positioned: "before" | "after" });

// to beginning/end of a container
task.move({ to: container, positioned: "beginning" | "end" });
```

### Known Failure Mode

`task.move()` without `positioned:` is broken in OmniFocus 4.x — it throws error −1708 / error 9 "Replacement not supported currently". This is precisely why `adapter.moveTask()` (reparenting) was rerouted to OmniJS in a previous sprint (see `docs/adr/0002-omnifocus-transport-dual.md`).

The `positioned:` variant may or may not share this bug — it is undocumented whether Apple's JXA bridge differentiates the two call forms at the AppleScript level. The existing `task_reorder.js` script uses `positioned:` and has not been integration-tested against OF 4.x.

### Risk Assessment

| Shape | Likely Outcome |
|---|---|
| `before` / `after` sibling | **Uncertain** — `task.move({ positioned: })` may hit error 9 like the non-positioned form did |
| `start` / `end` of project | **Uncertain** — same risk; container reference via `flattenedProjects.byId()` is also unverified |
| Inbox `start` / `end` | **Likely broken** — `doc.inboxTasks` is a collection, not a valid `move` target in OF 4.x |

**Verdict: Route A carries unacceptable risk.** The `task.move()` API is the same broken call site that forced rerouting of `moveTask`. We cannot ship a tool that silently does nothing or throws opaque error 9 on OF 4.x without live integration tests confirming the `positioned:` form works.

---

## Route B — OmniJS `moveTasks()` with `ChildInsertionLocation`

### API

```javascript
// before/after a sibling
moveTasks([task], sibling.before);   // ChildInsertionLocation.before(task)
moveTasks([task], sibling.after);    // ChildInsertionLocation.after(task)

// to beginning/end of a container (project, parent task, or inbox)
moveTasks([task], container.beginning);
moveTasks([task], container.ending);
```

### Evidence It Works

`adapter.moveTask()` already routes to OmniJS and calls `moveTasks([task], parent)` successfully. The same `moveTasks` function accepts `ChildInsertionLocation` values for precise sibling positioning. OmniJS is the definitive OmniFocus scripting API and is what the Omni team recommends for automation that goes beyond basic AppleScript.

The `task_move.js` OmniJS script already demonstrates correct usage of `moveTasks` + `inbox.beginning` for inbox placement. Extending this to `sibling.before` / `sibling.after` / `container.beginning` / `container.ending` is a mechanical extension of proven code.

### Required Changes

1. Add `src/scripts/omnijs/task_reorder.js` — new OmniJS script
2. Add `OmniJsTransport.reorderTask()` — wire the script
3. Change `router.ts`: `reorderTask: "jxa"` → `reorderTask: "omnijs"`
4. Update router test: add `reorderTask` to the OmniJS-only list assertion
5. Keep `JxaTransport.reorderTask()` stub but replace `notYetWired` with a `ScriptError` explaining the routing (same pattern as `pluginInvoke` after #355)

### OmniJS Script Sketch

```javascript
(() => {
  const { id, mode, refId, container } = globalThis.__args;

  const task = flattenedTasks.filter((t) => t.id.primaryKey === id)[0];
  if (!task) return JSON.stringify({ error: { code: "NOT_FOUND", message: `Task not found: ${id}` } });

  let location;
  if (mode === "before" || mode === "after") {
    const ref = flattenedTasks.filter((t) => t.id.primaryKey === refId)[0];
    if (!ref) return JSON.stringify({ error: { code: "NOT_FOUND", message: `Ref task not found: ${refId}` } });
    location = mode === "before" ? ref.before : ref.after;
  } else {
    // mode === "start" or "end"
    let c;
    if (container?.projectId) {
      c = flattenedProjects.filter((p) => p.id.primaryKey === container.projectId)[0];
      if (!c) return JSON.stringify({ error: { code: "NOT_FOUND", message: `Project not found: ${container.projectId}` } });
    } else if (container?.parentId) {
      c = flattenedTasks.filter((t) => t.id.primaryKey === container.parentId)[0];
      if (!c) return JSON.stringify({ error: { code: "NOT_FOUND", message: `Parent task not found: ${container.parentId}` } });
    } else {
      c = inbox;
    }
    location = mode === "start" ? c.beginning : c.ending;
  }

  moveTasks([task], location);
  return JSON.stringify({ id });
})();
```

---

## Recommendation

**Use Route B (OmniJS).** Rationale:

1. **Proven API.** `moveTasks()` is already used successfully by `adapter.moveTask()`. `ChildInsertionLocation` (.before / .after / .beginning / .ending) is the canonical OmniJS positioning API.
2. **Known Route A failure.** `task.move()` without `positioned:` is broken in OF 4.x (error 9). The `positioned:` variant is unverified on OF 4.x and the existing `task_reorder.js` script is untested against a live OF 4.x instance.
3. **Consistency.** Both reparenting (`moveTask`) and reordering (`reorderTask`) manipulate task position in the task graph. Routing both through the same OmniJS `moveTasks` API keeps the semantics unified.
4. **Low migration cost.** The routing-table change is a one-line edit; the OmniJS script is ~50 lines following the established `task_move.js` pattern.

---

## Impact on #350

Update #350's implementation plan:

- **Script:** `src/scripts/omnijs/task_reorder.js` (not JXA)
- **Transport method:** `OmniJsTransport.reorderTask()` (new)
- **Router change:** `reorderTask: "jxa"` → `reorderTask: "omnijs"`
- **JxaTransport stub:** Replace body with `ScriptError("reorderTask routes to OmniJsTransport")`
- **Contract test:** Add `reorderTask` to the OmniJS-only assertion in `router.test.ts`

The `TaskPosition` type and the handler layer (`src/tools/task/reorder.ts`) are transport-agnostic and need no changes.
