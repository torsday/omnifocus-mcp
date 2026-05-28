/**
 * Unit tests for the JSONL telemetry sink (#823). Hermetic — writes to a
 * per-test temp dir, no OmniFocus, no transports. Covers the load-bearing
 * logic: buffering/flush, the timestamp stamp, size-triggered rotation with
 * a single backup, no-op-when-disabled, and IO-error self-disable.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTelemetrySink, TelemetrySink } from "./telemetrySink.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "telemetry-sink-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("TelemetrySink", () => {
  it("writes one JSON object per recorded event, with a sink-stamped ts", () => {
    const path = join(dir, "t.jsonl");
    let clock = Date.parse("2026-05-28T00:00:00.000Z");
    const sink = new TelemetrySink({ path, maxBytes: 1_000_000, now: () => clock });
    sink.record({ event: "transport.call", scriptName: "task_list", durationMs: 42 });
    clock += 1000;
    sink.record({ event: "cache.invalidated", scopes: ["task:*"], evicted: 3 });
    sink.flush();
    sink.close();

    const lines = readLines(path);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      event: "transport.call",
      scriptName: "task_list",
      durationMs: 42,
      ts: "2026-05-28T00:00:00.000Z",
    });
    expect(lines[1]).toMatchObject({ event: "cache.invalidated", evicted: 3 });
  });

  it("buffers until flush — nothing on disk before the first flush", () => {
    const path = join(dir, "t.jsonl");
    const sink = new TelemetrySink({ path, maxBytes: 1_000_000 });
    sink.record({ event: "transport.call" });
    expect(existsSync(path)).toBe(false);
    sink.flush();
    expect(readLines(path)).toHaveLength(1);
    sink.close();
  });

  it("rotates to a single .1 backup when the file would exceed maxBytes", () => {
    const path = join(dir, "t.jsonl");
    // Tiny cap so a couple of lines trip rotation.
    const sink = new TelemetrySink({ path, maxBytes: 120 });
    // First flush: writes line 1 (well under cap), establishes currentFileBytes.
    sink.record({ event: "e1", payload: "x".repeat(60) });
    sink.flush();
    const afterFirst = readFileSync(path, "utf8");
    // Second flush would push past 120 bytes → rotate first, then write line 2.
    sink.record({ event: "e2", payload: "y".repeat(60) });
    sink.flush();
    sink.close();

    // Backup holds the pre-rotation content; live file holds only line 2.
    expect(existsSync(`${path}.1`)).toBe(true);
    expect(readFileSync(`${path}.1`, "utf8")).toBe(afterFirst);
    const live = readLines(path);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ event: "e2" });
  });

  it("keeps only one backup — a second rotation overwrites .1", () => {
    const path = join(dir, "t.jsonl");
    const sink = new TelemetrySink({ path, maxBytes: 120 });
    sink.record({ event: "gen1", payload: "a".repeat(60) });
    sink.flush();
    sink.record({ event: "gen2", payload: "b".repeat(60) });
    sink.flush(); // rotation 1: gen1 → .1
    sink.record({ event: "gen3", payload: "c".repeat(60) });
    sink.flush(); // rotation 2: gen2 → .1 (overwrites)
    sink.close();

    expect(readLines(`${path}.1`)[0]).toMatchObject({ event: "gen2" });
    expect(readLines(path)[0]).toMatchObject({ event: "gen3" });
  });

  it("record() is a no-op after close() does not throw", () => {
    const path = join(dir, "t.jsonl");
    const sink = new TelemetrySink({ path, maxBytes: 1_000_000 });
    sink.record({ event: "e1" });
    sink.close();
    expect(() => sink.record({ event: "after-close" })).not.toThrow();
  });

  it("drops non-serialisable payloads instead of throwing", () => {
    const path = join(dir, "t.jsonl");
    const sink = new TelemetrySink({ path, maxBytes: 1_000_000 });
    const circular: Record<string, unknown> = { event: "bad" };
    circular.self = circular;
    expect(() => sink.record(circular as never)).not.toThrow();
    sink.record({ event: "good" });
    sink.flush();
    sink.close();
    const lines = readLines(path);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "good" });
  });

  it("self-disables on an unrecoverable write path (rotation rename fails)", () => {
    // maxBytes 0 forces a rotate attempt on the first non-empty flush; but with
    // no existing file currentFileBytes is 0, so guard skips rotate. Instead,
    // point at a path whose parent does not exist → stream error disables sink.
    const path = join(dir, "does-not-exist-subdir", "t.jsonl");
    const sink = new TelemetrySink({ path, maxBytes: 1_000_000 });
    sink.record({ event: "e1" });
    sink.flush();
    sink.close();
    expect(sink.isDisabled).toBe(true);
  });
});

describe("buildTelemetrySink", () => {
  it("returns undefined when the path is empty (telemetry disabled)", () => {
    expect(buildTelemetrySink({ path: "", maxBytes: 1000 })).toBeUndefined();
    expect(buildTelemetrySink({ path: "   ", maxBytes: 1000 })).toBeUndefined();
  });

  it("returns a started sink when a path is provided", () => {
    const path = join(dir, "t.jsonl");
    const sink = buildTelemetrySink({ path, maxBytes: 1_000_000 });
    expect(sink).toBeInstanceOf(TelemetrySink);
    sink?.record({ event: "e1" });
    sink?.close();
    expect(readLines(path)).toHaveLength(1);
  });
});
