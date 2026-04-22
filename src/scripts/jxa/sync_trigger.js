/**
 * JXA: trigger Omni Sync.
 *
 * `Application("OmniFocus").defaultDocument.synchronize()` kicks off a sync
 * with the configured Omni Sync server. The call returns immediately — it
 * does not wait for the sync to complete — so we report the kickoff time
 * as `lastSyncAt` and `inFlight: false` for the round-trip.
 *
 * `runJxaScript` sees this script's `run(argv)` return value as a JSON
 * string, parses it, and surfaces the parsed object to the adapter.
 *
 * @see src/adapter/jxa/scriptRunner.ts
 * @see src/adapter/OmniFocusAdapter.ts — `syncTrigger()` contract
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(_argv) {
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  ofApp.defaultDocument.synchronize();
  const lastSyncAt = new Date().toISOString();
  return JSON.stringify({ lastSyncAt: lastSyncAt, inFlight: false });
}
