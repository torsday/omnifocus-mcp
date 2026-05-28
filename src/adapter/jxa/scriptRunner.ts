/**
 * `runJxaScript` — the keystone of the JXA transport.
 *
 * Spawns `osascript -l JavaScript`, pipes a script body via stdin, and
 * passes a single JSON-stringified argument as `argv[0]` (which JXA scripts
 * receive in their `function run(argv)` entry point per ADR-0005).
 *
 * Responsibilities:
 *
 * - **Hard timeout**: kills the child if it runs past the configured limit
 *   and surfaces a typed `Timeout` error.
 * - **UTF-8 end-to-end**: forces `LANG=en_US.UTF-8` in the child environment
 *   so emoji and non-ASCII task names round-trip without mojibake.
 * - **Typed-error mapping**: well-known stderr signatures (OmniFocus not
 *   running, automation permission denied, malformed JSON) become specific
 *   error types from the typed taxonomy (DESIGN §6.7); everything else
 *   becomes a `ScriptError` with the stderr captured in `details`.
 * - **Spawner injection**: the underlying `child_process` call is behind a
 *   `ScriptSpawner` seam so unit tests run in milliseconds without ever
 *   touching `osascript` — and integration tests exercise the real binary.
 *
 * @see DESIGN.md §6.4 — script asset discipline
 * @see DESIGN.md §6.7 — error taxonomy
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */

import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ConflictError,
  NotFound,
  OFBusy,
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  Timeout,
  TransportUnavailable,
  ValidationError,
} from "../../errors/index.js";
import { logger } from "../../logging/logger.js";
import { emitTransportCall } from "../../logging/transportCall.js";
import { probeOmniFocusResponsiveness } from "../_shared/busyProbe.js";
import { trackChild } from "../_shared/childRegistry.js";
import { type RetryPolicy, resolveRetryPolicy } from "../_shared/retryPolicy.js";
import { ensureSpawnFloorCalibration, getSpawnFloorMs } from "../_shared/spawnFloor.js";
import { getJxaCircuit, isCircuitTransient } from "../_shared/transportCircuit.js";

// ---------------------------------------------------------------------------
// Spawner seam (injectable for tests)
// ---------------------------------------------------------------------------

/** Result of a single child-process invocation, normalized for the caller. */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True if the child was killed because it exceeded the timeout. */
  timedOut: boolean;
  /** Set if the child failed to spawn entirely (e.g. binary missing). */
  spawnError?: NodeJS.ErrnoException;
}

/**
 * Spawns the JXA interpreter, pipes `scriptBody` to stdin, passes `jsonArg`
 * as `argv[0]`, and resolves once the child exits or times out.
 */
export type ScriptSpawner = (
  scriptBody: string,
  jsonArg: string,
  timeoutMs: number,
) => Promise<SpawnResult>;

const MAX_STDOUT_BYTES = 16 * 1024 * 1024; // 16 MiB — comfortably above any sane OF read.

/** Production spawner: real `osascript -l JavaScript` via `child_process.execFile`. */
export const defaultJxaSpawner: ScriptSpawner = (scriptBody, jsonArg, timeoutMs) =>
  new Promise<SpawnResult>((resolve) => {
    const child = execFile(
      "osascript",
      ["-l", "JavaScript", "-", jsonArg],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_STDOUT_BYTES,
        env: { ...process.env, LANG: "en_US.UTF-8" },
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        // `encoding: "utf8"` above means `stdout` / `stderr` are strings.
        const stdoutStr = stdout;
        const stderrStr = stderr;
        // `err.killed === true` plus a SIGTERM signal is execFile's timeout signal.
        const timedOut = err !== null && err.killed === true;
        // ENOENT = binary not on PATH; surface it as a spawn failure.
        const spawnError =
          err && (err as NodeJS.ErrnoException).code === "ENOENT"
            ? (err as NodeJS.ErrnoException)
            : undefined;
        resolve({
          stdout: stdoutStr,
          stderr: stderrStr,
          exitCode: err === null ? 0 : ((err as { code?: number }).code ?? 1),
          timedOut,
          ...(spawnError !== undefined ? { spawnError } : {}),
        });
      },
    );
    // Track the child so a SIGINT/SIGTERM mid-flight can terminate it rather
    // than orphan an osascript process that keeps OmniFocus locked (#839).
    trackChild(child);
    // Pipe the script body in via stdin so we never write a temp file and never
    // pass user content on argv (where the shell could see it).
    if (child.stdin !== null) {
      child.stdin.end(scriptBody, "utf8");
    }
  });

