/**
 * Unit tests for DatabaseWatcher.
 *
 * We avoid touching the real filesystem by patching `fs.existsSync` and
 * `fs.watch` with vi.spyOn / vi.fn. Timer behaviour is controlled with
 * vitest's fake timers so debounce logic can be tested deterministically.
 */

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseWatcher } from "./DatabaseWatcher.js";

// fs.watch has many overloads; cast the spy to avoid TS overload-resolution errors.
type FsWatchSpy = (path: fs.PathLike, opts: object, cb: fs.WatchListener<string>) => fs.FSWatcher;

vi.mock("../logging/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal EventEmitter-like FSWatcher stub. */
function makeFakeWatcher() {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts watching when the db path exists", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/fake/db.ofocus", debounceMs: 100 });
    watcher.start();

    expect(watchSpy).toHaveBeenCalledWith(
      "/fake/db.ofocus",
      { persistent: false },
      expect.any(Function),
    );
  });

  it("does not throw when the db path does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "watch");

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/nonexistent", debounceMs: 100 });
    expect(() => watcher.start()).not.toThrow();
  });

  it("does not call onChange before the debounce window", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef: { current: fs.WatchListener<string> | null } = { current: null };
    vi.spyOn(fs, "watch").mockImplementation(((
      _path: fs.PathLike,
      _opts: object,
      cb: fs.WatchListener<string>,
    ) => {
      cbRef.current = cb;
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/fake/db.ofocus", debounceMs: 200 });
    watcher.start();

    // Fire several rapid fs events
    cbRef.current?.("change", "OmniFocus.ofocus");
    cbRef.current?.("change", "OmniFocus.ofocus");
    cbRef.current?.("change", "OmniFocus.ofocus");

    // Advance time but not past the debounce window
    vi.advanceTimersByTime(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onChange once after the debounce window even with multiple rapid events", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef: { current: fs.WatchListener<string> | null } = { current: null };
    vi.spyOn(fs, "watch").mockImplementation(((
      _path: fs.PathLike,
      _opts: object,
      cb: fs.WatchListener<string>,
    ) => {
      cbRef.current = cb;
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/fake/db.ofocus", debounceMs: 200 });
    watcher.start();

    cbRef.current?.("change", "OmniFocus.ofocus");
    vi.advanceTimersByTime(50);
    cbRef.current?.("change", "OmniFocus.ofocus");
    vi.advanceTimersByTime(50);
    cbRef.current?.("change", "OmniFocus.ofocus");

    // Now advance past the debounce window from the last event
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("second start() call is a no-op", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const watchSpy = vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/fake/db.ofocus", debounceMs: 100 });
    watcher.start();
    watcher.start(); // second call

    expect(watchSpy).toHaveBeenCalledTimes(1);
  });

  it("stop() closes the watcher and clears pending debounce", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const cbRef: { current: fs.WatchListener<string> | null } = { current: null };
    vi.spyOn(fs, "watch").mockImplementation(((
      _path: fs.PathLike,
      _opts: object,
      cb: fs.WatchListener<string>,
    ) => {
      cbRef.current = cb;
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch);

    const onChange = vi.fn();
    const watcher = new DatabaseWatcher(onChange, { dbPath: "/fake/db.ofocus", debounceMs: 200 });
    watcher.start();

    cbRef.current?.("change", "OmniFocus.ofocus");
    watcher.stop();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);

    // Advance past debounce — onChange should not fire (timer was cleared)
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stop() is safe to call multiple times", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), { dbPath: "/fake/db.ofocus" });
    watcher.start();
    watcher.stop();
    expect(() => watcher.stop()).not.toThrow();
  });

  it("stops gracefully on FSWatcher error event", () => {
    const fakeWatcher = makeFakeWatcher();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "watch").mockReturnValue(fakeWatcher as unknown as fs.FSWatcher);

    const watcher = new DatabaseWatcher(vi.fn(), { dbPath: "/fake/db.ofocus" });
    watcher.start();

    // Simulate an error from the OS watcher
    fakeWatcher.emit("error", new Error("ENOENT: watch path removed"));

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });
});
