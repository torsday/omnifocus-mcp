/**
 * `PluginService` — invoke a named Omni Automation plug-in action.
 *
 * Thin facade over `adapter.pluginInvoke()`. The adapter method is routed to
 * `OmniJsTransport` (OmniJS has the only PlugIn runtime; JXA stubs throw
 * `not-yet-wired`).
 *
 * @see src/adapter/OmniFocusAdapter.ts — PluginInvokeInput / PluginInvokeResult
 * @see src/adapter/omnijs/OmniJsTransport.ts — pluginInvoke() implementation
 * @see src/scripts/omnijs/plugin_invoke.js — OmniJS script
 */

import type { OmniFocusAdapter, PluginInvokeInput } from "../adapter/OmniFocusAdapter.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface PluginInvokeServiceInput {
  /** Bundle identifier of the Omni Automation plug-in to invoke. */
  identifier: string;
  /**
   * Optional argument forwarded to the plug-in action as `Action.args[0]`.
   * Must be JSON-serialisable. Defaults to `null`.
   */
  arg?: unknown;
}

export interface PluginInvokeServiceResult {
  /** The value returned by the plug-in action (deserialised from JSON). */
  result: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PluginServiceDeps {
  adapter: OmniFocusAdapter;
}

/**
 * Service layer for plug-in invocation.
 *
 * Construct with `{ adapter }`. No mutable state; safe to call concurrently
 * (though the OmniJS transport serialises underlying OS calls).
 */
export class PluginService {
  private readonly adapter: OmniFocusAdapter;

  constructor({ adapter }: PluginServiceDeps) {
    this.adapter = adapter;
  }

  /**
   * Invoke the named plug-in and return its result.
   *
   * @param input — plug-in identifier + optional argument
   * @returns The plug-in's return value (arbitrary JSON).
   * @throws {NotFound} when no plug-in with the given identifier is installed.
   * @throws {ScriptError} when the plug-in throws or returns malformed output.
   * @throws {FeatureRequiresPro} when the Automation runtime is unavailable.
   */
  async invoke(input: PluginInvokeServiceInput): Promise<PluginInvokeServiceResult> {
    const adapterInput: PluginInvokeInput = {
      identifier: input.identifier,
      ...(input.arg !== undefined ? { arg: input.arg } : {}),
    };
    const raw = await this.adapter.pluginInvoke(adapterInput);
    return { result: raw.result };
  }
}
