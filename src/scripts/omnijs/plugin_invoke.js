/**
 * plugin_invoke.js — invoke a named Omni Automation plug-in action.
 *
 * Called via the OmniJS transport (evaluateJavascript bridge).
 * Args injected as `globalThis.__args`:
 *   { identifier: string, arg?: unknown }
 *
 * Returns a JSON string: { result: <plug-in return value> }
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — pluginInvoke()
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */
(() => {
  const { identifier, arg = null } = globalThis.__args;

  const plugin = PlugIn.find(identifier);
  if (plugin === null) {
    throw new Error(`PlugIn not found: ${identifier}`);
  }

  // The PlugIn.Action runtime is available from OmniFocus Standard+.
  // `plugin.action(identifier)` returns the default action when no name is
  // supplied; per the Omni Automation spec the default action is the one
  // whose `name` matches the plug-in's bundle identifier.
  const action = plugin.action(identifier);
  if (action === null) {
    throw new Error(`No default action found in PlugIn: ${identifier}`);
  }

  const rawResult = action.perform([arg]);
  return JSON.stringify({ result: rawResult ?? null });
})();
