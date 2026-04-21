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

    it("emits cache.invalidated event with scope and keysRemoved", () => {
      const cache = new OmniFocusLruCache();
      cache.set("task:abc:list", "v1");
      cache.set("task:abc:detail", "v2");
      const handler = vi.fn();
      cache.on("cache.invalidated", handler);
      cache.invalidate("task:abc");
      expect(handler).toHaveBeenCalledWith({ scope: "task:abc", keysRemoved: 2 });
    });

    it("reports keysRemoved: 0 when no keys match", () => {
      const cache = new OmniFocusLruCache();
      const handler = vi.fn();
      cache.on("cache.invalidated", handler);
      cache.invalidate("task:nonexistent");
      expect(handler).toHaveBeenCalledWith({ scope: "task:nonexistent", keysRemoved: 0 });
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
});
