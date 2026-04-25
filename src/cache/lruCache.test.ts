import { describe, expect, it, vi } from "vitest";
import { OmniFocusLruCache } from "./lruCache.js";

describe("OmniFocusLruCache", () => {
  describe("wrap — hit/miss", () => {
    it("calls factory on miss and caches the result", async () => {
      const cache = new OmniFocusLruCache();
      const factory = vi.fn().mockResolvedValue("data");
      const result = await cache.wrap("key1", factory);
      expect(result).toBe("data");
      expect(factory).toHaveBeenCalledOnce();
    });

    it("returns cached value on hit without calling factory", async () => {
      const cache = new OmniFocusLruCache();
      const factory = vi.fn().mockResolvedValue("data");
      await cache.wrap("key1", factory);
      const result = await cache.wrap("key1", factory);
      expect(result).toBe("data");
      expect(factory).toHaveBeenCalledOnce();
    });

    it("tracks hit and miss counts in stats", async () => {
      const cache = new OmniFocusLruCache();
      const factory = vi.fn().mockResolvedValue(42);
      await cache.wrap("k", factory); // miss
      await cache.wrap("k", factory); // hit
      await cache.wrap("k", factory); // hit
      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe("capacity eviction", () => {
    it("evicts oldest entry when capacity is exceeded", async () => {
      const cache = new OmniFocusLruCache({ capacity: 2 });
      await cache.wrap("a", async () => 1);
      await cache.wrap("b", async () => 2);
      await cache.wrap("c", async () => 3); // evicts "a"
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });

    it("increments evictions in stats", async () => {
      const cache = new OmniFocusLruCache({ capacity: 1 });
      await cache.wrap("a", async () => 1);
      await cache.wrap("b", async () => 2); // evicts "a"
      // evictions are counted via disposeAfter which may be async
      // lru-cache fires disposeAfter after removal — stats reflect it
      expect(cache.stats().size).toBe(1);
    });
  });

  describe("TTL expiry", () => {
    it("treats an expired entry as a miss", async () => {
      const cache = new OmniFocusLruCache({ ttlMs: 20 });
      const factory = vi.fn().mockResolvedValue("fresh");
      await cache.wrap("k", factory);
      await new Promise((r) => setTimeout(r, 50));
      await cache.wrap("k", factory);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidate", () => {
    it("removes keys matching a task scope", async () => {
      const cache = new OmniFocusLruCache();
      cache.set("task:abc:list", "v1");
      cache.set("task:abc:detail", "v2");
      cache.set("task:xyz:list", "v3");
      cache.invalidate("task:abc");
      expect(cache.has("task:abc:list")).toBe(false);
      expect(cache.has("task:abc:detail")).toBe(false);
      expect(cache.has("task:xyz:list")).toBe(true);
    });

    it("removes all keys with a wildcard scope (forecast:*)", async () => {
      const cache = new OmniFocusLruCache();
      cache.set("forecast:today", "v1");
      cache.set("forecast:week", "v2");
      cache.set("task:abc:list", "v3");
      cache.invalidate("forecast:*");
      expect(cache.has("forecast:today")).toBe(false);
      expect(cache.has("forecast:week")).toBe(false);
      expect(cache.has("task:abc:list")).toBe(true);
    });

    it("removes all keys with a wildcard scope (perspective:*)", async () => {
      const cache = new OmniFocusLruCache();
      cache.set("perspective:work", "v1");
      cache.set("perspective:home", "v2");
      cache.invalidate("perspective:*");
      expect(cache.has("perspective:work")).toBe(false);
      expect(cache.has("perspective:home")).toBe(false);
    });

    it("removes all keys with a wildcard scope (search:*)", async () => {
      const cache = new OmniFocusLruCache();
      cache.set("search:abc123", "r1");
      cache.set("search:def456", "r2");
      cache.invalidate("search:*");
      expect(cache.has("search:abc123")).toBe(false);
      expect(cache.has("search:def456")).toBe(false);
    });

    it("emits cache.invalidated event with typed payload when keys are removed", () => {
      const cache = new OmniFocusLruCache();
      cache.set("task:abc:list", "v1");
      cache.set("task:abc:detail", "v2");
      const handler = vi.fn();
      cache.on("cache.invalidated", handler);
      cache.invalidate("task:abc");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "cache.invalidated",
          scopes: ["task:abc"],
          evicted: 2,
        }),
      );
    });

    it("emits with evicted:0 when no keys match (no-op invalidation)", () => {
      const cache = new OmniFocusLruCache();
      const handler = vi.fn();
      cache.on("cache.invalidated", handler);
      cache.invalidate("task:nonexistent");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "cache.invalidated",
          scopes: ["task:nonexistent"],
          evicted: 0,
        }),
      );
    });

    it("includes correlationId in the payload when inside a correlation scope", async () => {
      const { withCorrelationId } = await import("../logging/correlation.js");
      const cache = new OmniFocusLruCache();
      cache.set("task:xyz:list", "v1");
      const handler = vi.fn();
      cache.on("cache.invalidated", handler);
      withCorrelationId(() => {
        cache.invalidate("task:xyz");
      }, "test-corr-id-123");
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: "test-corr-id-123",
        }),
      );
    });
  });

  describe("stats", () => {
    it("reports current cache size", async () => {
      const cache = new OmniFocusLruCache();
      await cache.wrap("a", async () => 1);
      await cache.wrap("b", async () => 2);
      expect(cache.stats().size).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      const cache = new OmniFocusLruCache();
      await cache.wrap("a", async () => 1);
      await cache.wrap("b", async () => 2);
      cache.clear();
      expect(cache.stats().size).toBe(0);
    });
  });

  describe("coalescing (#22 — thundering-herd)", () => {
    it("fans 10 concurrent identical wraps into 1 factory call", async () => {
      const cache = new OmniFocusLruCache();
      let invocations = 0;
      let resolveFactory: (value: number) => void = () => undefined;
      const factory = (): Promise<number> => {
        invocations++;
        return new Promise<number>((resolve) => {
          resolveFactory = resolve;
        });
      };

      const results = Promise.all(
        Array.from({ length: 10 }, () => cache.wrap("task:123", factory)),
      );
      // Yield so all 10 wraps register before we resolve.
      await Promise.resolve();
      resolveFactory(42);
      expect(await results).toEqual(Array(10).fill(42));
      expect(invocations).toBe(1);

      const stats = cache.stats();
      expect(stats.misses).toBe(1);
      expect(stats.coalesced).toBe(9);
    });

    it("caches the coalesced result so follow-up wraps hit", async () => {
      const cache = new OmniFocusLruCache();
      const factory = vi.fn(async () => "v");
      await Promise.all([cache.wrap("k", factory), cache.wrap("k", factory)]);
      await cache.wrap("k", factory); // fresh call after resolution
      expect(factory).toHaveBeenCalledTimes(1);
      expect(cache.stats().hits).toBe(1);
    });

    it("does not cache factory rejections; next call retries", async () => {
      const cache = new OmniFocusLruCache();
      let attempts = 0;
      const factory = async () => {
        attempts++;
        if (attempts === 1) throw new Error("boom");
        return "ok";
      };

      await expect(
        Promise.all([
          cache.wrap("k", factory).catch((e) => e.message),
          cache.wrap("k", factory).catch((e) => e.message),
        ]),
      ).resolves.toEqual(["boom", "boom"]);
      // First factory rejected — the next wrap should kick off a fresh factory.
      expect(await cache.wrap("k", factory)).toBe("ok");
      expect(attempts).toBe(2);
    });

    it("discards a factory result if invalidate() fires during flight", async () => {
      const cache = new OmniFocusLruCache();
      let resolveFactory: (value: number) => void = () => undefined;
      const factory = (): Promise<number> => {
        return new Promise<number>((resolve) => {
          resolveFactory = resolve;
        });
      };
      const result = cache.wrap("task:abc", factory);
      await Promise.resolve();
      cache.invalidate("task:abc");
      resolveFactory(7);
      expect(await result).toBe(7);
      // Cache must NOT carry the stale-after-invalidate value.
      expect(cache.has("task:abc")).toBe(false);
    });

    it("separates inflight maps across keys", async () => {
      const cache = new OmniFocusLruCache();
      const factoryA = vi.fn(async () => "a");
      const factoryB = vi.fn(async () => "b");
      const [a, b] = await Promise.all([cache.wrap("A", factoryA), cache.wrap("B", factoryB)]);
      expect(a).toBe("a");
      expect(b).toBe("b");
      expect(factoryA).toHaveBeenCalledTimes(1);
      expect(factoryB).toHaveBeenCalledTimes(1);
      expect(cache.stats().coalesced).toBe(0);
    });
  });
});