// ---------------------------------------------------------------------------
// Retry-once on known-transient failures (#816)
// ---------------------------------------------------------------------------

/**
 * Read-only JXA scripts whose retry on transient failure is safe by definition
 * (no side effects). The set is the canonical source of truth — adding a new
 * read-shaped script means adding it here. Writes are intentionally omitted;
 * retrying a non-idempotent write would risk duplicate effects.
 *
 * Coverage check: every entry must correspond to a real file under
 * `src/scripts/jxa/<name>.js`. The smoke test in `scriptRunner.test.ts`
 * pins this set so silent additions surface in review.
 */
export const READ_ONLY_JXA_SCRIPTS: ReadonlySet<string> = new Set([
  "attachment_list",
  "changes_since",
  "folder_get",
  "folder_list",
  "forecast_get",
  "perspective_evaluate",
  "perspective_list",
  "ping",
  "project_get",
  "project_get_many",
  "project_list",
  "review_list_due",
  "tag_get",
  "tag_get_many",
  "tag_list",
  "task_get",
  "task_get_many",
  "task_list",
  "task_search",
  "window_get_state",
]);

/**
 * Stderr signatures for OmniFocus 4.x transient errors that historically
 * recur and resolve on retry (#816 audit of #275, #319, #498, #674, #682).
 *
 * - `-1728` errAENoSuchObject — sometimes a real not-found, sometimes a race
 *   right after a write where OF hasn't surfaced the new entity yet
 * - `-10024` errAEAccessorNotFound — typically transient when OF is mid-write
 * - `-10003` errAENotModifiable — transient when OF is mid-sync
 *
 * Hard timeouts (`SpawnResult.timedOut`) are also retryable — those are
 * almost always cold-start latency or transient runner contention, not a
 * logic problem in the script.
 */
const RETRYABLE_STDERR_PATTERN = /\(-(?:1728|10024|10003)\)/;

function isTransientFailure(result: SpawnResult): boolean {
  if (result.spawnError !== undefined) return false; // binary missing — not transient
  if (result.timedOut) return true;
  if (result.exitCode === 0) return false;
  return RETRYABLE_STDERR_PATTERN.test(result.stderr);
}

/** Classify the *reason* a failure was retryable, for telemetry. */
function transientReason(
  result: SpawnResult,
): "timeout" | "errno-1728" | "errno-10024" | "errno-10003" | "other" {
  if (result.timedOut) return "timeout";
  if (/\(-1728\)/.test(result.stderr)) return "errno-1728";
  if (/\(-10024\)/.test(result.stderr)) return "errno-10024";
  if (/\(-10003\)/.test(result.stderr)) return "errno-10003";
  return "other";
}

// `RetryPolicy`, the module-level defaults, and `configureRetryPolicy` live
// in `../_shared/retryPolicy.ts` so the OmniJS runner can use the same env
// vars and runtime override (#890). Re-exported here for callers that
// already imported them through this module pre-#890.
export { configureRetryPolicy, type RetryPolicy } from "../_shared/retryPolicy.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunScriptOptions {
  /** Override the default 30s timeout (`OMNIFOCUS_JXA_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Inject a fake spawner — used by unit tests; production callers omit. */
  spawner?: ScriptSpawner;
  /** Optional script name for error context (`details.scriptName`). */
  scriptName?: string;
  /**
   * Per-call override for the retry-once policy. Production callers omit;
   * tests pass `{ enabled: false }` to deterministically observe the
   * first-attempt failure path, or `{ delayMs: 0 }` to skip the backoff
   * and keep tests fast.
   */
  retry?: Partial<RetryPolicy>;
}

/**
 * Run a JXA script and return its parsed JSON output.
 *
 * The script is expected to define `function run(argv) { ... }` and return a
 * JSON-encoded string from that function. Anything else is a `ScriptError`.
 */
