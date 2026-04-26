/**
 * Stdout-write guard for omnifocus-mcp (DESIGN §17, §18).
 *
 * The MCP server uses stdio as its transport: every byte written to stdout
 * is part of the protocol framing. A stray `console.log` or accidental
 * `process.stdout.write` corrupts the protocol and is nearly impossible to
 * debug from the client side.
 *
 * `installStdoutGuard()` wraps `process.stdout.write` with an assertion.
 * Calls that originate inside the MCP SDK transport module are permitted
 * (identified via stack-trace whitelist); all others throw immediately so
 * the bug surfaces at the write site rather than silently at the client.
 *
 * Call once during server startup, before `server.connect(transport)`.
 *
 * @see DESIGN.md §17 — lifecycle
 * @see DESIGN.md §18 — security posture
 */

import { OmniFocusError } from "../errors/index.js";

/** Stack-trace substrings that identify MCP-SDK-originated stdout writes. */
const ALLOWED_STACK_SUBSTRINGS = [
  "@modelcontextprotocol/sdk",
  "node_modules/@modelcontextprotocol",
];

/** True if the provided stack trace originates from an allowed module. */
export function isAllowedStackTrace(stack: string): boolean {
  return ALLOWED_STACK_SUBSTRINGS.some((s) => stack.includes(s));
}

let originalWrite: typeof process.stdout.write | null = null;
let guardInstalled = false;

/**
 * Install the stdout-write guard.
 *
 * Replaces `process.stdout.write` with a wrapper that throws for any call
 * not originating from the MCP SDK. Safe to call multiple times — installs
 * only once.
 */
export function installStdoutGuard(): void {
  if (guardInstalled) return;

  originalWrite = process.stdout.write;
  guardInstalled = true;

  const saved = originalWrite;

  process.stdout.write = function guardedWrite(
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ): boolean {
    const stack = new Error().stack ?? "";
    if (isAllowedStackTrace(stack)) {
      if (typeof encodingOrCallback === "function") {
        return (
          saved as (chunk: Uint8Array | string, cb: (err?: Error | null) => void) => boolean
        ).call(process.stdout, chunk, encodingOrCallback);
      }
      return (
        saved as (
          chunk: Uint8Array | string,
          encoding?: BufferEncoding,
          cb?: (err?: Error | null) => void,
        ) => boolean
      ).call(process.stdout, chunk, encodingOrCallback as BufferEncoding, callback);
    }

    const excerpt = typeof chunk === "string" ? chunk.slice(0, 120) : `<${chunk.byteLength} bytes>`;

    throw new OmniFocusError(
      "OF_STRAY_STDOUT",
      `Stray stdout write detected — stdout is reserved for MCP transport. Use process.stderr / logger for diagnostics. Attempted: ${JSON.stringify(excerpt)}`,
      {
        suggestion:
          "Replace console.log / process.stdout.write with process.stderr.write or logger.",
      },
    );
  } as typeof process.stdout.write;
}

/**
 * Remove the guard and restore the original `process.stdout.write`.
 * Intended for test teardown only.
 */
export function uninstallStdoutGuard(): void {
  if (!guardInstalled || !originalWrite) return;
  process.stdout.write = originalWrite;
  originalWrite = null;
  guardInstalled = false;
}
