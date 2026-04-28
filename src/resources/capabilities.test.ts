/**
 * Tests for `buildCapabilities` and `registerCapabilitiesResource`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config/env.js";
import {
  buildCapabilities,
  CAPABILITIES_URI,
  registerCapabilitiesResource,
} from "./capabilities.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    OMNIFOCUS_LOG_LEVEL: "info",
    OMNIFOCUS_INTEGRATION: false,
    OMNIFOCUS_E2E: false,
    OMNIFOCUS_E2E_USE_MEMORY: false,
    OMNIFOCUS_ALLOW_RAW_SCRIPT: false,
    OMNIFOCUS_CACHE_TTL_MS: 30_000,
    OMNIFOCUS_CACHE_CAPACITY: 256,
    OMNIFOCUS_READ_POOL_SIZE: 2,
    OMNIFOCUS_WRITE_QUEUE_CAP: 50,
    OMNIFOCUS_JXA_TIMEOUT_MS: 30_000,
    OMNIFOCUS_OMNIJS_TIMEOUT_MS: 45_000,
    OMNIFOCUS_ATTACHMENT_PATHS: ["/tmp"],
    OMNIFOCUS_MAX_ATTACHMENT_MB: 100,
    OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 },
    OMNIFOCUS_WAITING_TAG_NAME: "waiting",
    OMNIFOCUS_TEMPLATES_FOLDER_NAME: "Templates",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCapabilities
// ---------------------------------------------------------------------------

describe("buildCapabilities", () => {
  it("defaults ofVersion to 'unknown' and ofEdition to 'standard'", () => {
    const caps = buildCapabilities(makeConfig());
    expect(caps.ofVersion).toBe("unknown");
    expect(caps.ofEdition).toBe("standard");
  });

  it("accepts ofVersion / ofEdition overrides", () => {
    const caps = buildCapabilities(makeConfig(), { ofVersion: "4.2.1", ofEdition: "pro" });
    expect(caps.ofVersion).toBe("4.2.1");
    expect(caps.ofEdition).toBe("pro");
  });

  it("exposes jxa timeout from config", () => {
    const caps = buildCapabilities(makeConfig({ OMNIFOCUS_JXA_TIMEOUT_MS: 15_000 }));
    expect(caps.transports.jxa.timeoutMs).toBe(15_000);
    expect(caps.transports.jxa.available).toBe(true);
  });

  it("exposes omnijs timeout from config", () => {
    const caps = buildCapabilities(makeConfig({ OMNIFOCUS_OMNIJS_TIMEOUT_MS: 60_000 }));
    expect(caps.transports.omnijs.timeoutMs).toBe(60_000);
    expect(caps.transports.omnijs.available).toBe(true);
  });

  it("all Pro features are false for standard edition", () => {
    const caps = buildCapabilities(makeConfig());
    expect(caps.features.customPerspectives).toBe(false);
    expect(caps.features.forecastTag).toBe(false);
    expect(caps.features.repetitionRules).toBe(false);
    expect(caps.features.pluginInvocation).toBe(false);
  });

  it("all Pro features are true when ofEdition=pro", () => {
    const caps = buildCapabilities(makeConfig(), { ofEdition: "pro" });
    expect(caps.features.customPerspectives).toBe(true);
    expect(caps.features.forecastTag).toBe(true);
    expect(caps.features.repetitionRules).toBe(true);
    expect(caps.features.pluginInvocation).toBe(true);
  });

  it("rawScriptTools reflects OMNIFOCUS_ALLOW_RAW_SCRIPT", () => {
    expect(
      buildCapabilities(makeConfig({ OMNIFOCUS_ALLOW_RAW_SCRIPT: false })).features.rawScriptTools,
    ).toBe(false);
    expect(
      buildCapabilities(makeConfig({ OMNIFOCUS_ALLOW_RAW_SCRIPT: true })).features.rawScriptTools,
    ).toBe(true);
  });

  it("computes defaultPerToolPerMinute from rate limit config", () => {
    // 120 calls / 60 seconds = 120 per minute
    const caps = buildCapabilities(
      makeConfig({ OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 } }),
    );
    expect(caps.rateLimits.defaultPerToolPerMinute).toBe(120);
  });

  it("computes perMinute correctly for non-60s windows", () => {
    // 60 calls / 30 seconds = 120 per minute
    const caps = buildCapabilities(
      makeConfig({ OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 60, windowSeconds: 30 } }),
    );
    expect(caps.rateLimits.defaultPerToolPerMinute).toBe(120);
  });

  it("sets idempotencyTtlMs to 86_400_000 (24h)", () => {
    const caps = buildCapabilities(makeConfig());
    expect(caps.idempotencyTtlMs).toBe(86_400_000);
  });
});

// ---------------------------------------------------------------------------
// CAPABILITIES_URI
// ---------------------------------------------------------------------------

describe("CAPABILITIES_URI", () => {
  it("is the expected omnifocus URI", () => {
    expect(CAPABILITIES_URI).toBe("omnifocus://capabilities");
  });
});

// ---------------------------------------------------------------------------
// registerCapabilitiesResource
// ---------------------------------------------------------------------------

describe("registerCapabilitiesResource", () => {
  it("calls server.registerResource with the correct name and URI", () => {
    const server = { registerResource: vi.fn() } as unknown as McpServer;
    const getCapabilities = () => buildCapabilities(makeConfig());
    registerCapabilitiesResource(server, getCapabilities);
    expect(server.registerResource).toHaveBeenCalledWith(
      "omnifocus-capabilities",
      CAPABILITIES_URI,
      expect.objectContaining({ mimeType: "application/json" }),
      expect.any(Function),
    );
  });

  it("resource handler returns valid JSON with correct URI", async () => {
    let capturedCallback: ((uri: URL) => Promise<unknown>) | undefined;
    const server = {
      registerResource: (
        _name: string,
        _uri: string,
        _meta: unknown,
        cb: (uri: URL) => Promise<unknown>,
      ) => {
        capturedCallback = cb;
      },
    } as unknown as McpServer;

    const caps = buildCapabilities(makeConfig({ OMNIFOCUS_JXA_TIMEOUT_MS: 12_000 }));
    registerCapabilitiesResource(server, () => caps);

    const result = await capturedCallback?.(new URL(CAPABILITIES_URI));
    expect(result).toHaveProperty("contents");
    const contents = (
      result as { contents: Array<{ uri: string; mimeType: string; text: string }> }
    ).contents;
    expect(contents).toHaveLength(1);
    const first = contents[0] as { uri: string; mimeType: string; text: string };
    expect(first.uri).toBe(CAPABILITIES_URI);
    expect(first.mimeType).toBe("application/json");
    const parsed = JSON.parse(first.text) as { transports: { jxa: { timeoutMs: number } } };
    expect(parsed.transports.jxa.timeoutMs).toBe(12_000);
  });
});
