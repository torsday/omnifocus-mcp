/**
 * Unit tests for `CalendarBridge` — Goldilocks coverage of the Node-side
 * subprocess wrapper. The Swift binary is stubbed out via injected
 * `spawn` and `existsSync` so these tests run on Linux CI without macOS
 * EventKit, without a built binary, and without TCC permission.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CalendarBridge } from "./calendarBridge.js";

// ---------------------------------------------------------------------------
// Helpers — fake subprocess
// ---------------------------------------------------------------------------

interface FakeProc extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

/**
 * Build a `spawn` stub that, on call, returns a fake ChildProcess and
 * synchronously feeds it the given stdout line + exit code on the next tick.
 */
function spawnStub(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  spawnError?: Error;
}): {
  spawn: (cmd: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv }) => ChildProcess;
  calls: Array<{ cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }>;
} {
  const calls: Array<{ cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> =
    [];
  const spawn = (cmd: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: o.env });
    if (opts.spawnError) throw opts.spawnError;
    const proc = makeFakeProc();
    queueMicrotask(() => {
      if (opts.stdout) proc.stdout.write(opts.stdout);
      if (opts.stderr) proc.stderr.write(opts.stderr);
      proc.stdout.end();
      proc.stderr.end();
      proc.emit("close", opts.exitCode ?? 0);
    });
    return proc as unknown as ChildProcess;
  };
  return { spawn, calls };
}

const ALWAYS_EXISTS = () => true;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CalendarBridge.ping", () => {
  it("parses the ping JSON line and returns it", async () => {
    const { spawn, calls } = spawnStub({
      stdout: '{"ready":false,"reason":"awaiting","permission":"granted"}\n',
    });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    const result = await bridge.ping();

    expect(result).toEqual({ ready: false, reason: "awaiting", permission: "granted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["ping"]);
  });
});

describe("CalendarBridge.getPermission", () => {
  it("returns the parsed permission state", async () => {
    const { spawn } = spawnStub({ stdout: '{"permission":"not-determined"}\n' });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    const result = await bridge.getPermission();

    expect(result).toEqual({ permission: "not-determined" });
  });
});

describe("CalendarBridge.requestAccess", () => {
  it("returns the granted flag and resolved permission", async () => {
    const { spawn, calls } = spawnStub({
      stdout: '{"granted":true,"permission":"granted"}\n',
    });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    const result = await bridge.requestAccess();

    expect(result).toEqual({ granted: true, permission: "granted" });
    expect(calls[0]?.args).toEqual(["request-access"]);
  });
});

describe("CalendarBridge.readEvents", () => {
  it("returns the events array on a successful read", async () => {
    const { spawn, calls } = spawnStub({
      stdout: JSON.stringify({
        events: [
          {
            id: "abc",
            title: "Standup",
            startsAt: "2026-04-29T09:00:00-05:00",
            endsAt: "2026-04-29T09:30:00-05:00",
            allDay: false,
            calendarName: "Work",
            calendarSource: "iCloud",
            status: "confirmed",
          },
        ],
      }),
    });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    const events = await bridge.readEvents(
      "2026-04-29T00:00:00-05:00",
      "2026-04-30T00:00:00-05:00",
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Standup");
    expect(calls[0]?.args).toEqual([
      "calendar",
      "2026-04-29T00:00:00-05:00",
      "2026-04-30T00:00:00-05:00",
    ]);
  });

  it("forwards `sources` to the binary via OMNIFOCUS_CALENDAR_SOURCES env var", async () => {
    const { spawn, calls } = spawnStub({ stdout: '{"events":[]}' });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await bridge.readEvents(
      "2026-04-29T00:00:00-05:00",
      "2026-04-30T00:00:00-05:00",
      "Work,Personal",
    );

    expect(calls[0]?.env?.OMNIFOCUS_CALENDAR_SOURCES).toBe("Work,Personal");
  });

  it("throws CalendarPermissionDenied when the binary reports permission-denied", async () => {
    const { spawn } = spawnStub({
      stdout: '{"error":"permission-denied","permission":"not-determined"}',
    });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await expect(
      bridge.readEvents("2026-04-29T00:00:00-05:00", "2026-04-30T00:00:00-05:00"),
    ).rejects.toMatchObject({ code: "OF_CALENDAR_PERMISSION_DENIED" });
  });
});

describe("CalendarBridge error paths", () => {
  it("throws CalendarBridgeUnavailable when the binary is missing", async () => {
    const bridge = new CalendarBridge({
      binaryPath: "/nope",
      spawn: spawnStub({}).spawn,
      existsSync: () => false,
    });

    await expect(bridge.ping()).rejects.toMatchObject({ code: "OF_CALENDAR_BRIDGE_UNAVAILABLE" });
  });

  it("throws CalendarBridgeUnavailable on non-zero exit", async () => {
    const { spawn } = spawnStub({ stdout: "", stderr: "boom\n", exitCode: 1 });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await expect(bridge.ping()).rejects.toMatchObject({ code: "OF_CALENDAR_BRIDGE_UNAVAILABLE" });
  });

  it("throws CalendarBridgeUnavailable on unparseable JSON", async () => {
    const { spawn } = spawnStub({ stdout: "not json at all" });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await expect(bridge.ping()).rejects.toMatchObject({ code: "OF_CALENDAR_BRIDGE_UNAVAILABLE" });
  });

  it("throws CalendarBridgeUnavailable when spawn itself throws", async () => {
    const { spawn } = spawnStub({ spawnError: new Error("ENOENT") });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await expect(bridge.ping()).rejects.toMatchObject({ code: "OF_CALENDAR_BRIDGE_UNAVAILABLE" });
  });

  it("throws CalendarBridgeUnavailable when stdout is empty on success", async () => {
    const { spawn } = spawnStub({ stdout: "", exitCode: 0 });
    const bridge = new CalendarBridge({
      binaryPath: "/fake/bin",
      spawn,
      existsSync: ALWAYS_EXISTS,
    });

    await expect(bridge.ping()).rejects.toMatchObject({ code: "OF_CALENDAR_BRIDGE_UNAVAILABLE" });
  });
});

describe("CalendarBridge default options", () => {
  it("constructs without arguments (uses real fs.existsSync and spawn)", () => {
    expect(() => new CalendarBridge()).not.toThrow();
  });
});

// Silence unused-import warning when test runner doesn't need vi.fn directly.
void vi;
