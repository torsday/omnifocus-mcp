/**
 * Tests for the plugin_invoke tool.
 *
 * Covers: schema validation, description shape, handler envelope structure,
 * and service delegation. InMemoryAdapter.pluginInvoke() throws NotFound —
 * we use a stub adapter that resolves to a fake result for happy-path tests.
 */

import { describe, expect, it } from "vitest";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { NotFound } from "../../errors/index.js";
import {
  handlePluginInvoke,
  PLUGIN_INVOKE_DESCRIPTION,
  pluginInvokeInputSchema,
} from "./invoke.js";

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

/** Stub adapter that resolves pluginInvoke with a configurable result. */
function makeStubAdapter(result: unknown): Pick<OmniFocusAdapter, "pluginInvoke"> {
  return {
    pluginInvoke: async (_input) => ({ result }),
  };
}

/** Stub adapter that rejects with NotFound (plug-in not installed). */
function makeNotFoundAdapter(): Pick<OmniFocusAdapter, "pluginInvoke"> {
  return {
    pluginInvoke: async (input) => {
      throw new NotFound(`PlugIn not found: ${input.identifier}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("plugin_invoke — input schema", () => {
  it("accepts identifier only", () => {
    const result = pluginInvokeInputSchema.safeParse({ identifier: "com.example.test" });
    expect(result.success).toBe(true);
  });

  it("accepts identifier + arg", () => {
    const result = pluginInvokeInputSchema.safeParse({
      identifier: "com.example.test",
      arg: { key: "value" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing identifier", () => {
    const result = pluginInvokeInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty identifier", () => {
    const result = pluginInvokeInputSchema.safeParse({ identifier: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Description shape
// ---------------------------------------------------------------------------

describe("plugin_invoke — description", () => {
  it("is a non-empty string", () => {
    expect(typeof PLUGIN_INVOKE_DESCRIPTION).toBe("string");
    expect(PLUGIN_INVOKE_DESCRIPTION.length).toBeGreaterThan(0);
  });

  it("mentions plugin_invoke", () => {
    expect(PLUGIN_INVOKE_DESCRIPTION.toLowerCase()).toContain("plug-in");
  });

  it("mentions NotFound for missing plug-in", () => {
    expect(PLUGIN_INVOKE_DESCRIPTION).toContain("NotFound");
  });
});

// ---------------------------------------------------------------------------
// Handler — happy path
// ---------------------------------------------------------------------------

describe("plugin_invoke — handler", () => {
  it("returns { data: { result }, meta } envelope", async () => {
    const adapter = makeStubAdapter({ status: "ok" }) as OmniFocusAdapter;
    const envelope = await handlePluginInvoke(
      { identifier: "com.example.test" },
      { adapter, makeMeta },
    );
    expect(envelope.data.result).toEqual({ status: "ok" });
    expect(envelope.meta.correlationId).toBe("test-cid");
  });

  it("forwards arg to the adapter", async () => {
    let capturedArg: unknown;
    const adapter = {
      pluginInvoke: async (input: { identifier: string; arg?: unknown }) => {
        capturedArg = input.arg;
        return { result: null };
      },
    } as unknown as OmniFocusAdapter;

    await handlePluginInvoke(
      { identifier: "com.example.test", arg: { query: "hello" } },
      { adapter, makeMeta },
    );
    expect(capturedArg).toEqual({ query: "hello" });
  });

  it("returns null result when plug-in returns nothing", async () => {
    const adapter = makeStubAdapter(null) as OmniFocusAdapter;
    const envelope = await handlePluginInvoke(
      { identifier: "com.example.test" },
      { adapter, makeMeta },
    );
    expect(envelope.data.result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler — error propagation
// ---------------------------------------------------------------------------

describe("plugin_invoke — error propagation", () => {
  it("propagates NotFound when plug-in is not installed", async () => {
    const adapter = makeNotFoundAdapter() as unknown as OmniFocusAdapter;
    await expect(
      handlePluginInvoke({ identifier: "com.missing.plugin" }, { adapter, makeMeta }),
    ).rejects.toThrow(NotFound);
  });
});
