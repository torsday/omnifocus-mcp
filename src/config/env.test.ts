import { homedir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { type Config, parseConfig, redactConfig } from "./env.js";

describe("parseConfig", () => {
  describe("defaults", () => {
    it("returns defaults when no env vars are set", () => {
      const config = parseConfig({});
      expect(config).toEqual<Config>({
        OMNIFOCUS_LOG_LEVEL: "info",
        OMNIFOCUS_INTEGRATION: false,
        OMNIFOCUS_E2E: false,
        OMNIFOCUS_E2E_USE_MEMORY: false,
        OMNIFOCUS_ALLOW_RAW_SCRIPT: false,
        OMNIFOCUS_LEGACY_TEXT_CONTENT: false,
        OMNIFOCUS_WEBHOOKS_ENABLED: false,
        OMNIFOCUS_CACHE_TTL_MS: 30000,
        OMNIFOCUS_CACHE_CAPACITY: 256,
        OMNIFOCUS_READ_CACHE_MAX_BYTES: 16777216,
        OMNIFOCUS_READ_POOL_SIZE: 2,
        OMNIFOCUS_WRITE_QUEUE_CAP: 50,
        OMNIFOCUS_JXA_TIMEOUT_MS: 30000,
        OMNIFOCUS_OMNIJS_TIMEOUT_MS: 45000,
        OMNIFOCUS_TRANSIENT_RETRY_ENABLED: true,
        OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: 100,
        OMNIFOCUS_ATTACHMENT_PATHS: [homedir()],
        OMNIFOCUS_MAX_ATTACHMENT_MB: 100,
        OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 },
        OMNIFOCUS_WAITING_TAG_NAME: "waiting",
        OMNIFOCUS_TEMPLATES_FOLDER_NAME: "Templates",
        OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE: 0,
        OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES: 51200,
        OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE: 0,
        OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS: 2000,
        OMNIFOCUS_DURATION_STATS_SAMPLE_RATE: 0,
        OMNIFOCUS_DURATION_STATS_THRESHOLD_MS: 5000,
        OMNIFOCUS_CIRCUIT_ENABLED: true,
        OMNIFOCUS_CIRCUIT_THRESHOLD: 5,
        OMNIFOCUS_CIRCUIT_RECOVERY_MS: 30000,
        OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS: 4096,
      });
    });
  });

  describe("boolean flags", () => {
    it('treats "1" as true', () => {
      const config = parseConfig({
        OMNIFOCUS_INTEGRATION: "1",
        OMNIFOCUS_E2E: "1",
        OMNIFOCUS_ALLOW_RAW_SCRIPT: "1",
      });
      expect(config.OMNIFOCUS_INTEGRATION).toBe(true);
      expect(config.OMNIFOCUS_E2E).toBe(true);
      expect(config.OMNIFOCUS_ALLOW_RAW_SCRIPT).toBe(true);
    });

    it('treats any non-"1" value as false', () => {
      const config = parseConfig({
        OMNIFOCUS_INTEGRATION: "true",
        OMNIFOCUS_E2E: "yes",
        OMNIFOCUS_ALLOW_RAW_SCRIPT: "0",
      });
      expect(config.OMNIFOCUS_INTEGRATION).toBe(false);
      expect(config.OMNIFOCUS_E2E).toBe(false);
      expect(config.OMNIFOCUS_ALLOW_RAW_SCRIPT).toBe(false);
    });
  });

  describe("numeric fields", () => {
    it("parses valid numeric strings", () => {
      const config = parseConfig({
        OMNIFOCUS_CACHE_TTL_MS: "60000",
        OMNIFOCUS_READ_POOL_SIZE: "3",
      });
      expect(config.OMNIFOCUS_CACHE_TTL_MS).toBe(60000);
      expect(config.OMNIFOCUS_READ_POOL_SIZE).toBe(3);
    });

    it("fails on non-numeric values", () => {
      const onError = vi.fn((_msg: string) => {
        throw new Error("config-error");
      });
      expect(() => parseConfig({ OMNIFOCUS_CACHE_TTL_MS: "fast" }, onError as never)).toThrow(
        "config-error",
      );
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("OMNIFOCUS_CACHE_TTL_MS"));
    });

    it("fails on zero or negative values", () => {
      const onError = vi.fn((_msg: string) => {
        throw new Error("config-error");
      });
      expect(() => parseConfig({ OMNIFOCUS_CACHE_TTL_MS: "0" }, onError as never)).toThrow(
        "config-error",
      );
    });
  });

  describe("OMNIFOCUS_LOG_LEVEL", () => {
    it("accepts valid levels", () => {
      for (const level of ["trace", "debug", "info", "warn", "error"] as const) {
        const config = parseConfig({ OMNIFOCUS_LOG_LEVEL: level });
        expect(config.OMNIFOCUS_LOG_LEVEL).toBe(level);
      }
    });

    it("fails on invalid log level", () => {
      const onError = vi.fn((_msg: string) => {
        throw new Error("config-error");
      });
      expect(() => parseConfig({ OMNIFOCUS_LOG_LEVEL: "verbose" }, onError as never)).toThrow(
        "config-error",
      );
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("OMNIFOCUS_LOG_LEVEL"));
    });
  });

  describe("OMNIFOCUS_ATTACHMENT_PATHS", () => {
    it("splits colon-separated paths", () => {
      const config = parseConfig({
        OMNIFOCUS_ATTACHMENT_PATHS: "/tmp/a:/tmp/b",
      });
      expect(config.OMNIFOCUS_ATTACHMENT_PATHS).toEqual(["/tmp/a", "/tmp/b"]);
    });

    it("filters empty segments", () => {
      const config = parseConfig({ OMNIFOCUS_ATTACHMENT_PATHS: "/tmp/a:" });
      expect(config.OMNIFOCUS_ATTACHMENT_PATHS).toEqual(["/tmp/a"]);
    });
  });

  describe("OMNIFOCUS_TOOL_RATE_LIMIT", () => {
    it("parses N/SECONDS format", () => {
      const config = parseConfig({ OMNIFOCUS_TOOL_RATE_LIMIT: "200/120" });
      expect(config.OMNIFOCUS_TOOL_RATE_LIMIT).toEqual({
        limit: 200,
        windowSeconds: 120,
      });
    });

    it("fails on invalid format", () => {
      const onError = vi.fn((_msg: string) => {
        throw new Error("config-error");
      });
      expect(() => parseConfig({ OMNIFOCUS_TOOL_RATE_LIMIT: "120rpm" }, onError as never)).toThrow(
        "config-error",
      );
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("OMNIFOCUS_TOOL_RATE_LIMIT"));
    });
  });

  describe("startup failure", () => {
    it("calls onError with a message referencing DESIGN §22", () => {
      const onError = vi.fn((_msg: string) => {
        throw new Error("config-error");
      });
      expect(() => parseConfig({ OMNIFOCUS_LOG_LEVEL: "bad" }, onError as never)).toThrow(
        "config-error",
      );
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("DESIGN §22"));
    });
  });
});

describe("redactConfig", () => {
  it("hashes attachment paths", () => {
    const config = parseConfig({
      OMNIFOCUS_ATTACHMENT_PATHS: "/Users/alice/Documents",
    });
    const redacted = redactConfig(config);
    const paths = redacted.OMNIFOCUS_ATTACHMENT_PATHS as string[];
    expect(paths).toHaveLength(1);
    // Hash is 12-char hex, not the literal path
    expect(paths[0]).toMatch(/^[0-9a-f]{12}$/);
    expect(paths[0]).not.toContain("alice");
  });

  it("passes through non-path values unchanged", () => {
    const config = parseConfig({ OMNIFOCUS_CACHE_TTL_MS: "60000" });
    const redacted = redactConfig(config);
    expect(redacted.OMNIFOCUS_CACHE_TTL_MS).toBe(60000);
    expect(redacted.OMNIFOCUS_LOG_LEVEL).toBe("info");
  });
});
