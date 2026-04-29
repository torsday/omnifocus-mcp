/**
 * `CalendarBridge` — Node-side TypeScript wrapper around the Swift
 * `calendar-bridge` binary (per ADR-0018).
 *
 * The Swift binary is the seam between Node and macOS EventKit. This wrapper
 * spawns it as a one-shot subprocess, parses one JSON line of stdout, and
 * surfaces typed errors so callers can handle the macOS TCC permission flow
 * and the missing-binary case without parsing strings.
 *
 *   const bridge = new CalendarBridge();
 *   const { permission } = await bridge.getPermission();
 *   const events = await bridge.readEvents(from, to);
 *
 * The wrapper is intentionally thin — it does not cache permission state
 * between calls (the user can revoke at any time) and does not retry on
 * failure. Callers that need higher-level orchestration (capabilities probe,
 * agenda merging) should layer above this.
 *
 * @see docs/adr/0018-calendar-bridge-eventkit-only.md — architecture decision
 * @see tools/calendar-bridge/calendar-bridge.swift — subprocess source
 * @see src/watcher/DatabaseWatcher.ts — sibling subprocess pattern
 */

import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CalendarBridgeUnavailable, CalendarPermissionDenied } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Wire-format types — match calendar-bridge.swift exactly
// ---------------------------------------------------------------------------

/** Authorization state surfaced by EventKit, mapped to wire-stable strings. */
export type CalendarPermission = "not-determined" | "denied" | "restricted" | "granted";

export interface PingResult {
  ready: boolean;
  reason: string;
  permission: CalendarPermission;
}

export interface PermissionResult {
  permission: CalendarPermission;
}

export interface RequestAccessResult {
  granted: boolean;
  permission: CalendarPermission;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  calendarName: string;
  calendarSource: string;
  location?: string;
  status: "confirmed" | "tentative" | "cancelled";
  isAttendee?: boolean;
}

// ---------------------------------------------------------------------------
// Spawn injection — tests stub this out so they don't depend on a built binary
// ---------------------------------------------------------------------------

/** Minimal subset of `child_process.spawn` we depend on, narrowed for tests. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv },
) => ChildProcess;

export interface CalendarBridgeOptions {
  /**
   * Override the path to the `calendar-bridge` Swift binary.
   * Default: `<package-root>/bin/calendar-bridge`.
   */
  binaryPath?: string;
  /** Spawn implementation — overridden in tests. */
  spawn?: SpawnFn;
  /** `existsSync` implementation — overridden in tests. */
  existsSync?: (p: string) => boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Resolve the default binary path relative to this file's location so it
 * works identically in `src/` (tsx dev) and `dist/` (compiled) layouts:
 *   src/bridge/calendarBridge.ts  →  ../../bin/calendar-bridge
 *   dist/bridge/calendarBridge.js →  ../../bin/calendar-bridge
 */
function defaultBinaryPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "../../bin/calendar-bridge");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CalendarBridge {
  private readonly binaryPath: string;
  private readonly spawn: SpawnFn;
  private readonly existsSync: (p: string) => boolean;

  constructor(options: CalendarBridgeOptions = {}) {
    this.binaryPath = options.binaryPath ?? defaultBinaryPath();
    this.spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.existsSync = options.existsSync ?? fs.existsSync;
  }

  /** Health check; emits readiness flag and current authorization state. */
  async ping(): Promise<PingResult> {
    return this.invoke<PingResult>(["ping"]);
  }

  /** Current authorization state without triggering the macOS TCC prompt. */
  async getPermission(): Promise<PermissionResult> {
    return this.invoke<PermissionResult>(["permission"]);
  }

  /**
   * Trigger the macOS Calendar TCC prompt (or return cached state if already
   * answered). Blocks until EventKit's completion handler fires.
   */
  async requestAccess(): Promise<RequestAccessResult> {
    return this.invoke<RequestAccessResult>(["request-access"]);
  }

  /**
   * Read calendar events in the half-open interval `[from, to)`. Both arguments
   * are ISO-8601 strings with offset, e.g. `2026-04-29T00:00:00-05:00`.
   *
   * Throws `CalendarPermissionDenied` if the user has not granted access; the
   * caller can recover by invoking `requestAccess()` first.
   *
   * @param sources Optional comma-separated calendar-name substrings (matches
   *                the Swift binary's `OMNIFOCUS_CALENDAR_SOURCES` env var).
   */
  async readEvents(from: string, to: string, sources?: string): Promise<CalendarEvent[]> {
    const env = sources ? { ...process.env, OMNIFOCUS_CALENDAR_SOURCES: sources } : process.env;
    const result = await this.invoke<{ events: CalendarEvent[] } | CalendarErrorPayload>(
      ["calendar", from, to],
      env,
    );
    if ("error" in result) {
      if (result.error === "permission-denied") {
        throw new CalendarPermissionDenied({
          details: { permission: result.permission },
        });
      }
      throw new CalendarBridgeUnavailable(`calendar-bridge returned error: ${result.error}`, {
        details: { error: result.error },
      });
    }
    return result.events;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async invoke<T>(args: readonly string[], env?: NodeJS.ProcessEnv): Promise<T> {
    if (!this.existsSync(this.binaryPath)) {
      throw new CalendarBridgeUnavailable(
        `calendar-bridge binary not found at ${this.binaryPath}`,
        { details: { binaryPath: this.binaryPath } },
      );
    }

    let proc: ChildProcess;
    try {
      proc = this.spawn(this.binaryPath, args, env ? { env } : {});
    } catch (cause) {
      throw new CalendarBridgeUnavailable(
        `failed to spawn calendar-bridge: ${(cause as Error).message}`,
        { cause, details: { binaryPath: this.binaryPath } },
      );
    }

    return new Promise<T>((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      proc.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });

      proc.on("error", (err) => {
        reject(
          new CalendarBridgeUnavailable(`calendar-bridge spawn error: ${err.message}`, {
            cause: err,
          }),
        );
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(
            new CalendarBridgeUnavailable(
              `calendar-bridge exited with code ${code}: ${stderr.trim()}`,
              { details: { exitCode: code, stderr: stderr.trim() } },
            ),
          );
          return;
        }
        const line = stdout.trim().split("\n")[0] ?? "";
        if (!line) {
          reject(
            new CalendarBridgeUnavailable("calendar-bridge produced no output", {
              details: { stderr: stderr.trim() },
            }),
          );
          return;
        }
        try {
          resolve(JSON.parse(line) as T);
        } catch (cause) {
          reject(
            new CalendarBridgeUnavailable(
              `calendar-bridge produced unparsable JSON: ${line.slice(0, 200)}`,
              { cause, details: { line } },
            ),
          );
        }
      });
    });
  }
}

interface CalendarErrorPayload {
  error: string;
  permission: CalendarPermission;
}
