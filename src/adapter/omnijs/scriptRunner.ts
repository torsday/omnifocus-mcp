/**
 * `runOmniJsScript` — the keystone of the OmniJS transport.
 *
 * OmniJS (Omni Automation) is OmniFocus's in-process JavaScript engine.
 * Per the spike (`docs/spikes/2026-04-omnijs-spike.md`) the URL-scheme
 * transport (`omnifocus://localhost/omnijs-run?script=…`) is unusable in a
 * background MCP server — it pops a security dialog on every invocation
 * and runs in a sandbox that blocks the file writes we'd need for result
 * retrieval. The adopted transport is the **JXA bridge**:
 *
 *     osascript -l JavaScript -e 'Application("OmniFocus").evaluateJavascript(<script>)'
 *
 * which uses the macOS Automation channel already granted to `osascript`,
 * has no dialogs, and round-trips the script's return value through stdout.
 *
 * Responsibilities mirror `runJxaScript` so the two transports behave
 * identically from a calling-services perspective:
 *
 * - **Hard timeout** (default 45s; `OMNIFOCUS_OMNIJS_TIMEOUT_MS`) kills the
 *   child and surfaces a typed `Timeout` error.
 * - **UTF-8 end-to-end** via `LANG=en_US.UTF-8` in the child environment.
 * - **Typed-error mapping**: well-known stderr signatures (OmniFocus not
 *   running, automation permission denied, OmniJS script threw, malformed
 *   JSON) become specific error types from the typed taxonomy
 *   (DESIGN §6.7); everything else becomes a `ScriptError`.
 * - **Spawner injection** behind a `ScriptSpawner` seam so unit tests run
 *   in milliseconds without ever touching `osascript`.
 * - **Argument injection without shell exposure**: the OmniJS script body is
 *   embedded into a small JXA wrapper that calls `evaluateJavascript`, with
 *   the call args installed as `globalThis.__args` inside the OmniJS script.
 *   Neither user content nor the script body is ever passed via argv (where
 *   the shell could see it) — both travel via stdin.
 *
 * @see DESIGN.md §6.4 — script asset discipline
 * @see DESIGN.md §6.7 — error taxonomy
 * @see docs/adr/0002-omnifocus-transport-dual.md
 * @see docs/adr/0005-scripts-as-first-class-files.md
 * @see docs/spikes/2026-04-omnijs-spike.md
 */

import { execFile } from "node:child_process";
import {
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  Timeout,
  TransportUnavailable,
} from "../../errors/index.js";
import { emitTransportCall } from "../../logging/transportCall.js";

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
 * Spawns the JXA interpreter for the OmniJS bridge, pipes `wrappedJxaBody`
 * (already wrapped — see {@link wrapOmniJsForJxa}) to stdin, and resolves
 * once the child exits or times out. The `argsJson` parameter is reserved
 * for symmetry with `JxaTransport`'s spawner; OmniJS callers embed args
 * inside the wrapper rather than threading them via argv (so the parameter
 * is unused by the production spawner but fakeable in tests).
 */
export type ScriptSpawner = (
  wrappedJxaBody: string,
  argsJson: string,
  timeoutMs: number,
) => Promise<SpawnResult>;

const MAX_STDOUT_BYTES = 16 * 1024 * 1024; // 16 MiB — comfortably above any sane OF read.

/**
 * Production spawner: real `osascript -l JavaScript` via
 * `child_process.execFile`. The wrapper body is piped via stdin (never argv),
 * so OF script content and user-provided args are never visible to the shell.
 */
