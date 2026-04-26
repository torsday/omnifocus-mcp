import { describe, expect, it } from "vitest";
import type { ResponseMeta, ToolSuccess } from "../envelope/index.js";
import { RateLimited } from "../errors/index.js";
import { ToolRateLimiter } from "./ToolRateLimiter.js";
import { withRateLimitMeta } from "./withRateLimitMeta.js";

const TOOL = "test_tool";

function makeBaseMeta(): ResponseMeta {
  return {
    correlationId: "test-correlation-id",
    durationMs: 10,
    cacheHit: false,
    transport: "jxa",
    ofVersion: "4.5.2",
  };
}

function makeHandler<T>(data: T): () => Promise<ToolSuccess<T>> {
  return () => Promise.resolve({ data, meta: makeBaseMeta() });
}

describe("withRateLimitMeta", () => {
  it("success path: injects rateLimit into meta", async () => {
    const limiter = new ToolRateLimiter({ limit: 3, windowSeconds: 60 });
    const result = await withRateLimitMeta(TOOL, limiter, makeHandler({ ok: true }));

    expect(result.meta.rateLimit).toBeDefined();
    const rl = result.meta.rateLimit;
    expect(rl).toBeDefined();
    if (!rl) return;
    expect(typeof rl.remaining).toBe("number");
    expect(typeof rl.resetAt).toBe("string");
    // One call was recorded, so remaining should be limit - 1 = 2
    expect(rl.remaining).toBe(2);
  });

  it("limit exceeded: propagates RateLimited throw", async () => {
    const limiter = new ToolRateLimiter({ limit: 1, windowSeconds: 60 });
    // Exhaust the limit
    await withRateLimitMeta(TOOL, limiter, makeHandler(null));

    // Second call should throw synchronously (check() throws before returning a promise)
    expect(() => withRateLimitMeta(TOOL, limiter, makeHandler(null))).toThrow(RateLimited);
  });

  it("remaining counts down: second call has lower remaining than first", async () => {
    const limiter = new ToolRateLimiter({ limit: 3, windowSeconds: 60 });

    const first = await withRateLimitMeta(TOOL, limiter, makeHandler(null));
    const second = await withRateLimitMeta(TOOL, limiter, makeHandler(null));

    const firstRemaining = first.meta.rateLimit?.remaining;
    const secondRemaining = second.meta.rateLimit?.remaining;
    expect(firstRemaining).toBeDefined();
    expect(secondRemaining).toBeDefined();
    expect(secondRemaining).toBeLessThan(firstRemaining as number);
  });

  it("no mutation of original meta: spread creates a new object", async () => {
    const limiter = new ToolRateLimiter({ limit: 3, windowSeconds: 60 });
    const originalMeta = makeBaseMeta();
    const handler = (): Promise<ToolSuccess<null>> =>
      Promise.resolve({ data: null, meta: originalMeta });

    const result = await withRateLimitMeta(TOOL, limiter, handler);

    // The result meta is a new object
    expect(result.meta).not.toBe(originalMeta);
    // The original is not mutated
    expect(originalMeta.rateLimit).toBeUndefined();
    // The result has the injected field
    expect(result.meta.rateLimit).toBeDefined();
  });
});
