/**
 * Unit tests for the wire-byte cap (#776) — the final stage of the response
 * envelope pipeline. Covers the no-op path, mid-result truncation, the
 * forward-progress guarantee, hard-ceiling clamping, and the env parse rule.
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyByteCap,
  applyByteCapById,
  type ByteCapByIdOptions,
  type ByteCapOptions,
  capByMeasuredPrefix,
  DEFAULT_HARD_CEILING_BYTES,
  resolveHardCeilingBytes,
} from "./cap.js";

// Each `{ id: "a" }` serializes to `{"id":"a"}` = 10 bytes; the array adds 2 for
// the `[]` framing and 1 comma between items.
const item = (id: string) => ({ id });
const cursorFor = (i: number) => `cursor@${i}`;

function cap<T>(items: readonly T[], opts: Partial<ByteCapOptions> = {}) {
  return applyByteCap(items, { cursorFor, ...opts });
}

describe("applyByteCap — no-op paths", () => {
  it("returns an empty array unchanged", () => {
    const r = cap([]);
    expect(r).toMatchObject({
      truncatedAtCap: false,
      bytesReturned: 2,
      itemsReturned: 0,
      cursor: null,
    });
    expect(r.items).toEqual([]);
  });

  it("does not cap when maxOutputBytes is undefined", () => {
    const items = [item("a"), item("b"), item("c")];
    const r = cap(items);
    expect(r.truncatedAtCap).toBe(false);
    expect(r.items).toBe(items); // same reference — no slice
    expect(r.itemsReturned).toBe(3);
    expect(r.cursor).toBeNull();
  });

  it("does not cap when the array fits under maxOutputBytes", () => {
    const items = [item("a"), item("b")];
    // 2 framing + 10 + 1 comma + 10 = 23 bytes
    const r = cap(items, { maxOutputBytes: 100 });
    expect(r.truncatedAtCap).toBe(false);
    expect(r.bytesReturned).toBe(23);
    expect(r.itemsReturned).toBe(2);
    expect(r.cursor).toBeNull();
  });
});

describe("applyByteCap — truncation", () => {
  it("trims mid-result and re-anchors the cursor at the last kept item", () => {
    const items = [item("a"), item("b"), item("c")];
    // cap 22: item0 → 2+10=12; item1 → 12+1+10=23 > 22 → stop at 1 kept
    const r = cap(items, { maxOutputBytes: 22 });
    expect(r.truncatedAtCap).toBe(true);
    expect(r.itemsReturned).toBe(1);
    expect(r.bytesReturned).toBe(12);
    expect(r.items).toEqual([item("a")]);
    expect(r.cursor).toBe("cursor@0");
  });

  it("keeps exactly the items that fit (boundary equal to cap)", () => {
    const items = [item("a"), item("b"), item("c")];
    // cap 23: keeps 2 (12 then 23), item2 would be 34 > 23
    const r = cap(items, { maxOutputBytes: 23 });
    expect(r.itemsReturned).toBe(2);
    expect(r.bytesReturned).toBe(23);
    expect(r.cursor).toBe("cursor@1");
  });

  it("only calls cursorFor when truncation actually occurs", () => {
    const spy = vi.fn(cursorFor);
    cap([item("a")], { maxOutputBytes: 1000, cursorFor: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("applyByteCap — forward-progress guarantee", () => {
  it("returns a single oversized item rather than an empty page when more follow", () => {
    const items = [item("aaaaaaaaaa"), item("b")];
    // first item alone exceeds a tiny cap, but is kept so pagination advances
    const r = cap(items, { maxOutputBytes: 5 });
    expect(r.itemsReturned).toBe(1);
    expect(r.truncatedAtCap).toBe(true);
    expect(r.cursor).toBe("cursor@0");
  });

  it("does not mark truncated when a lone oversized item is the whole array", () => {
    const r = cap([item("aaaaaaaaaa")], { maxOutputBytes: 5 });
    expect(r.itemsReturned).toBe(1);
    expect(r.truncatedAtCap).toBe(false);
    expect(r.cursor).toBeNull();
  });
});

describe("applyByteCap — hard ceiling", () => {
  it("clamps a pathological maxOutputBytes to the hard ceiling", () => {
    const items = [item("a"), item("b"), item("c")];
    const r = cap(items, { maxOutputBytes: Number.MAX_SAFE_INTEGER, hardCeilingBytes: 12 });
    expect(r.truncatedAtCap).toBe(true);
    expect(r.itemsReturned).toBe(1); // ceiling 12 → only first item fits
  });
});

describe("resolveHardCeilingBytes", () => {
  it("defaults when the env var is absent", () => {
    expect(resolveHardCeilingBytes(undefined)).toBe(DEFAULT_HARD_CEILING_BYTES);
  });

  it("accepts a positive integer", () => {
    expect(resolveHardCeilingBytes("2048")).toBe(2048);
  });

  it.each(["0", "-5", "abc", "1.5", ""])("falls back to the default for %j", (raw) => {
    expect(resolveHardCeilingBytes(raw)).toBe(DEFAULT_HARD_CEILING_BYTES);
  });
});

// ---------------------------------------------------------------------------
// applyByteCapById — no-cursor model (#1060)
// ---------------------------------------------------------------------------

function capById<T extends { id: string }>(
  items: readonly T[],
  opts: Partial<ByteCapByIdOptions<T>> = {},
) {
  return applyByteCapById(items, { idOf: (x) => x.id, ...opts });
}

describe("applyByteCapById — no-op paths", () => {
  it("returns an empty array with no dropped ids", () => {
    const r = capById([]);
    expect(r).toMatchObject({ truncatedAtCap: false, bytesReturned: 2, itemsReturned: 0 });
    expect(r.droppedIds).toEqual([]);
  });

  it("does not cap when maxOutputBytes is undefined (same reference)", () => {
    const items = [item("a"), item("b"), item("c")];
    const r = capById(items);
    expect(r.truncatedAtCap).toBe(false);
    expect(r.items).toBe(items);
    expect(r.droppedIds).toEqual([]);
  });
});

describe("applyByteCapById — truncation", () => {
  it("reports the dropped tail by id, in input order", () => {
    const items = [item("a"), item("b"), item("c"), item("d")];
    // cap 22: keeps only item0 (12 bytes); item1 would be 23 > 22
    const r = capById(items, { maxOutputBytes: 22 });
    expect(r.truncatedAtCap).toBe(true);
    expect(r.itemsReturned).toBe(1);
    expect(r.bytesReturned).toBe(12);
    expect(r.items).toEqual([item("a")]);
    expect(r.droppedIds).toEqual(["b", "c", "d"]);
  });

  it("uses byte accounting identical to applyByteCap (boundary equal to cap)", () => {
    const items = [item("a"), item("b"), item("c")];
    const cursorRes = cap(items, { maxOutputBytes: 23 });
    const idRes = capById(items, { maxOutputBytes: 23 });
    expect(idRes.itemsReturned).toBe(cursorRes.itemsReturned);
    expect(idRes.bytesReturned).toBe(cursorRes.bytesReturned);
    expect(idRes.droppedIds).toEqual(["c"]);
  });

  it("emits a single oversized item whole with the rest dropped", () => {
    const items = [item("aaaaaaaaaa"), item("b")];
    const r = capById(items, { maxOutputBytes: 1 });
    expect(r.truncatedAtCap).toBe(true);
    expect(r.itemsReturned).toBe(1);
    expect(r.items).toEqual([item("aaaaaaaaaa")]);
    expect(r.droppedIds).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// capByMeasuredPrefix — measured (non-array) model (#1065)
// ---------------------------------------------------------------------------

describe("capByMeasuredPrefix", () => {
  // Linear measure: 2 framing + 10 bytes per kept item.
  const measure = (k: number) => 2 + k * 10;

  it("returns 0 kept for an empty sequence", () => {
    const r = capByMeasuredPrefix(0, measure, { maxOutputBytes: 100 });
    expect(r).toMatchObject({ keptCount: 0, truncatedAtCap: false, bytesReturned: 2 });
  });

  it("keeps everything when the full payload fits", () => {
    const r = capByMeasuredPrefix(4, measure, { maxOutputBytes: 1000 });
    expect(r).toMatchObject({ keptCount: 4, truncatedAtCap: false, bytesReturned: 42 });
  });

  it("keeps everything when no cap is set", () => {
    const r = capByMeasuredPrefix(4, measure, {});
    expect(r.keptCount).toBe(4);
    expect(r.truncatedAtCap).toBe(false);
  });

  it("binary-searches the largest fitting prefix", () => {
    // cap 22: measure(2)=22 fits, measure(3)=32 doesn't → keep 2.
    const r = capByMeasuredPrefix(4, measure, { maxOutputBytes: 22 });
    expect(r).toMatchObject({ keptCount: 2, truncatedAtCap: true, bytesReturned: 22 });
  });

  it("keeps at least one item even when the first already exceeds the cap", () => {
    const r = capByMeasuredPrefix(4, measure, { maxOutputBytes: 5 });
    expect(r).toMatchObject({ keptCount: 1, truncatedAtCap: true, bytesReturned: 12 });
  });

  it("clamps a pathological cap to the hard ceiling", () => {
    const r = capByMeasuredPrefix(4, measure, {
      maxOutputBytes: Number.MAX_SAFE_INTEGER,
      hardCeilingBytes: 22,
    });
    expect(r).toMatchObject({ keptCount: 2, truncatedAtCap: true });
  });
});
