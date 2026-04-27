/**
 * OmniJS: open a new OmniFocus window.
 *
 * Wraps `document.newWindow()`. The new window opens in the foreground with
 * the app's default perspective. No args.
 *
 * Returns JSON: { perspectiveName: string | null, focusContainerIds: [] }
 *
 * @see #527
 */
(() => {
  try {
    const w = document.newWindow();
    const perspectiveName = w.perspective ? w.perspective.name : null;
    return JSON.stringify({ perspectiveName, focusContainerIds: [] });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return JSON.stringify({ error: { code: "WINDOW_OPEN_FAILED", message: msg } });
  }
})();
