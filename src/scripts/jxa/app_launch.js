/**
 * app_launch.js — launch OmniFocus explicitly (never automatic).
 *
 * Per SPEC resolved-decisions: automatic launch is out of scope — agents must
 * call this tool explicitly when the user asks to open OmniFocus.
 *
 * Returns JSON: { launched: boolean, alreadyRunning: boolean }
 *   - alreadyRunning=true  → OF was already open; no window was raised
 *   - launched=true        → OF was not running and was launched
 *   - launched=false       → already running (idempotent)
 *
 * @see src/adapter/jxa/JxaTransport.ts — appLaunch()
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run() by convention.
function run(_argv) {
  const SystemEvents = Application("System Events");
  const ofProcesses = SystemEvents.processes.whose({ name: "OmniFocus" })();
  const alreadyRunning = ofProcesses.length > 0;

  if (!alreadyRunning) {
    const app = Application("OmniFocus");
    app.activate();
  }

  return JSON.stringify({ launched: !alreadyRunning, alreadyRunning });
}