export const defaultOmniJsSpawner: ScriptSpawner = (wrappedJxaBody, _argsJson, timeoutMs) =>
  new Promise<SpawnResult>((resolve) => {
    const child = execFile(
      "osascript",
      ["-l", "JavaScript", "-"],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_STDOUT_BYTES,
        env: { ...process.env, LANG: "en_US.UTF-8" },
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        const stdoutStr = stdout;
        const stderrStr = stderr;
        const timedOut = err !== null && err.killed === true;
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
    if (child.stdin !== null) {
      child.stdin.end(wrappedJxaBody, "utf8");
    }
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunScriptOptions {
  /** Override the default 45s timeout (`OMNIFOCUS_OMNIJS_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Inject a fake spawner — used by unit tests; production callers omit. */
  spawner?: ScriptSpawner;
  /** Optional script name for error context (`details.scriptName`). */
  scriptName?: string;
}

/**
 * Run an OmniJS script via the `evaluateJavascript` JXA bridge and return
 * its parsed JSON output.
 *
 * The OmniJS script is expected to be a self-contained IIFE whose final
 * expression is a JSON-encoded string. The runner installs the call args as
 * `globalThis.__args` before evaluating, so scripts that need arguments can
 * read them without further plumbing.
 */
export async function runOmniJsScript<T = unknown>(
  omniJsScriptBody: string,
  args: unknown = {},
  options: RunScriptOptions = {},
): Promise<T> {
  const spawner = options.spawner ?? defaultOmniJsSpawner;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const argsJson = JSON.stringify(args ?? {});
  const scriptName = options.scriptName;

  const wrapped = wrapOmniJsForJxa(omniJsScriptBody, argsJson);
  const startedAt = performance.now();
  const result = await spawner(wrapped, argsJson, timeoutMs);
  const durationMs = Math.round(performance.now() - startedAt);
  const outcome: "ok" | "error" =
    result.spawnError !== undefined ||
    result.timedOut ||
    result.exitCode !== 0 ||
    result.stdout.trim() === ""
      ? "error"
      : "ok";
  emitTransportCall("omnijs", scriptName, args, durationMs, outcome);

  // 1. Spawn failure (binary missing) — the transport itself is unavailable.
  if (result.spawnError !== undefined) {
    throw new TransportUnavailable("Failed to spawn osascript", {
      cause: result.spawnError,
      details: {
        transport: "omnijs",
        reason: result.spawnError.code ?? "spawn-failed",
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 2. Hard timeout.
  if (result.timedOut) {
    const suffix = scriptName !== undefined ? ` (script: ${scriptName})` : "";
    throw new Timeout(`OmniJS script exceeded ${timeoutMs}ms timeout${suffix}`, {
      details: {
        transport: "omnijs",
        timeoutMs,
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 3. Non-zero exit — classify by stderr signature, fall back to ScriptError.
  if (result.exitCode !== 0) {
    const typed = classifyOmniJsStderr(result.stderr, scriptName);
    if (typed !== null) throw typed;
    const tag = scriptName !== undefined ? ` [${scriptName}]` : "";
    throw new ScriptError(`OmniJS script failed (exit ${result.exitCode})${tag}`, {
      details: {
        transport: "omnijs",
        exitCode: result.exitCode,
        stderr: truncate(result.stderr, 1024),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // 4. Empty stdout — by convention every OmniJS script in this repo returns
  //    a JSON-encoded string as its final expression, which `evaluateJavascript`
  //    forwards through JXA's stdout. Empty output means the script returned
  //    `undefined` (script-author bug).
  const trimmed = result.stdout.trim();
  if (trimmed === "") {
    throw new ScriptError(
      "OmniJS script returned empty stdout — the IIFE must return a JSON-encoded string",
      {
        details: {
          transport: "omnijs",
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
    throw new ScriptError("OmniJS script returned malformed JSON", {
      cause,
      details: {
        transport: "omnijs",
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
 * Build the JXA wrapper body that delivers `omniJsScriptBody` to OmniFocus's
 * `evaluateJavascript` channel with `argsJson` pre-installed as
 * `globalThis.__args`.
 *
 * We embed both via `JSON.stringify` so any character (quotes, newlines,
 * backslashes, unicode) round-trips safely.
 */
export function wrapOmniJsForJxa(omniJsScriptBody: string, argsJson: string): string {
  // The OmniJS payload prepends the args installation so the user's IIFE can
  // read them at any nesting depth.
  const omniJsPayload = `globalThis.__args = ${argsJson};\n${omniJsScriptBody}`;
  return [
    "function run(_argv) {",
    '  const ofApp = Application("OmniFocus");',
    "  ofApp.includeStandardAdditions = false;",
    `  const __omnijs = ${JSON.stringify(omniJsPayload)};`,
    "  const __result = ofApp.evaluateJavascript(__omnijs);",
    // `evaluateJavascript` returns the script's value. By contract our scripts
    // already return a JSON-encoded string, so we forward it unchanged.
    "  return __result;",
    "}",
  ].join("\n");
}

/**
 * Map well-known osascript / OmniJS stderr signatures to typed errors.
 * Returns `null` if no specific signature matches — the caller falls back
 * to a generic `ScriptError`.
 *
 * The OmniFocus-not-running and permission-denied signatures are shared with
 * JXA (the underlying channel is the same `osascript` binary). The OmniJS
 * thrown-error signature documented in the spike (`Error: Error: Error: …`)
 * is left to fall through to `ScriptError`, which is the right outcome — a
 * script bug surfaces with the original stderr in `details.stderr` for the
 * author to read.
 */
function classifyOmniJsStderr(stderr: string, scriptName?: string): Error | null {
  if (
    /Application can't be found/i.test(stderr) ||
    /Application isn['’]t running/i.test(stderr) ||
    /OmniFocus(?:.*)not running/i.test(stderr)
  ) {
    return new OmniFocusNotRunning({
      details: {
        transport: "omnijs",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  if (
    /-1743\b/.test(stderr) ||
    /not authori[sz]ed to send Apple events/i.test(stderr) ||
    /errAEEventNotPermitted/i.test(stderr) ||
    /not allowed assistive access/i.test(stderr)
  ) {
    return new PermissionDenied({
      details: {
        transport: "omnijs",
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
