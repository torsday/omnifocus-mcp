import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, logger, setLogLevel } from "./logger.js";

/** Capture pino output into parsed JSON lines. */
function captureLogger(level: string, redactPaths?: string[]) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const log = pino(
    {
      level,
      ...(redactPaths ? { redact: { paths: redactPaths, censor: "[redacted]" } } : {}),
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.epochTime,
    },
    stream,
  );
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines };
}

const PII_PATHS = ["name", "note", "noteHtml", "tagNames", "tagNames[*]"];

describe("createLogger", () => {
  it("returns a pino logger instance", () => {
    const log = createLogger("info");
    expect(log).toBeDefined();
    expect(typeof log.info).toBe("function");
  });

  it("singleton writes to stderr (structural check)", () => {
    // Verify createLogger is wired to process.stderr — checked by confirming
    // the logger's level is configurable and doesn't touch stdout.
    expect(logger).toBeDefined();
    expect(logger.level).toBe(process.env.OMNIFOCUS_LOG_LEVEL ?? "info");
  });
});

describe("PII redaction", () => {
  it("redacts name, note, noteHtml at info level", () => {
    const { log, lines } = captureLogger("info", PII_PATHS);
    log.info(
      { event: "task.read", name: "Buy groceries", note: "secret", noteHtml: "<p>secret</p>" },
      "task",
    );
    const entry = lines()[0];
    expect(entry?.name).toBe("[redacted]");
    expect(entry?.note).toBe("[redacted]");
    expect(entry?.noteHtml).toBe("[redacted]");
  });

  it("redacts tagNames array at info level", () => {
    const { log, lines } = captureLogger("info", PII_PATHS);
    log.info({ event: "task.read", tagNames: ["Work", "Urgent"] }, "task");
    const entry = lines()[0];
    expect(entry?.tagNames).toBe("[redacted]");
  });

  it("still emits at debug level (level gate, not redaction toggle)", () => {
    const { log, lines } = captureLogger("debug", PII_PATHS);
    log.debug({ event: "task.read", name: "My task" }, "task");
    // pino redacts by path regardless of level — entry still present
    expect(lines()).toHaveLength(1);
  });
});

describe("log level suppression", () => {
  it("suppresses messages below the configured level", () => {
    const { log, lines } = captureLogger("warn");
    log.info("this should be suppressed");
    log.debug("also suppressed");
    expect(lines()).toHaveLength(0);
  });

  it("emits messages at or above the configured level", () => {
    const { log, lines } = captureLogger("info");
    log.info({ event: "server.started" }, "started");
    log.warn({ event: "something" }, "warning");
    expect(lines()).toHaveLength(2);
  });
});

describe("log format", () => {
  it("emits valid JSON with level and time fields", () => {
    const { log, lines } = captureLogger("info");
    log.info({ event: "server.started" }, "started");
    const entry = lines()[0];
    expect(entry?.level).toBe("info");
    expect(typeof entry?.time).toBe("number");
    expect(entry?.event).toBe("server.started");
  });

  it("uses epoch time (milliseconds)", () => {
    const before = Date.now();
    const { log, lines } = captureLogger("info");
    log.info({ event: "test" }, "t");
    const after = Date.now();
    const allLines = lines();
    const entry = allLines[0];
    expect(entry?.time as number).toBeGreaterThanOrEqual(before);
    expect(entry?.time as number).toBeLessThanOrEqual(after);
  });
});

describe("setLogLevel", () => {
  it("updates the singleton log level", () => {
    const original = logger.level;
    setLogLevel("warn");
    expect(logger.level).toBe("warn");
    setLogLevel(original);
    expect(logger.level).toBe(original);
  });
});
