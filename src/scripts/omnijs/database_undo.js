/**
 * OmniJS: undo the most recent document mutation.
 *
 * Wraps `Database.undo()`. Behaves identically to ⌘Z in the OmniFocus UI:
 * walks back one entry on the document's undo stack, regardless of whether
 * the mutation was issued by the MCP or another caller (manual edit, sync
 * replay, etc.). The agent contract is documented at the tool layer.
 *
 * Args injected as `globalThis.__args`: {} (no input)
 *
 * Returns JSON: { undid: boolean }
 *   - `true`  — an entry was undone
 *   - `false` — undo stack was empty (nothing to undo)
 *
 * @see #526
 */
(() => {
  // Database.undo() returns void in the OmniJS docs but throws when the
  // stack is empty in some versions. Belt-and-suspenders: catch and report
  // the empty-stack case as `undid: false` rather than propagating.
  try {
    Database.undo();
    return JSON.stringify({ undid: true });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    if (/nothing to undo|empty/i.test(msg)) {
      return JSON.stringify({ undid: false });
    }
    return JSON.stringify({ error: { code: "UNDO_FAILED", message: msg } });
  }
})();
