/**
 * Tests for the app_launch tool.
 *
 * Covers: schema, description shape, handler when OF not running (launched),
 * handler when OF already running (idempotent), envelope structure.
 */

import { describe, expect, it } from "vitest";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { APP_LAUNCH_DESCRIPTION, appLaunchInputSchema, handleAppLaunch } from "./launch.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  };
}

function makeAdapter(launched: boolean, alreadyRunning: boolean): OmniFocusAdapter {
  return {
    appLaunch: async () => ({ launched, alreadyRunning }),
  } as unknown as OmniFocusAdapter;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("app_launch — input schema", () => {
  it("accepts an empty object", () => {
    expect(appLaunchInputSchema.parse({})).toEqual({});
  });

  it("ignores unknown fields (strict: false by default)", () => {
    // Zod objects strip unknown keys by default
    const result = appLaunchInputSchema.safeParse({ unknown: "ignored" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Description shape
// ---------------------------------------------------------------------------

describe("app_launch — description", () => {
  it("is a non-empty string", () => {
    expect(typeof APP_LAUNCH_DESCRIPTION).toBe("string");
    expect(APP_LAUNCH_DESCRIPTION.length).toBeGreaterThan(0);
  });

  it("mentions Do NOT (when-not clause)", () => {
    expect(APP_LAUNCH_DESCRIPTION).toContain("Do NOT");
  });

  it("mentions idempotent / already running", () => {
    expect(APP_LAUNCH_DESCRIPTION.toLowerCase()).toContain("idempotent");
  });
});

// ---------------------------------------------------------------------------
// Handler — OmniFocus was not running
// ---------------------------------------------------------------------------

describe("app_launch — handler (launched)", () => {
  it("returns launched=true when OF was not running", async () => {
    const adapter = makeAdapter(true, false);
    const envelope = await handleAppLaunch({}, { adapter, makeMeta });
    expect(envelope.data.launched).toBe(true);
    expect(envelope.data.alreadyRunning).toBe(false);
  });

  it("returns well-formed envelope meta", async () => {
    const adapter = makeAdapter(true, false);
    const envelope = await handleAppLaunch({}, { adapter, makeMeta });
    expect(envelope.meta.correlationId).toBe("test-cid");
    expect(typeof envelope.meta.durationMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Handler — OmniFocus already running (idempotent)
// ---------------------------------------------------------------------------

describe("app_launch — handler (already running)", () => {
  it("returns alreadyRunning=true when OF is already open", async () => {
    const adapter = makeAdapter(false, true);
    const envelope = await handleAppLaunch({}, { adapter, makeMeta });
    expect(envelope.data.launched).toBe(false);
    expect(envelope.data.alreadyRunning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InMemoryAdapter behaviour
// ---------------------------------------------------------------------------

describe("app_launch — InMemoryAdapter", () => {
  it("returns alreadyRunning=true (no OS process in test environment)", async () => {
    const { InMemoryAdapter } = await import("../../adapter/inMemory/InMemoryAdapter.js");
    const adapter = new InMemoryAdapter();
    const result = await adapter.appLaunch();
    expect(result.alreadyRunning).toBe(true);
    expect(result.launched).toBe(false);
  });
});
