/**
 * `omnifocus://capabilities` MCP resource.
 *
 * Returns a structured capabilities object so agents can discover feature
 * availability at session start, avoiding round-trip tool calls that would
 * trigger `FeatureRequiresPro` or `FeatureRequiresOfVersion` errors.
 *
 * **ofVersion / ofEdition** default to `"unknown"` / `"standard"` until the
 * lazy OF probe (#36) runs. Features that require Pro are `false` until the
 * edition is confirmed.
 *
 * @see DESIGN.md §33 — capabilities resource
 * @see src/config/env.ts — config values surfaced here
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config/env.js";

// ---------------------------------------------------------------------------
// Capabilities shape
// ---------------------------------------------------------------------------

/** Structured capabilities returned by `omnifocus://capabilities`. */
export interface Capabilities {
  /** OmniFocus version string, e.g. `"4.2.1"`. `"unknown"` before OF probe. */
  ofVersion: string;
  /** OmniFocus edition. `"standard"` before OF probe confirms Pro. */
  ofEdition: "standard" | "pro";
  transports: {
    jxa: { available: boolean; timeoutMs: number };
    omnijs: { available: boolean; timeoutMs: number };
  };
  features: {
    /** Custom perspectives (OmniFocus Pro only). */
    customPerspectives: boolean;
    /** Forecast tag assignment (OmniFocus Pro only). */
    forecastTag: boolean;
    /** Repeating task rules (OmniFocus Pro only). */
    repetitionRules: boolean;
    /** Plugin / automation invocation (OmniFocus Pro only). */
    pluginInvocation: boolean;
    /** Raw JXA / OmniJS escape-hatch tools, enabled via OMNIFOCUS_ALLOW_RAW_SCRIPT=1. */
    rawScriptTools: boolean;
  };
  rateLimits: {
    /** Tool calls per minute at the default rate limit. */
    defaultPerToolPerMinute: number;
  };
  /** How long idempotency keys are retained (ms). */
  idempotencyTtlMs: number;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Default idempotency key TTL: 24 hours. */
const DEFAULT_IDEMPOTENCY_TTL_MS = 86_400_000;

/**
 * Build a `Capabilities` object from parsed config.
 *
 * Callers may override `ofVersion` and `ofEdition` once the lazy OF probe
 * completes (see DESIGN §33); until then the defaults signal the unknown state.
 */
export function buildCapabilities(
  config: Config,
  overrides: { ofVersion?: string; ofEdition?: "standard" | "pro" } = {},
): Capabilities {
  const { limit, windowSeconds } = config.OMNIFOCUS_TOOL_RATE_LIMIT;
  const perMinute = Math.round((limit * 60) / windowSeconds);

  const ofEdition = overrides.ofEdition ?? "standard";
  const isPro = ofEdition === "pro";

  return {
    ofVersion: overrides.ofVersion ?? "unknown",
    ofEdition,
    transports: {
      jxa: { available: true, timeoutMs: config.OMNIFOCUS_JXA_TIMEOUT_MS },
      omnijs: { available: true, timeoutMs: config.OMNIFOCUS_OMNIJS_TIMEOUT_MS },
    },
    features: {
      customPerspectives: isPro,
      forecastTag: isPro,
      repetitionRules: isPro,
      pluginInvocation: isPro,
      rawScriptTools: config.OMNIFOCUS_ALLOW_RAW_SCRIPT,
    },
    rateLimits: {
      defaultPerToolPerMinute: perMinute,
    },
    idempotencyTtlMs: DEFAULT_IDEMPOTENCY_TTL_MS,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** URI at which the resource is exposed. */
export const CAPABILITIES_URI = "omnifocus://capabilities";

/**
 * Register the `omnifocus://capabilities` resource with an `McpServer`.
 *
 * The `getCapabilities` callback is invoked on each read, allowing the server
 * to refresh the object after the lazy OF probe (#36) updates edition/version.
 */
export function registerCapabilitiesResource(
  server: McpServer,
  getCapabilities: () => Capabilities,
): void {
  server.registerResource(
    "omnifocus-capabilities",
    CAPABILITIES_URI,
    {
      description:
        "Structured capabilities object for this omnifocus-mcp server instance. " +
        "Read once at session start to discover available features (Pro vs Standard), " +
        "transport timeouts, rate limits, and whether raw-script tools are enabled. " +
        "ofVersion and ofEdition are 'unknown'/'standard' until the lazy OF probe runs.",
      mimeType: "application/json",
    },
    async (_uri) => ({
      contents: [
        {
          uri: CAPABILITIES_URI,
          mimeType: "application/json",
          text: JSON.stringify(getCapabilities(), null, 2),
        },
      ],
    }),
  );
}
