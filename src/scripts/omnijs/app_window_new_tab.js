/**
 * OmniJS: add a new tab to the front OmniFocus window.
 *
 * Wraps `document.newTabOnWindow(window)` using the front window (index 0).
 * The new tab opens with the app's default perspective.
 *
 * Args injected as `globalThis.__args`: {} (no input for now)
 *
 * Returns JSON: { perspectiveName: string | null, focusContainerIds: [] }
 *
 * @see #527
 */
(() => {
  try {
    const windows = document.windows;
    if (!windows || windows.length === 0) {
      return JSON.stringify({ error: { code: "WINDOW_UNAVAILABLE", message: "No open OmniFocus window" } });
    }
    const frontWindow = windows[0];
    const tab = document.newTabOnWindow(frontWindow);
    const perspectiveName = tab.perspective ? tab.perspective.name : null;
    return JSON.stringify({ perspectiveName, focusContainerIds: [] });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return JSON.stringify({ error: { code: "WINDOW_OPEN_FAILED", message: msg } });
  }
})();
