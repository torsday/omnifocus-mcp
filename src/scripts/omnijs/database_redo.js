/**
 * OmniJS: redo the most recently undone mutation.
 *
 * Wraps `Database.redo()`. Behaves identically to ⌘⇧Z in the OmniFocus UI:
 * advances one entry on the document's redo stack. Any mutation between
 * undo and redo invalidates the redo stack (matching UI semantics).
 *
 * Args injected as `globalThis.__args`: {} (no input)
 *
 * Returns JSON: { redid: boolean }
 *   - `true`  — an entry was redone
 *   - `false` — redo stack was empty
 *
 * @see #526
 */
(() => {
  try {
    Database.redo();
    return JSON.stringify({ redid: true });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    if (/nothing to redo|empty/i.test(msg)) {
      return JSON.stringify({ redid: false });
    }
    return JSON.stringify({ error: { code: "REDO_FAILED", message: msg } });
  }
})();
