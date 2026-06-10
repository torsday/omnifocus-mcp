/**
 * Unit tests for IdempotencyStore and withIdempotencyKey.
 *
 * Injected clock keeps TTL assertions deterministic. Concurrency tests use
 * real Promises but no real timers.
 *
 * @see src/server/idempotencyStore.ts
 */

import { describe, expect, it, vi } from "vitest";
import type { ResponseMeta, ToolEnvelope } from "../envelope/index.js";
import { IdempotencyStore, withIdempotencyKey } from "./idempotencyStore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClock(initial = 0) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function meta(overrides: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "unknown",
    ...overrides,
  };
}

function success<T>(data: T): ToolEnvelope<T> {
  return { data, meta: meta() };
}

function failure(): ToolEnvelope<unknown> {
  return {
    error: {
      name: "InvalidInput",
      code: "OF_VALIDATION",
      message: "bad",
      remediationClass: "input",
    },
    meta: meta(),
  };
}

// ---------------------------------------------------------------------------
// Store — set/get/TTL/LRU
// ---------------------------------------------------------------------------

describe("IdempotencyStore — ttlMs", () => {
  it("exposes the resolved TTL from the constructor option", () => {
    expect(new IdempotencyStore({ ttlMs: 1234 }).ttlMs).toBe(1234);
  });

  it("defaults to 600_000 (10 min) when no option is given", () => {
    expect(new IdempotencyStore().ttlMs).toBe(600_000);
  });
});

describe("IdempotencyStore — set/get", () => {
  it("returns undefined for unknown keys", () => {
    const s = new IdempotencyStore();
    expect(s.get("nope")).toBeUndefined();
  });

  it("returns the stored envelope within TTL", () => {
    const clock = makeClock();
    const s = new IdempotencyStore({ ttlMs: 1000, now: clock.now });
    const env = success({ id: "t1" });
    s.set("k", env);
    expect(s.get("k")).toBe(env);
    clock.advance(999);
    expect(s.get("k")).toBe(env);
  });

  it("evicts entries past their TTL on read", () => {
    const clock = makeClock();
    const s = new IdempotencyStore({ ttlMs: 1000, now: clock.now });
    s.set("k", success({ id: "t1" }));
    clock.advance(1001);
    expect(s.get("k")).toBeUndefined();
    expect(s.size).toBe(0);
  });

  it("enforces maxEntries via LRU eviction (oldest out first)", () => {
    const s = new IdempotencyStore({ maxEntries: 3 });
    s.set("a", success(1));
    s.set("b", success(2));
    s.set("c", success(3));
    // Touch "a" so "b" becomes the oldest.
    s.get("a");
    s.set("d", success(4));
    expect(s.get("a")).toBeDefined();
    expect(s.get("b")).toBeUndefined();
    expect(s.get("c")).toBeDefined();
    expect(s.get("d")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// withIdempotencyKey — wrapper semantics
// ---------------------------------------------------------------------------

describe("withIdempotencyKey", () => {
  it("runs fn exactly once and returns its envelope when key is fresh", async () => {
    const s = new IdempotencyStore();
    const fn = vi.fn(async () => success({ id: "t1" }));
    const out = await withIdempotencyKey(s, "k1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(out.meta.idempotentReplay).toBeUndefined();
    expect((out as { data: { id: string } }).data.id).toBe("t1");
  });

  it("replays the stored envelope on second call within TTL", async () => {
    const clock = makeClock();
    const s = new IdempotencyStore({ ttlMs: 1000, now: clock.now });
    const fn = vi.fn(async () => success({ id: "t1" }));
    await withIdempotencyKey(s, "k1", fn);
    const replay = await withIdempotencyKey(s, "k1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(replay.meta.idempotentReplay).toBe(true);
    expect((replay as { data: { id: string } }).data.id).toBe("t1");
  });

  it("re-executes fn after TTL expires", async () => {
    const clock = makeClock();
    const s = new IdempotencyStore({ ttlMs: 1000, now: clock.now });
    const fn = vi.fn(async () => success({ n: 1 }));
    await withIdempotencyKey(s, "k1", fn);
    clock.advance(1001);
    await withIdempotencyKey(s, "k1", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("caches and replays error envelopes just like successes", async () => {
    const s = new IdempotencyStore();
    const fn = vi.fn(async () => failure());
    const first = await withIdempotencyKey(s, "k1", fn);
    const second = await withIdempotencyKey(s, "k1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect("error" in first).toBe(true);
    expect("error" in second).toBe(true);
    expect(second.meta.idempotentReplay).toBe(true);
  });

  it("does not cache or mark replay when key is undefined", async () => {
    const s = new IdempotencyStore();
    const fn = vi.fn(async () => success({ n: 1 }));
    const a = await withIdempotencyKey(s, undefined, fn);
    const b = await withIdempotencyKey(s, undefined, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(a.meta.idempotentReplay).toBeUndefined();
    expect(b.meta.idempotentReplay).toBeUndefined();
    expect(s.size).toBe(0);
  });

  it("coalesces concurrent callers onto a single in-flight execution", async () => {
    const s = new IdempotencyStore();
    let resolveInner: ((env: ToolEnvelope<{ id: string }>) => void) | undefined;
    const fn = vi.fn(
      () =>
        new Promise<ToolEnvelope<{ id: string }>>((resolve) => {
          resolveInner = resolve;
        }),
    );
    const p1 = withIdempotencyKey(s, "k1", fn);
    const p2 = withIdempotencyKey(s, "k1", fn);
    const p3 = withIdempotencyKey(s, "k1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    if (!resolveInner) throw new Error("fn was not invoked");
    resolveInner(success({ id: "t1" }));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect((r1 as { data: { id: string } }).data.id).toBe("t1");
    expect((r2 as { data: { id: string } }).data.id).toBe("t1");
    expect((r3 as { data: { id: string } }).data.id).toBe("t1");
    // First caller gets the fresh envelope; later in-flight joiners get replay=true.
    expect(r1.meta.idempotentReplay).toBeUndefined();
    expect(r2.meta.idempotentReplay).toBe(true);
    expect(r3.meta.idempotentReplay).toBe(true);
  });

  it("does not mutate the stored envelope when marking replays", async () => {
    const s = new IdempotencyStore();
    const original = success({ id: "t1" });
    await withIdempotencyKey(s, "k1", async () => original);
    const replay = await withIdempotencyKey(s, "k1", async () => original);
    expect(replay.meta.idempotentReplay).toBe(true);
    expect(original.meta.idempotentReplay).toBeUndefined();
  });
});
