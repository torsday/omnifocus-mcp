/**
 * Tests for the `clarify` replay-token dispatcher.
 *
 * Covers: token consumption ordering (validate-before-consume, C25),
 * single-use semantics on success, and the NotFound path for missing
 * or expired tokens. Uses an isolated `ReplayStore` per test — the
 * module-level singleton is never touched.
 */

import { describe, expect, it, vi } from "vitest";
import type { ResponseMeta, ToolError } from "../envelope/index.js";
import { ReplayStore } from "../state/replayStore.js";
import { handleClarify } from "./clarify.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx(store: ReplayStore) {
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { makeMeta, replayStore: store };
}

function asError(envelope: unknown): ToolError["error"] {
  const e = envelope as ToolError;
  if (e.error === undefined) throw new Error("expected an error envelope");
  return e.error;
}

// ---------------------------------------------------------------------------
// Token lookup
// ---------------------------------------------------------------------------

describe("clarify — missing token", () => {
  it("returns NotFound for an unknown token", async () => {
    const store = new ReplayStore();
    const result = await handleClarify({ replayToken: "nope", choice: 0 }, makeCtx(store));
    expect(asError(result).code).toBe("OF_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Validate-before-consume (C25)
// ---------------------------------------------------------------------------

describe("clarify — out-of-range choice", () => {
  it("returns ValidationError listing the valid options", async () => {
    const store = new ReplayStore();
    const token = store.register(["complete just this task", "complete with children"], () =>
      Promise.resolve({ done: true }),
    );
    const result = await handleClarify({ replayToken: token, choice: 2 }, makeCtx(store));
    const error = asError(result);
    expect(error.code).toBe("OF_VALIDATION");
    expect(error.suggestion).toMatch(/Valid options: 0: /);
  });

  it("does NOT consume the token, so the corrected retry succeeds", async () => {
    const store = new ReplayStore();
    const callback = vi.fn().mockResolvedValue({ done: true });
    const token = store.register(["option a", "option b"], callback);

    // Bad index first — the error's suggestion invites a corrected retry.
    const bad = await handleClarify({ replayToken: token, choice: 5 }, makeCtx(store));
    expect(asError(bad).code).toBe("OF_VALIDATION");
    expect(callback).not.toHaveBeenCalled();

    // The corrected retry must reach the callback, not NotFound.
    const good = await handleClarify({ replayToken: token, choice: 1 }, makeCtx(store));
    expect(good).toEqual({ done: true });
    expect(callback).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Single-use on success
// ---------------------------------------------------------------------------

describe("clarify — single-use", () => {
  it("consumes the token on a valid call; the replay returns NotFound", async () => {
    const store = new ReplayStore();
    const callback = vi.fn().mockResolvedValue({ done: true });
    const token = store.register(["only option"], callback);

    const first = await handleClarify({ replayToken: token, choice: 0 }, makeCtx(store));
    expect(first).toEqual({ done: true });

    const replay = await handleClarify({ replayToken: token, choice: 0 }, makeCtx(store));
    expect(asError(replay).code).toBe("OF_NOT_FOUND");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("consumes the token before executing the callback (at-most-once)", async () => {
    const store = new ReplayStore();
    const token = store.register(["only option"], () => {
      // By the time the callback runs, the token must already be gone —
      // a crash mid-callback must not leave a replayable token behind.
      expect(store.get(token)).toBeUndefined();
      return Promise.resolve({ done: true });
    });
    const result = await handleClarify({ replayToken: token, choice: 0 }, makeCtx(store));
    expect(result).toEqual({ done: true });
  });
});
