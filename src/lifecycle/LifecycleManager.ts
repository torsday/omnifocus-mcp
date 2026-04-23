/**
 * `LifecycleManager` — lazy OmniFocus detection + version gate.
 *
 * Startup should stay under 500ms with no macOS Automation permission prompts
 * (DESIGN §17). Probing OmniFocus can take seconds and trigger a permission
 * dialog, so we defer detection to the first tool call that actually needs
 * OF. The result — `{ ofVersion, ofEdition }` — is cached for the lifetime
 * of the process and surfaced in every response envelope's `meta.ofVersion`.
 *
 * Tools that require a minimum OmniFocus version call `checkMinimumVersion`,
 * which throws `FeatureRequiresOfVersion` when the detected version is lower.
 *
 * The probe is injected rather than hard-wired to a transport so the manager
 * stays testable and so the same gate can be reused behind any adapter
 * (JXA today, an OmniJS-based probe tomorrow, a fake in unit tests).
 *
 * @see DESIGN.md §17 — Lifecycle: startup sequence, version detection
 * @see src/errors/index.ts — FeatureRequiresOfVersion
 */

import { FeatureRequiresOfVersion } from "../errors/index.js";
import { logger as defaultLogger } from "../logging/logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** OmniFocus application metadata discovered at first use. */
export interface OfAppInfo {
  /** Dotted-number version string reported by OmniFocus, e.g. `"4.5.2"`. */
  ofVersion: string;
  /** OmniFocus edition — `"pro"` unlocks custom perspectives, plug-ins, repetition, forecast tag. */
  ofEdition: "standard" | "pro";
}

/** Minimal logger shape — matches pino's surface used here. Injected for tests. */
export interface LifecycleLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface LifecycleManagerOptions {
  /**
   * Probe implementation. Must resolve with the detected app info on success,
   * or reject with one of the typed errors from the error taxonomy
   * (`OmniFocusNotRunning`, `PermissionDenied`, `ScriptError`, …).
   */
  probe: () => Promise<OfAppInfo>;
  /** Overridable logger; defaults to the process singleton. */
  logger?: LifecycleLogger;
}

// ---------------------------------------------------------------------------
// Internal semver compare — dotted-number strings ("4.5.2" vs "4.6")
// ---------------------------------------------------------------------------

/**
 * Compare two dotted-number version strings. Returns `-1` if `a < b`, `1` if
 * `a > b`, `0` if equal. Trailing non-numeric segments are ignored — OmniFocus
 * version strings are always numeric triples, but we defensively coerce.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/**
 * Single-flight, cache-on-success lifecycle manager.
 *
 * - First `ensureOfAvailable()` call runs the probe; concurrent callers coalesce
 *   onto the same in-flight promise so OF sees exactly one probe invocation.
 * - On success the result is cached for the process lifetime and an
 *   `of.detected` structured log event is emitted exactly once.
 * - On failure the in-flight promise is cleared and the next caller retries;
 *   we never poison the cache with an error.
 */
export class LifecycleManager {
  private readonly probe: () => Promise<OfAppInfo>;
  private readonly log: LifecycleLogger;
  private cached: OfAppInfo | undefined;
  private inflight: Promise<OfAppInfo> | undefined;

  constructor(options: LifecycleManagerOptions) {
    this.probe = options.probe;
    this.log = options.logger ?? defaultLogger;
  }

  /**
   * Resolve — probing if needed — with the detected `{ ofVersion, ofEdition }`.
   * Tools that need OmniFocus should await this before their first call; the
   * subsequent call is a near-free in-memory read.
   */
  async ensureOfAvailable(): Promise<OfAppInfo> {
    if (this.cached !== undefined) return this.cached;
    if (this.inflight !== undefined) return this.inflight;

    this.inflight = (async () => {
      const info = await this.probe();
      this.cached = info;
      this.log.info(
        { event: "of.detected", ofVersion: info.ofVersion, ofEdition: info.ofEdition },
        "of.detected",
      );
      return info;
    })().finally(() => {
      this.inflight = undefined;
    });

    return this.inflight;
  }

  /**
   * Synchronously return the cached app info, or `undefined` if the probe has
   * not yet run. Intended for envelope builders that want `meta.ofVersion`
   * without forcing a probe — the envelope uses `"unknown"` until the first
   * `ensureOfAvailable()` completes.
   */
  getInfo(): OfAppInfo | undefined {
    return this.cached;
  }

  /**
   * Throw `FeatureRequiresOfVersion` when the detected OmniFocus version is
   * strictly lower than `minimum`. Implicitly calls `ensureOfAvailable()`.
   *
   * @param minimum   Dotted-number version string the tool requires (e.g. `"4.0"`).
   * @param featureName  Human-readable feature label for the error message.
   */
  async checkMinimumVersion(minimum: string, featureName: string): Promise<void> {
    const info = await this.ensureOfAvailable();
    if (compareVersions(info.ofVersion, minimum) < 0) {
      throw new FeatureRequiresOfVersion(
        `Feature "${featureName}" requires OmniFocus ${minimum} or later (detected ${info.ofVersion})`,
        {
          details: {
            feature: featureName,
            minimum,
            detected: info.ofVersion,
          },
        },
      );
    }
  }
}
