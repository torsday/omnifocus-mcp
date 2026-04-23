import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimited } from "../errors/index.js";
import { ToolRateLimiter } from "./ToolRateLimiter.js";

describe("ToolRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeConfig = (limit = 3, windowSeconds = 60) => ({ limit, windowSeconds });

  describe("burst allowed", () => {
    it("allows exactly limit calls without throwing", () => {
      const limiter = new ToolRateLimiter(makeConfig(3));
      expect(() => {
        limiter.check("tool_a");
        limiter.check("tool_a");
        limiter.check("tool_a");
      }).not.toThrow();
    });
  });

  describe("limit exceeded", () => {
    it("throws RateLimited on the (limit+1)th call", () => {
      const limiter = new ToolRateLimiter(makeConfig(3));
      limiter.check("tool_a");
      limiter.check("tool_a");
      limiter.check("tool_a");
      expect(() => limiter.check("tool_a")).toThrow(RateLimited);
    });

    it("throws with OF_RATE_LIMITED code", () => {
      const limiter = new ToolRateLimiter(makeConfig(1));
      limiter.check("tool_a");
      try {
        limiter.check("tool_a");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimited);
        expect((err as RateLimited).code).toBe("OF_RATE_LIMITED");
      }
    });
  });

  describe("retryAfterMs in error", () => {
    it("carries a positive retryAfterMs in details", () => {
      const limiter = new ToolRateLimiter(makeConfig(1, 60));
      limiter.check("tool_a");
      try {
        limiter.check("tool_a");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimited);
        const details = (err as RateLimited).details as { retryAfterMs: number };
        expect(details.retryAfterMs).toBeGreaterThan(0);
      }
    });

    it("retryAfterMs equals time until oldest call expires", () => {
      const limiter = new ToolRateLimiter(makeConfig(1, 60));
      const startMs = Date.now();
      limiter.check("tool_a");

      // Advance by 10 seconds
      vi.advanceTimersByTime(10_000);

      try {
        limiter.check("tool_a");
        expect.fail("should have thrown");
      } catch (err) {
        const details = (err as RateLimited).details as { retryAfterMs: number };
        // oldest call was at startMs, window = 60s
        // retryAfterMs = startMs + 60000 - now + 1 = 60000 - 10000 + 1 = 50001
        expect(details.retryAfterMs).toBe(startMs + 60_000 - Date.now() + 1);
      }
    });
  });

  describe("window slides", () => {
    it("allows new calls after the window passes", () => {
      const limiter = new ToolRateLimiter(makeConfig(1, 60));
      limiter.check("tool_a");

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      expect(() => limiter.check("tool_a")).not.toThrow();
    });

    it("only prunes calls outside the window", () => {
      const limiter = new ToolRateLimiter(makeConfig(2, 60));
      limiter.check("tool_a"); // t=0
      vi.advanceTimersByTime(30_000); // t=30s
      limiter.check("tool_a"); // t=30s — now window has 2 calls
      expect(() => limiter.check("tool_a")).toThrow(RateLimited);

      // advance to t=61s — first call at t=0 has expired
      vi.advanceTimersByTime(31_000);
      expect(() => limiter.check("tool_a")).not.toThrow();
    });
  });

  describe("per-tool isolation", () => {
    it("exceeding one tool does not affect another", () => {
      const limiter = new ToolRateLimiter(makeConfig(1));
      limiter.check("tool_a");
      expect(() => limiter.check("tool_a")).toThrow(RateLimited);
      expect(() => limiter.check("tool_b")).not.toThrow();
    });
  });

  describe("remaining()", () => {
    it("starts at limit and counts down", () => {
      const limiter = new ToolRateLimiter(makeConfig(3));
      expect(limiter.remaining("tool_a").remaining).toBe(3);
      limiter.check("tool_a");
      expect(limiter.remaining("tool_a").remaining).toBe(2);
      limiter.check("tool_a");
      expect(limiter.remaining("tool_a").remaining).toBe(1);
      limiter.check("tool_a");
      expect(limiter.remaining("tool_a").remaining).toBe(0);
    });

    it("resets to limit after window passes", () => {
      const limiter = new ToolRateLimiter(makeConfig(2, 60));
      limiter.check("tool_a");
      limiter.check("tool_a");
      expect(limiter.remaining("tool_a").remaining).toBe(0);

      vi.advanceTimersByTime(61_000);
      expect(limiter.remaining("tool_a").remaining).toBe(2);
    });

    it("does not record a call (read-only)", () => {
      const limiter = new ToolRateLimiter(makeConfig(1));
      limiter.remaining("tool_a");
      limiter.remaining("tool_a");
      // Should still be able to make a call
      expect(() => limiter.check("tool_a")).not.toThrow();
    });

    it("returns resetAt as an ISO-8601 string", () => {
      const limiter = new ToolRateLimiter(makeConfig(3, 60));
      const { resetAt } = limiter.remaining("tool_a");
      expect(() => new Date(resetAt)).not.toThrow();
      expect(resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("resetAt points to when oldest call expires when window has entries", () => {
      const limiter = new ToolRateLimiter(makeConfig(3, 60));
      const startMs = Date.now();
      limiter.check("tool_a");
      vi.advanceTimersByTime(5_000);
      const { resetAt } = limiter.remaining("tool_a");
      expect(new Date(resetAt).getTime()).toBe(startMs + 60_000);
    });
  });

  describe("reset()", () => {
    it("clears all records for a tool, allowing immediate calls again", () => {
      const limiter = new ToolRateLimiter(makeConfig(1));
      limiter.check("tool_a");
      expect(() => limiter.check("tool_a")).toThrow(RateLimited);
      limiter.reset("tool_a");
      expect(() => limiter.check("tool_a")).not.toThrow();
    });

    it("does not affect other tools", () => {
      const limiter = new ToolRateLimiter(makeConfig(1));
      limiter.check("tool_a");
      limiter.check("tool_b");
      limiter.reset("tool_a");
      expect(() => limiter.check("tool_a")).not.toThrow();
      expect(() => limiter.check("tool_b")).toThrow(RateLimited);
    });
  });
});