export async function runJxaScript<T = unknown>(
  scriptBody: string,
  args: unknown = {},
  options: RunScriptOptions = {},
): Promise<T> {
  // Transport-level circuit breaker (#835). Wraps the entire post-retry
  // body so a sustained OF wedge (queue of Timeouts) trips the breaker
  // and subsequent calls fail fast with CircuitOpen instead of each
  // paying the 30s timeout. Only thrown Timeout / OmniFocusNotRunning
  // count toward the consecutive-failure budget.
  return getJxaCircuit().tryCall(
    () => runJxaScriptInner<T>(scriptBody, args, options),
    isCircuitTransient,
  );
}

async function runJxaScriptInner<T>(
  scriptBody: string,
  args: unknown,
  options: RunScriptOptions,
): Promise<T> {
  const spawner = options.spawner ?? defaultJxaSpawner;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const jsonArg = JSON.stringify(args ?? {});
  const scriptName = options.scriptName;
  const retry = resolveRetryPolicy(options.retry);

  // Kick off osascript spawn-floor calibration on first call (#939).
  // Fire-and-forget — the very first transport call may complete before
  // the cache is populated; subsequent calls see the split fields.
  void ensureSpawnFloorCalibration(spawner);

  const startedAt = performance.now();
  let result = await spawner(scriptBody, jsonArg, timeoutMs);

  // Retry-once on transient failures for read-only scripts (#816). Writes
  // and unknown scripts (no `scriptName` passed) skip retry to avoid
  // duplicate side effects.
  const isReadOnly = scriptName !== undefined && READ_ONLY_JXA_SCRIPTS.has(scriptName);
  const shouldRetry = retry.enabled && isReadOnly && isTransientFailure(result);
  if (shouldRetry) {
    const reason = transientReason(result);
    const retryStartedAt = performance.now();
    if (retry.delayMs > 0) await sleep(retry.delayMs);
    const retryResult = await spawner(scriptBody, jsonArg, timeoutMs);
    const retryDurationMs = Math.round(performance.now() - retryStartedAt);
    const retryOutcome: "ok" | "error" =
      retryResult.spawnError !== undefined ||
      retryResult.timedOut ||
      retryResult.exitCode !== 0 ||
      retryResult.stdout.trim() === ""
        ? "error"
        : "ok";
    logger.info(
      {
        event: "transport.retry",
        transport: "jxa",
        scriptName,
        reason,
        outcome: retryOutcome,
        delayMs: retry.delayMs,
        durationMs: retryDurationMs,
      },
      "transport.retry",
    );
    result = retryResult;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const outcome: "ok" | "error" =
    result.spawnError !== undefined ||
    result.timedOut ||
    result.exitCode !== 0 ||
    result.stdout.trim() === ""
      ? "error"
      : "ok";
  emitTransportCall("jxa", scriptName, args, durationMs, outcome, getSpawnFloorMs());

  // 1. Spawn failure (binary missing) — the transport itself is unavailable.
  if (result.spawnError !== undefined) {
    throw new TransportUnavailable("Failed to spawn osascript", {
      cause: result.spawnError,
      details: {
        transport: "jxa",
        reason: result.spawnError.code ?? "spawn-failed",
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 2. Hard timeout. Classify post-hoc via a fast responsiveness probe:
  //    if OmniFocus answers a cheap call right after the timeout, the
  //    timed-out call was blocked by a modal sheet or in-flight sync
  //    (Busy) rather than a true wedge. Surface the Busy case as a
  //    user-action error so the agent shows a useful remediation message
  //    instead of "retry once". Probe failures fall through to the
  //    original Timeout — that's the wedge case, and the transport
  //    circuit (#835) picks it up after N consecutive failures.
  if (result.timedOut) {
    const suffix = scriptName !== undefined ? ` (script: ${scriptName})` : "";
    const probe = await probeOmniFocusResponsiveness(spawner);
    if (probe === "responsive") {
      logger.warn(
        {
          event: "of.busy.detected",
          transport: "jxa",
          ...(scriptName !== undefined ? { scriptName } : {}),
          timeoutMs,
        },
        "OmniFocus is responsive but blocked — likely a modal or active sync",
      );
      throw new OFBusy(`OmniFocus is busy (script: ${scriptName ?? "unknown"})`, {
        details: {
          transport: "jxa",
          timeoutMs,
          ...(scriptName !== undefined ? { scriptName } : {}),
        },
      });
    }
    throw new Timeout(`JXA script exceeded ${timeoutMs}ms timeout${suffix}`, {
      details: {
        transport: "jxa",
        timeoutMs,
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 3. Non-zero exit — classify by stderr signature, fall back to ScriptError.
  if (result.exitCode !== 0) {
    const typed = classifyJxaStderr(result.stderr, scriptName);
    if (typed !== null) throw typed;
    const tag = scriptName !== undefined ? ` [${scriptName}]` : "";
    throw new ScriptError(`JXA script failed (exit ${result.exitCode})${tag}`, {
      details: {
        transport: "jxa",
        exitCode: result.exitCode,
        stderr: truncate(result.stderr, 1024),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 4. Empty stdout is a script-author bug — every JXA script must return
  //    a JSON-stringified value as its `run()` return.
  const trimmed = result.stdout.trim();
  if (trimmed === "") {
    throw new ScriptError(
      "JXA script returned empty stdout — `run()` must return a JSON-encoded string",
      {
        details: {
          transport: "jxa",
          ...(scriptName !== undefined ? { scriptName } : {}),
        },
      },
    );
  }

  // 5. Parse the JSON. A malformed payload is the script author's problem,
  //    not a transient issue — surface it as a ScriptError.
  try {
    return JSON.parse(trimmed) as T;
  } catch (cause) {
    throw new ScriptError("JXA script returned malformed JSON", {
      cause,
      details: {
        transport: "jxa",
        stdoutPreview: truncate(trimmed, 200),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map well-known JXA / osascript stderr signatures to typed errors. Returns
 * `null` if no specific signature matches — the caller should fall back to
 * a generic `ScriptError`.
 *
 * The signatures here are the patterns we've actually seen in the wild;
 * we deliberately stay conservative — better to report a precise
 * `ScriptError` than to mis-classify and trigger the wrong remediation.
 */
function classifyJxaStderr(stderr: string, scriptName?: string): Error | null {
  // `Application can't be found` → app isn't installed or isn't named OmniFocus.
  // `OmniFocus got an error: Application isn't running.` → user quit the app.
  if (
    /Application can't be found/i.test(stderr) ||
    /Application isn['’]t running/i.test(stderr) ||
    /OmniFocus(?:.*)not running/i.test(stderr)
  ) {
    return new OmniFocusNotRunning({
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // -1743 = errAEEventNotPermitted (TCC denial).
  // "is not allowed assistive access" / "Not authorized to send Apple events" → same.
  if (
    /-1743\b/.test(stderr) ||
    /not authori[sz]ed to send Apple events/i.test(stderr) ||
    /errAEEventNotPermitted/i.test(stderr) ||
    /not allowed assistive access/i.test(stderr)
  ) {
    return new PermissionDenied({
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // "X not found: <id>" / "OF_NOT_FOUND: ..." → NotFound.
  // Covers: `Task not found: abc`, `Project not found: xyz`,
  //         `Folder not found: ...`, `Tag not found: ...`, `Parent X not found: ...`,
  //         `OF_NOT_FOUND: parent task abc` (batch scripts).
  //
  // Also maps OmniFocus's native missing-id error (#674): JXA's `byId(...)`
  // returns a *lazy* specifier that's always truthy, so guards like
  // `if (!byIdResult) throw "X not found"` are dead code. The actual lookup
  // fires on the next method call (e.g. `.id()` or `.tasks.push(...)`) and
  // throws `Error: Can't get object. (-1728)` (errAENoSuchObject). Any
  // JXA-routed mutation that takes a target id surfaces this on a missing
  // lookup. Without this regex, callers got opaque ScriptError instead of
  // typed NotFound.
  if (
    /\bnot found\b/i.test(stderr) ||
    /^OF_NOT_FOUND\b/m.test(stderr) ||
    /Can['’]t get object\.?\s*\(-1728\)/i.test(stderr) ||
    /\(-1728\)/.test(stderr)
  ) {
    return new NotFound(stderr, {
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // "OF_VALIDATION: ..." / "ValidationError:" prefix / "is required" → ValidationError.
  if (
    /^OF_VALIDATION\b/m.test(stderr) ||
    /\bValidationError:/m.test(stderr) ||
    /\bis required\b/i.test(stderr)
  ) {
    return new ValidationError(stderr, {
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // "OF_CONFLICT: ..." → ConflictError.
  if (/^OF_CONFLICT\b/m.test(stderr)) {
    return new ConflictError(stderr, {
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  return null;
}

/** Cap a string to `n` chars so it never balloons an error payload. */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
