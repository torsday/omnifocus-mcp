/**
 * Per-process session state for the MCP connection (#818).
 *
 * ADR-0010 makes stdio the sole transport, so a server process serves exactly
 * one client connection for its lifetime. That collapses "per-connection
 * session state" to a process-level singleton: the negotiated density is set
 * once in the `initialize` handshake (see
 * `src/server/mcpServer.ts` → `oninitialized`) and read thereafter by the read
 * tools/services via the `resolve*` helpers below.
 *
 * The singleton starts at `"default"`, so a client that signals nothing gets
 * byte-for-byte the current behavior — this feature is additive, not breaking.
 *
 * @see src/state/density.ts — profile definitions
 * @see docs/adr/0025-session-density-negotiation.md
 */

import {
  DENSITY_VALUES,
  type Density,
  READ_DEFAULTS,
  type ResolvedReadDefaults,
} from "./density.js";

/** The negotiated density for this process. Mutated only at the handshake. */
let currentDensity: Density = "default";

/** Type guard: is `value` one of the known density preferences? */
export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && (DENSITY_VALUES as readonly string[]).includes(value);
}

/** Set the session density. Called once from the `initialize` handshake. */
export function setSessionDensity(density: Density): void {
  currentDensity = density;
}

/** The currently negotiated session density (`"default"` until negotiated). */
export function getSessionDensity(): Density {
  return currentDensity;
}

/** The resolved read-shaping defaults for the current density. */
export function getSessionReadDefaults(): ResolvedReadDefaults {
  return READ_DEFAULTS[currentDensity];
}

/**
 * Resolve an `includeLinks` argument against the session default.
 * An explicit boolean always wins; `undefined` falls back to the session.
 */
export function resolveIncludeLinks(value: boolean | undefined): boolean {
  return value ?? READ_DEFAULTS[currentDensity].includeLinks;
}

/** Resolve an `includeSubtasks` argument against the session default. */
export function resolveIncludeSubtasks(value: boolean | undefined): boolean {
  return value ?? READ_DEFAULTS[currentDensity].includeSubtasks;
}

/** Resolve a `notePreviewChars` argument against the session default. */
export function resolveNotePreviewChars(value: number | undefined): number {
  return value ?? READ_DEFAULTS[currentDensity].notePreviewChars;
}

/**
 * Negotiate the density from the client's `initialize` capabilities.
 *
 * Contract: the client signals `capabilities.experimental.density` as one of
 * `"compact" | "default" | "full"`. Anything missing or unrecognized falls
 * back to `"default"` (graceful degradation for clients that don't speak the
 * capability). Returns the value actually set.
 */
export function negotiateDensityFromCapabilities(
  experimental: Record<string, unknown> | undefined,
): Density {
  const raw = experimental?.density;
  const next: Density = isDensity(raw) ? raw : "default";
  setSessionDensity(next);
  return next;
}

/** Reset to the initial state. Test-isolation helper. */
export function resetSessionState(): void {
  currentDensity = "default";
}
