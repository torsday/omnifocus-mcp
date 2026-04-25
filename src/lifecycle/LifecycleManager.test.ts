/**
 * Unit tests for `LifecycleManager`.
 *
 * Goldilocks coverage of the invariants that matter:
 * - Lazy: probe is not touched until `ensureOfAvailable()` is called
 * - Single-flight: concurrent callers coalesce onto one probe
 * - Cache-on-success: subsequent calls are near-free
 * - No poison-on-failure: probe errors don't taint the cache
 * - `of.detected` is emitted exactly once on first success
 * - `checkMinimumVersion` throws `FeatureRequiresOfVersion` with structured details
 * - Edition info flows through cached state unchanged
 */

import { describe, expect, it, vi } from "vitest";
import { FeatureRequiresOfVersion } from "../errors/index.js";
import {
  compareVersions,
  type LifecycleLogger,
  LifecycleManager,
  type OfAppInfo,
} from "./LifecycleManager.js";

function silentLogger(): LifecycleLogger {
  return { info: vi.fn() };
}

describe("compareVersions", () => {
  it.each([
    ["4.5.2", "4.5.2", 0],
    ["4.5", "4.5.0", 0],
    ["4.5.2", "4.6", -1],
    ["4.6", "4.5.9", 1],
    ["4.0", "3.15.2", 1],
    ["3.15", "4.0", -1],
  ] as const)("compareVersions(%s, %s) === %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe("LifecycleManager.ensureOfAvailable", () => {
  it("is lazy — probe is not called at construction", () => {
    const probe = vi.fn(async (): Promise<OfAppInfo> => ({ ofVersion: "4.5.2", ofEdition: "pro" }));
    new LifecycleManager({ probe, logger: silentLogger() });
    expect(probe).not.toHaveBeenCalled();
  });

  it("caches the probe result across subsequent calls", async () => {
    const probe = vi.fn(async (): Promise<OfAppInfo> => ({ ofVersion: "4.5.2", ofEdition: "pro" }));
    const mgr = new LifecycleManager({ probe, logger: silentLogger() });

    const first = await mgr.ensureOfAvailable();
    const second = await mgr.ensureOfAvailable();

    expect(first).toEqual({ ofVersion: "4.5.2", ofEdition: "pro" });
    expect(second).toBe(first);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent callers onto a single in-flight probe", async () => {
    let release!: (info: OfAppInfo) => void;
    const probe = vi.fn(
      (): Promise<OfAppInfo> =>
        new Promise<OfAppInfo>((r) => {
          release = r;
        }),
    );
    const mgr = new LifecycleManager({ probe, logger: silentLogger() });

    const callers = [mgr.ensureOfAvailable(), mgr.ensureOfAvailable(), mgr.ensureOfAvailable()];
    release({ ofVersion: "4.5.2", ofEdition: "pro" });
    const results = await Promise.all(callers);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ ofVersion: "4.5.2", ofEdition: "pro" });
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it("does not poison the cache when the probe rejects — next call retries", async () => {
    const probe = vi
      .fn<[], Promise<OfAppInfo>>()
      .mockRejectedValueOnce(new Error("permission prompt dismissed"))
      .mockResolvedValueOnce({ ofVersion: "4.5.2", ofEdition: "pro" });
    const mgr = new LifecycleManager({ probe, logger: silentLogger() });

    await expect(mgr.ensureOfAvailable()).rejects.toThrow("permission prompt dismissed");
    const recovered = await mgr.ensureOfAvailable();
    expect(recovered).toEqual({ ofVersion: "4.5.2", ofEdition: "pro" });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("emits `of.detected` exactly once on first success", async () => {
    const probe = vi.fn(async (): Promise<OfAppInfo> => ({ ofVersion: "4.5.2", ofEdition: "pro" }));
    const log = silentLogger();
    const mgr = new LifecycleManager({ probe, logger: log });

    await mgr.ensureOfAvailable();
    await mgr.ensureOfAvailable();
    await mgr.ensureOfAvailable();

    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { event: "of.detected", ofVersion: "4.5.2", ofEdition: "pro" },
      "of.detected",
    );
  });
});

describe("LifecycleManager.getInfo", () => {
  it("returns undefined before the first probe and cached info after", async () => {
    const probe = vi.fn(
      async (): Promise<OfAppInfo> => ({ ofVersion: "4.5.2", ofEdition: "standard" }),
    );
    const mgr = new LifecycleManager({ probe, logger: silentLogger() });

    expect(mgr.getInfo()).toBeUndefined();
    await mgr.ensureOfAvailable();
    expect(mgr.getInfo()).toEqual({ ofVersion: "4.5.2", ofEdition: "standard" });
  });
});

describe("LifecycleManager.checkMinimumVersion", () => {
  function mgrAt(version: string): LifecycleManager {
    const probe = vi.fn(async (): Promise<OfAppInfo> => ({ ofVersion: version, ofEdition: "pro" }));
    return new LifecycleManager({ probe, logger: silentLogger() });
  }

  it("resolves when the detected version exceeds the minimum", async () => {
    await expect(
      mgrAt("4.6.0").checkMinimumVersion("4.0", "perspective_evaluate"),
    ).resolves.toBeUndefined();
  });

  it("resolves when the detected version equals the minimum", async () => {
    await expect(
      mgrAt("4.0").checkMinimumVersion("4.0.0", "perspective_evaluate"),
    ).resolves.toBeUndefined();
  });

  it("throws `FeatureRequiresOfVersion` when the detected version is lower", async () => {
    const mgr = mgrAt("3.15.2");
    await expect(mgr.checkMinimumVersion("4.0", "perspective_evaluate")).rejects.toBeInstanceOf(
      FeatureRequiresOfVersion,
    );
  });

  it("surfaces detected, minimum, and feature in the error details", async () => {
    const mgr = mgrAt("3.15.2");
    const err = await mgr.checkMinimumVersion("4.0", "perspective_evaluate").catch((e) => e);
    expect(err).toBeInstanceOf(FeatureRequiresOfVersion);
    expect(err.code).toBe("OF_FEATURE_REQUIRES_VERSION");
    expect(err.details).toEqual({
      feature: "perspective_evaluate",
      minimum: "4.0",
      detected: "3.15.2",
    });
  });
});
