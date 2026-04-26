/**
 * Tests for {@link withInvocationLogging} — the per-tool invocation event
 * middleware (#283). Goldilocks coverage: success path emits exactly one
 * `tool.invoked`, error path emits exactly one `tool.error` with the typed
 * code, and the correlationId on the event matches the surrounding scope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OmniFocusError } from "../errors/index.js";
import { withCorrelationId } from "./correlation.js";
import { withInvocationLogging } from "./withInvocationLogging.js";

interface CapturedLine {
  level: string;
  event: string;
  tool: string;
  correlationId?: string;
  durationMs: number;
  transport?: string;
  cacheHit?: boolean;
  code?: string;
}

/**
 * Capture pino output by spying on `process.stderr.write`. Filters to lines
 * carrying an `event` field so unrelated debug noise doesn't pollute the
 * assertions.
 */
function captureLogs(): { lines: CapturedLine[]; restore: () => void } {
  const lines: CapturedLine[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    const text = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf-8");
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as CapturedLine;
        if (parsed.event) lines.push(parsed);
      } catch {
        /* not a structured event line — ignore */
      }
    }
    return true;
  });
  return {
    lines,
    restore: () => {
      spy.mockRestore();
    },
  };
}

const okEnvelope = {
  data: { value: 1 },
  meta: {
    correlationId: "01J0000000000000000000TEST",
    durationMs: 0,
    cacheHit: true,
    transport: "memory" as const,
    ofVersion: "unknown",
  },
};

describe("withInvocationLogging", () => {
  let cap: { lines: CapturedLine[]; restore: () => void };

  beforeEach(() => {
    cap = captureLogs();
  });

  afterEach(() => {
    cap.restore();
  });

  it("emits exactly one tool.invoked on success with the surrounding correlationId", async () => {
    const result = await withCorrelationId(
      () =>
        withInvocationLogging("tool_x", async () => {
          // capture inside scope so we can compare to the log line
          return okEnvelope;
        }),
      "01J0000000000000000000FIXED",
    );

    expect(result).toBe(okEnvelope);

    const events = cap.lines.filter((l) => l.tool === "tool_x");
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt?.event).toBe("tool.invoked");
    expect(evt?.level).toBe("info");
    expect(evt?.transport).toBe("memory");
    expect(evt?.cacheHit).toBe(true);
    expect(typeof evt?.durationMs).toBe("number");
    expect(evt?.correlationId).toBe("01J0000000000000000000FIXED");
  });

  it("emits exactly one tool.error with the typed error code on a thrown OmniFocusError", async () => {
    const boom = new OmniFocusError("OF_VALIDATION", "bad input");

    await expect(
      withCorrelationId(
        () =>
          withInvocationLogging("tool_y", async () => {
            throw boom;
          }),
        "01J0000000000000000000ERR0",
      ),
    ).rejects.toBe(boom);

    const events = cap.lines.filter((l) => l.tool === "tool_y");
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt?.event).toBe("tool.error");
    expect(evt?.code).toBe("OF_VALIDATION");
    expect(evt?.correlationId).toBe("01J0000000000000000000ERR0");
  });

  it("falls back to code UNKNOWN on an untyped throw", async () => {
    await expect(
      withCorrelationId(() =>
        withInvocationLogging("tool_z", async () => {
          throw new Error("ouch");
        }),
      ),
    ).rejects.toThrow("ouch");

    const evt = cap.lines.find((l) => l.tool === "tool_z");
    expect(evt?.event).toBe("tool.error");
    expect(evt?.code).toBe("UNKNOWN");
  });
});
