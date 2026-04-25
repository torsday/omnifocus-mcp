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
import {
  ConflictError,
  NotFound,
  OmniFocusNotRunning,
  PermissionDenied,
  ScriptError,
  Timeout,
  TransportUnavailable,
  ValidationError,
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
    // Pipe the script body in via stdin so we never write a temp file and never
    // pass user content on argv (where the shell could see it).
    if (child.stdin !== null) {
      child.stdin.end(scriptBody, "utf8");
    }
  });

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
  const spawner = options.spawner ?? defaultJxaSpawner;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const jsonArg = JSON.stringify(args ?? {});
  const scriptName = options.scriptName;

  const startedAt = performance.now();
  const result = await spawner(scriptBody, jsonArg, timeoutMs);
  const durationMs = Math.round(performance.now() - startedAt);
  const outcome: "ok" | "error" =
    result.spawnError !== undefined ||
    result.timedOut ||
    result.exitCode !== 0 ||
    result.stdout.trim() === ""
      ? "error"
      : "ok";
  emitTransportCall("jxa", scriptName, args, durationMs, outcome);

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

  // 2. Hard timeout.
  if (result.timedOut) {
    const suffix = scriptName !== undefined ? ` (script: ${scriptName})` : "";
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
  if (/\bnot found\b/i.test(stderr) || /^OF_NOT_FOUND\b/m.test(stderr)) {
    return new NotFound(stderr, {
      details: {
        transport: "jxa",
        stderr: truncate(stderr, 512),
        ...(scriptName !== undefined ? { scriptName } : {}),
      },
    });
  }

  // "OF_VALIDATION: ..." / "is required" / empty-name guards → ValidationError.
  if (/^OF_VALIDATION\b/m.test(stderr) || /\bis required\b/i.test(stderr)) {
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
