/**
 * Unit tests for DatabaseWatcher.
 *
 * We test both the Swift binary fast path and the Node fs.watch fallback.
 *
 * - The Swift fast path is exercised by supplying a fake `binaryPath` that
 *   points to a stub script (or by mocking `child_process.spawn`).
 * - The Node fallback is exercised by setting `binaryPath: null` and mocking
 *   `fs.existsSync` + `fs.watch` as before.
 * - Timer behaviour is controlled with vitest fake timers so debounce logic
 *   can be tested deterministically.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseWatcher, resolveDefaultDbPath } from "./DatabaseWatcher.js";
import type { ChangeContext } from "./types.js";

vi.mock("../logging/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// Mock child_process at the module level so `spawn` is replaceable across tests.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
// Import the mocked module *after* vi.mock so the binding is the mock.
const { spawn: spawnMock } = await import("node:child_process");

// ---------------------------------------------------------------------------
// Helpers — fs.watch fake
// ---------------------------------------------------------------------------

type FsWatchCb = fs.WatchListener<string>;

/** Create a minimal FSWatcher stub. */
function makeFakeNodeWatcher() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const watcher = {
    close: vi.fn(),
    on(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return watcher;
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
  };
  return watcher;
}

/** Install a fs.watch mock that captures the callback and returns a fake watcher. */
function installNodeWatchMock(fakeWatcher: ReturnType<typeof makeFakeNodeWatcher>) {
  const cbRef: { current: FsWatchCb | null } = { current: null };
  vi.spyOn(fs, "watch").mockImplementation(((_path: fs.PathLike, _opts: object, cb: FsWatchCb) => {
    cbRef.current = cb;
    return fakeWatcher as unknown as fs.FSWatcher;
  }) as unknown as typeof fs.watch);
  return cbRef;
}

// ---------------------------------------------------------------------------
// Helpers — child_process.spawn fake
// ---------------------------------------------------------------------------

/** Create a minimal ChildProcess stub with proper PassThrough streams. */
function makeFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  proc.kill = vi.fn();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

// ---------------------------------------------------------------------------
// Tests — Node fs.watch fallback (binaryPath: null)
// ---------------------------------------------------------------------------

describe("DatabaseWatcher — Node fs.watch fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts watching when the db path exists", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 100,
      binaryPath: null,
    });
    watcher.start();

    expect(watchSpy).toHaveBeenCalledWith(
      "/fake/db.ofocus",
      { persistent: false },
      expect.any(Function),
    );
  });

  it("does not throw when the db path does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/nonexistent",
      debounceMs: 100,
      binaryPath: null,
    });
    expect(() => watcher.start()).not.toThrow();
  });

  it("does not call onChange before the debounce window", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef = installNodeWatchMock(fakeWatcher);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 200,
      binaryPath: null,
    });
    watcher.start();

    cbRef.current?.("change", "OmniFocus.ofocus");
    cbRef.current?.("change", "OmniFocus.ofocus");
    cbRef.current?.("change", "OmniFocus.ofocus");

    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onChange once after debounce with source=node", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef = installNodeWatchMock(fakeWatcher);

    const onChange = vi.fn<(ctx: ChangeContext) => void>();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 200,
      binaryPath: null,
    });
    watcher.start();

    cbRef.current?.("change", "OmniFocus.ofocus");
    vi.advanceTimersByTime(50);
    cbRef.current?.("change", "OmniFocus.ofocus");
    vi.advanceTimersByTime(50);
    cbRef.current?.("change", "OmniFocus.ofocus");
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveBeenCalledTimes(1) above
    const ctx = onChange.mock.calls[0]![0] as ChangeContext;
    expect(ctx.source).toBe("node");
    expect(ctx.detectedAt).toBeDefined();
    expect(ctx.changedPaths).toBeUndefined();
  });

  it("second start() call is a no-op", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      debounceMs: 100,
      binaryPath: null,
    });
    watcher.start();
    watcher.start();

    expect(watchSpy).toHaveBeenCalledTimes(1);
  });

  it("stop() closes the watcher and clears pending debounce", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef = installNodeWatchMock(fakeWatcher);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 200,
      binaryPath: null,
    });
    watcher.start();

    cbRef.current?.("change", "OmniFocus.ofocus");
    watcher.stop();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stop() is safe to call multiple times", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: null,
    });
    watcher.start();
    watcher.stop();
    expect(() => watcher.stop()).not.toThrow();
  });

  it("stops gracefully on FSWatcher error event", () => {
    const fakeWatcher = makeFakeNodeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: null,
    });
    watcher.start();
    fakeWatcher.emit("error", new Error("ENOENT: watch path removed"));

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — Swift fast path
// ---------------------------------------------------------------------------

