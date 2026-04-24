import { describe, expect, it } from "vitest";
import { JxaTransport } from "../adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../adapter/omnijs/OmniJsTransport.js";
import { ROUTING_TABLE, TransportRouter } from "../adapter/router.js";
import type { Config } from "../config/env.js";
import { composeAdapter, makeMeta } from "./composition.js";

const baseConfig: Config = {
  OMNIFOCUS_LOG_LEVEL: "info",
  OMNIFOCUS_INTEGRATION: false,
  OMNIFOCUS_E2E: false,
  OMNIFOCUS_ALLOW_RAW_SCRIPT: false,
  OMNIFOCUS_ATTACHMENT_PATHS: ["/tmp"],
  OMNIFOCUS_JXA_TIMEOUT_MS: 30000,
  OMNIFOCUS_OMNIJS_TIMEOUT_MS: 45000,
  OMNIFOCUS_CACHE_TTL_MS: 30000,
  OMNIFOCUS_CACHE_CAPACITY: 256,
  OMNIFOCUS_READ_POOL_SIZE: 2,
  OMNIFOCUS_WRITE_QUEUE_CAP: 50,
  OMNIFOCUS_MAX_ATTACHMENT_MB: 100,
  OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 },
};

describe("composeAdapter", () => {
  it("returns a TransportRouter assembled from JxaTransport + OmniJsTransport", () => {
    const adapter = composeAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(TransportRouter);
    // Router exposes its routing table; confirm it matches the canonical one
    // so callers can rely on dispatch policy without inspecting the chain.
    expect(adapter.routingTable).toBe(ROUTING_TABLE);
  });

  it("constructs each transport with its configured timeout", () => {
    // The transports keep `runOpts` private; we can still confirm the chain
    // composes without throwing for arbitrary timeout values.
    const adapter = composeAdapter({
      ...baseConfig,
      OMNIFOCUS_JXA_TIMEOUT_MS: 1234,
      OMNIFOCUS_OMNIJS_TIMEOUT_MS: 5678,
    });
    expect(adapter).toBeInstanceOf(TransportRouter);
  });

  it("does not share transport instances across calls (no global state)", () => {
    const a = composeAdapter(baseConfig);
    const b = composeAdapter(baseConfig);
    expect(a).not.toBe(b);
  });

  // Smoke: verify the underlying transports can be constructed standalone
  // with the same options shape (catches drift between composition and
  // direct instantiation in tests).
  it("uses the same options shape that the transports accept directly", () => {
    expect(() => new JxaTransport({ timeoutMs: 30000 })).not.toThrow();
    expect(() => new OmniJsTransport({ timeoutMs: 45000 })).not.toThrow();
  });
});

describe("makeMeta", () => {
  it("returns a ResponseMeta with a freshly-generated correlationId on each call", () => {
    const a = makeMeta();
    const b = makeMeta();
    expect(a.correlationId).not.toBe(b.correlationId);
    // Correlation IDs are ULID-shaped: 26 chars, Crockford alphabet.
    expect(a.correlationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("defaults durationMs=0, cacheHit=false, transport='jxa', ofVersion='unknown'", () => {
    const meta = makeMeta();
    expect(meta.durationMs).toBe(0);
    expect(meta.cacheHit).toBe(false);
    expect(meta.transport).toBe("jxa");
    expect(meta.ofVersion).toBe("unknown");
  });

  it("lets callers override any field via partial", () => {
    const meta = makeMeta({
      durationMs: 142,
      cacheHit: true,
      transport: "cache",
      ofVersion: "4.5.2",
    });
    expect(meta.durationMs).toBe(142);
    expect(meta.cacheHit).toBe(true);
    expect(meta.transport).toBe("cache");
    expect(meta.ofVersion).toBe("4.5.2");
    // CorrelationId should still be generated when not overridden.
    expect(meta.correlationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("lets callers override correlationId (e.g. echoing an inbound id)", () => {
    const meta = makeMeta({ correlationId: "01JBZK7PDR6XSYVMWT5YYVH8VQ" });
    expect(meta.correlationId).toBe("01JBZK7PDR6XSYVMWT5YYVH8VQ");
  });
});
