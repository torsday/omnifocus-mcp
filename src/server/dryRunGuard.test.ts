/**
 * Unit tests for dryRunGuard and markDryRun.
 *
 * @see src/server/dryRunGuard.ts
 */

import { describe, expect, it, vi } from "vitest";
import type { ResponseMeta, ToolEnvelope } from "../envelope/index.js";
import { dryRunGuard, markDryRun } from "./dryRunGuard.js";

function meta(overrides: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "unknown",
    syncPending: true,
    ...overrides,
  };
}

function success<T>(data: T): ToolEnvelope<T> {
  return { data, meta: meta() };
}

describe("dryRunGuard — passthrough", () => {
  it("runs fn and skips preview when dryRun is undefined", async () => {
    const fn = vi.fn(async () => success({ id: "t1" }));
    const preview = vi.fn(() => success<{ id: string | null }>({ id: null }));
    const out = await dryRunGuard<{ id: string | null }>(
      undefined,
      preview,
      fn as () => Promise<ToolEnvelope<{ id: string | null }>>,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(out.meta.dryRun).toBeUndefined();
    expect((out as { data: { id: string | null } }).data.id).toBe("t1");
  });

  it("runs fn and skips preview when dryRun is false", async () => {
    const fn = vi.fn(async () => success({ id: "t1" }));
    const preview = vi.fn(() => success<{ id: string | null }>({ id: null }));
    const out = await dryRunGuard<{ id: string | null }>(
      false,
      preview,
      fn as () => Promise<ToolEnvelope<{ id: string | null }>>,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(out.meta.dryRun).toBeUndefined();
  });
});

describe("dryRunGuard — preview path", () => {
  it("calls preview (not fn) and stamps meta.dryRun=true, syncPending=false", async () => {
    const fn = vi.fn(async () => success({ id: "t1" }));
    const preview = vi.fn(() => success<{ id: string | null }>({ id: null }));
    const out = await dryRunGuard<{ id: string | null }>(true, preview, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(out.meta.dryRun).toBe(true);
    expect(out.meta.syncPending).toBe(false);
    expect((out as { data: { id: string | null } }).data.id).toBeNull();
  });

  it("awaits an async preview constructor", async () => {
    const fn = vi.fn(async () => success({ id: "t1" }));
    const preview = vi.fn(async () => success<{ id: string | null }>({ id: null }));
    const out = await dryRunGuard<{ id: string | null }>(true, preview, fn);
    expect(out.meta.dryRun).toBe(true);
    expect((out as { data: { id: string | null } }).data.id).toBeNull();
  });

  it("stamps dryRun on error envelopes from preview (validation rejected at preview time)", async () => {
    const errEnvelope: ToolEnvelope<unknown> = {
      error: {
        name: "ValidationError",
        code: "OF_VALIDATION",
        message: "bad",
        remediationClass: "input",
      },
      meta: meta(),
    };
    const out = await dryRunGuard<unknown>(
      true,
      () => errEnvelope,
      async () => success("unused"),
    );
    expect(out.meta.dryRun).toBe(true);
    expect(out.meta.syncPending).toBe(false);
    expect("error" in out).toBe(true);
  });

  it("does not mutate the envelope returned by preview", async () => {
    const original = success({ id: null as string | null });
    const out = await dryRunGuard<{ id: string | null }>(
      true,
      () => original,
      async () => success({ id: "t1" }),
    );
    expect(out.meta.dryRun).toBe(true);
    expect(original.meta.dryRun).toBeUndefined();
    expect(original.meta.syncPending).toBe(true);
  });

  it("propagates errors thrown by preview", async () => {
    const boom = new Error("preview failed");
    await expect(
      dryRunGuard(
        true,
        () => {
          throw boom;
        },
        async () => success("x"),
      ),
    ).rejects.toBe(boom);
  });

  it("propagates errors thrown by fn on the live path", async () => {
    const boom = new Error("fn failed");
    await expect(
      dryRunGuard(
        false,
        () => success("x"),
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);
  });
});

describe("markDryRun", () => {
  it("returns a shallow clone with dryRun=true and syncPending=false", () => {
    const original = success({ id: null as string | null });
    const marked = markDryRun(original);
    expect(marked).not.toBe(original);
    expect(marked.meta).not.toBe(original.meta);
    expect(marked.meta.dryRun).toBe(true);
    expect(marked.meta.syncPending).toBe(false);
    expect(original.meta.dryRun).toBeUndefined();
    expect(original.meta.syncPending).toBe(true);
  });
});