describe("DatabaseWatcher — Swift fast path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Simulate a JSON line arriving on the fake process stdout.
   * DatabaseWatcher uses readline.createInterface which reads "data" events
   * from the stream and emits "line" events on the interface — so we must
   * emit raw bytes on stdout, not a "line" event directly.
   */
  function emitSwiftLine(
    proc: ReturnType<typeof makeFakeProcess>,
    paths: string[],
    ts = "2026-04-25T17:00:00.000Z",
  ) {
    const line = JSON.stringify({ event: "change", paths, ts });
    proc.stdout.write(`${line}\n`);
  }

  it("spawns the binary with the db path as argument", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    expect(vi.mocked(spawnMock)).toHaveBeenCalledWith(
      "/fake/omnifocus-watcher",
      ["/fake/db.ofocus"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  it("fires onChange with source=swift and changedPaths after debounce", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);

    const onChange = vi.fn<(ctx: ChangeContext) => void>();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 200,
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    emitSwiftLine(fakeProc, ["abc.ofobjz"], "2026-04-25T17:00:00.100Z");
    vi.advanceTimersByTime(50);
    emitSwiftLine(fakeProc, ["def.ofobjz"], "2026-04-25T17:00:00.150Z");
    vi.advanceTimersByTime(250);

    expect(onChange).toHaveBeenCalledTimes(1);
    // biome-ignore lint/style/noNonNullAssertion: guarded by toHaveBeenCalledTimes(1) above
    const ctx = onChange.mock.calls[0]![0] as ChangeContext;
    expect(ctx.source).toBe("swift");
    // detectedAt is the FIRST event in the window
    expect(ctx.detectedAt).toBe("2026-04-25T17:00:00.100Z");
    // both paths are accumulated
    expect(ctx.changedPaths).toEqual(expect.arrayContaining(["abc.ofobjz", "def.ofobjz"]));
  });

  it("falls back to Node fs.watch when binary is not found", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    // accessSync throws → binary not found
    vi.spyOn(fs, "accessSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const fakeWatcher = makeFakeNodeWatcher();
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    expect(watchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to Node fs.watch when Swift process exits unexpectedly", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);
    const fakeWatcher = makeFakeNodeWatcher();
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    // Simulate unexpected exit
    fakeProc.emit("exit", 1, null);

    expect(watchSpy).toHaveBeenCalledTimes(1);
  });

  it("stop() sends SIGTERM to the Swift process", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);

    const watcher = new DatabaseWatcher(vi.fn(), {
      dbPath: "/fake/db.ofocus",
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();
    watcher.stop();

    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stop() clears pending debounce so onChange does not fire", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 200,
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    emitSwiftLine(fakeProc, ["abc.ofobjz"]);
    watcher.stop();

    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON lines from the binary", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const fakeProc = makeFakeProcess();
    vi.mocked(spawnMock).mockReturnValue(fakeProc as never);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, {
      dbPath: "/fake/db.ofocus",
      debounceMs: 100,
      binaryPath: "/fake/omnifocus-watcher",
    });
    watcher.start();

    // Bad line — should not throw
    fakeProc.stdout.write("{not valid json}\n");
    vi.advanceTimersByTime(200);

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — resolveDefaultDbPath()
// ---------------------------------------------------------------------------

describe("resolveDefaultDbPath", () => {
  const originalEnv = process.env.OF_DB_PATH;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.OF_DB_PATH;
    else process.env.OF_DB_PATH = originalEnv;
  });

  const home = os.homedir();
  const sandboxOf4 = path.join(
    home,
    "Library",
    "Containers",
    "com.omnigroup.OmniFocus4",
    "Data",
    "Library",
    "Application Support",
    "OmniFocus",
    "OmniFocus.ofocus",
  );
  const sandboxOf3 = path.join(
    home,
    "Library",
    "Containers",
    "com.omnigroup.OmniFocus3",
    "Data",
    "Library",
    "Application Support",
    "OmniFocus",
    "OmniFocus.ofocus",
  );
  const nonSandbox = path.join(
    home,
    "Library",
    "Application Support",
    "OmniFocus",
    "OmniFocus.ofocus",
  );

  it("honors OF_DB_PATH env override above all probing", () => {
    process.env.OF_DB_PATH = "/custom/loc/My.ofocus";
    const existsSpy = vi.spyOn(fs, "existsSync");
    expect(resolveDefaultDbPath()).toBe("/custom/loc/My.ofocus");
    expect(existsSpy).not.toHaveBeenCalled();
  });

  it("ignores empty OF_DB_PATH and falls through to probing", () => {
    process.env.OF_DB_PATH = "";
    vi.spyOn(fs, "existsSync").mockImplementation((p) => p === sandboxOf4);
    expect(resolveDefaultDbPath()).toBe(sandboxOf4);
  });

  it("prefers OmniFocus 4 sandbox container when present", () => {
    delete process.env.OF_DB_PATH;
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    expect(resolveDefaultDbPath()).toBe(sandboxOf4);
  });

  it("falls back to OmniFocus 3 sandbox when only OF3 exists", () => {
    delete process.env.OF_DB_PATH;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => p === sandboxOf3);
    expect(resolveDefaultDbPath()).toBe(sandboxOf3);
  });

  it("falls back to non-sandbox path when only it exists", () => {
    delete process.env.OF_DB_PATH;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => p === nonSandbox);
    expect(resolveDefaultDbPath()).toBe(nonSandbox);
  });

  it("returns the non-sandbox path as a final fallback when nothing exists", () => {
    delete process.env.OF_DB_PATH;
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(resolveDefaultDbPath()).toBe(nonSandbox);
  });
});
