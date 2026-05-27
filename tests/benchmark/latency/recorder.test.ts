/**
 * Recorder unit tests — synthesize `transport.call` events through the
 * public `emitTransportCall` API rather than spinning up real
 * `osascript`. The aggregator and emit layer are exercised together by
 * `aggregate.test.ts`; this file owns the listener-subscription contract.
 */

import { afterEach, describe, expect, test } from "vitest";
import {
  __resetTransportCallListeners,
  emitTransportCall,
} from "../../../src/logging/transportCall.js";
import { Recorder } from "./recorder.js";

afterEach(() => {
  __resetTransportCallListeners();
});

describe("Recorder", () => {
  test("captures every emitted event with monotonically-increasing sequence", () => {
    const r = new Recorder();
    r.start();
    emitTransportCall("jxa", "task_list", { x: 1 }, 100, "ok", 80);
    emitTransportCall("jxa", "task_get", { id: "a" }, 50, "ok", 80);
    emitTransportCall("omnijs", "task_move", { id: "a" }, 30, "ok");
    r.stop();

    const events = r.events;
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.scriptName)).toEqual(["task_list", "task_get", "task_move"]);
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(events[0]?.spawnFloorMs).toBe(80);
    expect(events[2]?.spawnFloorMs).toBeUndefined(); // omitted when not provided
  });

  test("stop() unsubscribes — no further events captured", () => {
    const r = new Recorder();
    r.start();
    emitTransportCall("jxa", "a", {}, 10, "ok");
    r.stop();
    emitTransportCall("jxa", "b", {}, 20, "ok");
    expect(r.events.map((e) => e.scriptName)).toEqual(["a"]);
  });

  test("start() / stop() are idempotent", () => {
    const r = new Recorder();
    r.start();
    r.start(); // no-op
    emitTransportCall("jxa", "x", {}, 1, "ok");
    r.stop();
    r.stop(); // no-op
    expect(r.events).toHaveLength(1);
  });

  test("events getter returns a copy (mutating the result doesn't poison the recorder)", () => {
    const r = new Recorder();
    r.start();
    emitTransportCall("jxa", "x", {}, 1, "ok");
    const snapshot = r.events;
    snapshot.length = 0;
    expect(r.events).toHaveLength(1);
  });
});
