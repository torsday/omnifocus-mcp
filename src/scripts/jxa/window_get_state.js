/**
 * JXA: read the current state of OmniFocus's front window.
 *
 * Returns JSON: { perspectiveName, focusContainerIds }
 *   - `perspectiveName`     — name of the active perspective (e.g. "Forecast")
 *   - `focusContainerIds[]` — IDs of projects/folders the window is focused on
 *                             (empty array when nothing is focused)
 *  or { error: { code: "NO_FRONT_WINDOW", message } } when OF has no front window
 *
 * @see #466
 * @see src/adapter/jxa/JxaTransport.ts — getWindowState() caller
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run() by convention.
function run(_argv) {
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  const wins = ofApp.windows();
  if (!wins || wins.length === 0) {
    return JSON.stringify({
      error: { code: "NO_FRONT_WINDOW", message: "OmniFocus has no front window" },
    });
  }

  const w = wins[0];
  let perspectiveName = null;
  try {
    perspectiveName = String(w.perspectiveName());
  } catch (_e) {
    perspectiveName = null;
  }

  // Focus is a (possibly empty) array of containers (sections / projects /
  // folders). We surface the IDs in input order; `[]` means nothing is focused.
  const focusContainerIds = [];
  try {
    const focus = w.focus();
    if (focus && focus.length) {
      for (let i = 0; i < focus.length; i++) {
        try {
          focusContainerIds.push(String(focus[i].id()));
        } catch (_e) {
          // Skip containers we can't introspect (defensive — shouldn't happen).
        }
      }
    }
  } catch (_e) {
    // No focus set — leave focusContainerIds as []
  }

  return JSON.stringify({ perspectiveName, focusContainerIds });
}
