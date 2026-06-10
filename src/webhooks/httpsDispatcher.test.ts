/**
 * Tests for HttpsDispatcher (slice 3 of #483).
 *
 * Uses an injected `request` so no actual network is involved. Asserts
 * the contract per ADR-0016: HMAC signing when secret is set, 1s/5s/30s
 * exponential retry, per-webhook circuit breaker (10 consecutive failures →
 * 1h auto-disable), no URL/secret leakage in stderr, never throws upward.
 */

import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type * as https from "node:https";
import { describe, expect, it, vi } from "vitest";
import type { WebhookEvent } from "./events.js";
import {
  buildHttpsRequest,
  HttpsDispatcher,
  type HttpsRequestFn,
  SIGNATURE_HEADER,
} from "./httpsDispatcher.js";
import type { Webhook } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEBHOOK_NO_SECRET: Webhook = {
  name: "no-secret",
  url: "https://example.com/hook-private",
  trigger: { on: "task-completed" },
  createdAt: "2026-01-01T00:00:00Z",
};

const WEBHOOK_WITH_SECRET: Webhook = {
  ...WEBHOOK_NO_SECRET,
  name: "with-secret",
  url: "https://example.com/hook-with-secret-private",
  secret: "super-secret-1234",
};

const sampleEvent = (over: Partial<WebhookEvent> = {}): WebhookEvent =>
  ({
    kind: "task-completed",
    webhookName: "no-secret",
    taskId: "t1",
    taskName: "test",
    projectId: "p1",
    tagIds: [],
    occurredAt: "2026-04-29T18:00:00Z",
    ...over,
  }) as WebhookEvent;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

interface DispatcherHarness {
  dispatcher: HttpsDispatcher;
  requests: CapturedRequest[];
  writes: string[];
}

function makeHarness(opts: {
  /** Sequence of responses (status codes or thrown errors) the request should return per call. */
  responses?: Array<{ statusCode: number } | { throw: string }>;
  /** Override: every call returns this response. */
  fixedResponse?: { statusCode: number };
}): DispatcherHarness {
  const requests: CapturedRequest[] = [];
  const writes: string[] = [];
  let callIdx = 0;

  const request: HttpsRequestFn = async (args) => {
    requests.push(args);
    if (opts.fixedResponse) return opts.fixedResponse;
    const r = opts.responses?.[callIdx++];
    if (r === undefined) throw new Error("no more responses configured");
    if ("throw" in r) throw new Error(r.throw);
    return { statusCode: r.statusCode };
  };

  const dispatcher = new HttpsDispatcher({
    request,
    now: () => 0,
    sleep: async () => {}, // skip real delays in tests
    write: (line) => writes.push(line),
  });
  return { dispatcher, requests, writes };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("HttpsDispatcher — successful delivery", () => {
  it("POSTs the event JSON to the registered URL and resolves on 2xx", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]?.url).toBe(WEBHOOK_NO_SECRET.url);
    const parsed = JSON.parse(h.requests[0]?.body ?? "{}");
    expect(parsed.kind).toBe("task-completed");
    expect(parsed.taskId).toBe("t1");
  });

  it("includes Content-Type: application/json", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests[0]?.headers["Content-Type"]).toBe("application/json");
  });

  it("uses a 5-second per-attempt timeout", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests[0]?.timeoutMs).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

describe("HttpsDispatcher — HMAC signing", () => {
  it("includes X-OmniFocus-Signature: sha256=<hex> when a secret is set", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(
      sampleEvent({ webhookName: "with-secret" }),
      () => WEBHOOK_WITH_SECRET,
    );
    const sig = h.requests[0]?.headers[SIGNATURE_HEADER];
    expect(sig).toBeDefined();
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("computes the HMAC over the exact body bytes", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(
      sampleEvent({ webhookName: "with-secret" }),
      () => WEBHOOK_WITH_SECRET,
    );
    const body = h.requests[0]?.body ?? "";
    const expected = createHmac("sha256", WEBHOOK_WITH_SECRET.secret as string)
      .update(body)
      .digest("hex");
    expect(h.requests[0]?.headers[SIGNATURE_HEADER]).toBe(`sha256=${expected}`);
  });

  it("does NOT include the signature header when no secret is set", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests[0]?.headers[SIGNATURE_HEADER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe("HttpsDispatcher — retry budget", () => {
  it("retries on transport failure up to 3 times (4 total attempts)", async () => {
    const h = makeHarness({
      responses: [
        { throw: "ECONNRESET" },
        { throw: "ECONNRESET" },
        { throw: "ECONNRESET" },
        { statusCode: 200 },
      ],
    });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests).toHaveLength(4);
  });

  it("retries on 5xx responses", async () => {
    const h = makeHarness({
      responses: [{ statusCode: 503 }, { statusCode: 503 }, { statusCode: 200 }],
    });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests).toHaveLength(3);
  });

  it("retries on 4xx responses (best-effort delivery, no retry-classification)", async () => {
    // Per ADR-0016 §3 the retry budget is short — we don't try to classify
    // 4xx vs 5xx; everything non-2xx retries until budget exhausted.
    const h = makeHarness({
      fixedResponse: { statusCode: 404 },
    });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests).toHaveLength(4); // 1 + 3 retries
  });

  it("stops retrying immediately on 2xx (success short-circuits)", async () => {
    const h = makeHarness({
      responses: [
        { statusCode: 200 },
        { statusCode: 999 },
        { statusCode: 999 },
        { statusCode: 999 },
      ],
    });
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe("HttpsDispatcher — circuit breaker", () => {
  it("trips after 10 consecutive failed deliveries", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 500 } });
    // Each call exhausts the retry budget (4 attempts) and counts as 1 failure.
    for (let i = 0; i < 10; i++) {
      await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    }
    const circuit = h.dispatcher.inspectCircuit(WEBHOOK_NO_SECRET.name);
    expect(circuit?.openUntil).not.toBeNull();
  });

  it("skips delivery while the circuit is open", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 500 } });
    for (let i = 0; i < 10; i++) {
      await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    }
    const callsBeforeOpen = h.requests.length;

    // While circuit is open (now=0 < openUntil=3600000), this should NOT make
    // additional requests.
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(h.requests.length).toBe(callsBeforeOpen);
  });

  it("resets the failure counter on a successful delivery", async () => {
    const h = makeHarness({
      // 3 fails (counts 3 toward circuit threshold), then 1 success → reset.
      // After success, 5 more fails = 5 failures (still under 10).
      responses: [
        ...Array(3 * 4).fill({ statusCode: 500 }), // 3 failures
        { statusCode: 200 }, // success → reset
        ...Array(5 * 4).fill({ statusCode: 500 }), // 5 more failures
      ],
    });
    for (let i = 0; i < 3; i++) await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    for (let i = 0; i < 5; i++) await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    const circuit = h.dispatcher.inspectCircuit(WEBHOOK_NO_SECRET.name);
    expect(circuit?.openUntil).toBeNull(); // not tripped — reset by the success
    expect(circuit?.consecutiveFailures).toBe(5);
  });

  it("auto-resumes after the cooldown elapses", async () => {
    const requests: CapturedRequest[] = [];
    let nowVal = 0;
    const dispatcher = new HttpsDispatcher({
      request: async (args) => {
        requests.push(args);
        return { statusCode: 500 };
      },
      now: () => nowVal,
      sleep: async () => {},
      write: () => {},
    });

    for (let i = 0; i < 10; i++) {
      await dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    }
    const requestsBeforeResume = requests.length;

    // Advance past the 1h cooldown.
    nowVal = 60 * 60 * 1000 + 1;
    await dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    expect(requests.length).toBe(requestsBeforeResume + 4); // 1 + 3 retries
  });

  it("isolates circuits per webhook (one tripping doesn't affect others)", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 500 } });
    const otherHook: Webhook = {
      ...WEBHOOK_NO_SECRET,
      name: "other",
      url: "https://other.example.com/x",
    };
    for (let i = 0; i < 10; i++) {
      await h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET);
    }
    expect(h.dispatcher.inspectCircuit(WEBHOOK_NO_SECRET.name)?.openUntil).not.toBeNull();
    expect(h.dispatcher.inspectCircuit("other")?.openUntil).toBeUndefined();

    await h.dispatcher.deliver(sampleEvent({ webhookName: "other" }), () => otherHook);
    expect(h.dispatcher.inspectCircuit("other")?.consecutiveFailures).toBe(1);
    expect(h.dispatcher.inspectCircuit("other")?.openUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failure-mode discipline (ADR-0016 §4e)
// ---------------------------------------------------------------------------

describe("HttpsDispatcher — failure-mode discipline", () => {
  it("never throws — even on transport failure that exhausts retries", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 500 } });
    await expect(
      h.dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET),
    ).resolves.toBeUndefined();
  });

  it("never throws when the registry lookup itself throws", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    const throwingLookup = () => {
      throw new Error("registry crashed");
    };
    await expect(h.dispatcher.deliver(sampleEvent(), throwingLookup)).resolves.toBeUndefined();
  });

  it("never includes the URL or secret in stderr logs", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 500 } });
    for (let i = 0; i < 11; i++) {
      await h.dispatcher.deliver(
        sampleEvent({ webhookName: "with-secret" }),
        () => WEBHOOK_WITH_SECRET,
      );
    }
    const joined = h.writes.join("\n");
    expect(joined).not.toContain("hook-with-secret-private");
    expect(joined).not.toContain("super-secret-1234");
  });

  it("logs the missing-webhook case without throwing", async () => {
    const h = makeHarness({ fixedResponse: { statusCode: 200 } });
    await h.dispatcher.deliver(sampleEvent(), () => undefined);
    expect(h.requests).toHaveLength(0);
    expect(h.writes.join("\n")).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// defaultHttpsRequest — response-stream error wiring (#761)
// ---------------------------------------------------------------------------

describe("defaultHttpsRequest — response-stream error handling", () => {
  /**
   * Build a fake `https.request` whose response stream emits `error` after
   * the request callback fires — the exact failure mode #761 closes.
   * Without `res.on("error", reject)`, this would escape as
   * `uncaughtException` rather than rejecting the dispatch promise.
   */
  function fakeHttpsRequestEmittingResError(err: Error): typeof https.request {
    return ((_opts: unknown, cb?: unknown) => {
      const fakeRes = Object.assign(new EventEmitter(), { statusCode: 200 });
      const fakeReq = Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      });
      if (typeof cb === "function") {
        queueMicrotask(() => {
          (cb as (res: unknown) => void)(fakeRes);
          // Emit one tick later so `res.on("error", reject)` is in place.
          queueMicrotask(() => fakeRes.emit("error", err));
        });
      }
      return fakeReq as unknown as ReturnType<typeof https.request>;
    }) as unknown as typeof https.request;
  }

  it("rejects when the response stream emits 'error' after the request callback fires", async () => {
    const httpsRequest = fakeHttpsRequestEmittingResError(new Error("ECONNRESET mid-body"));
    const request = buildHttpsRequest(httpsRequest);
    await expect(
      request({ url: "https://example.com/hook", body: "{}", headers: {}, timeoutMs: 1000 }),
    ).rejects.toThrow(/ECONNRESET mid-body/);
  });

  it("flows response-stream errors through HttpsDispatcher's retry path (no uncaughtException)", async () => {
    // Verify the fix composes with the retry loop: a response-stream error
    // increments consecutiveFailures exactly like a request-stream error
    // would, instead of bypassing circuit-breaker accounting.
    const httpsRequest = fakeHttpsRequestEmittingResError(new Error("peer reset"));
    const writes: string[] = [];
    const dispatcher = new HttpsDispatcher({
      request: buildHttpsRequest(httpsRequest),
      now: () => 0,
      sleep: async () => {},
      write: (line) => writes.push(line),
    });

    await expect(
      dispatcher.deliver(sampleEvent(), () => WEBHOOK_NO_SECRET),
    ).resolves.toBeUndefined();

    const circuit = dispatcher.inspectCircuit(WEBHOOK_NO_SECRET.name);
    expect(circuit?.consecutiveFailures).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildHttpsRequest — host/port decomposition
// ---------------------------------------------------------------------------

describe("buildHttpsRequest — host/port decomposition", () => {
  /**
   * Fake `https.request` that captures the options object and completes
   * with a 200 (empty body). Lets us assert the exact option shape the
   * production transport hands to Node — the seam every other test in
   * this file injects above.
   */
  function fakeCapturingHttpsRequest(captured: Array<Record<string, unknown>>) {
    return ((opts: unknown, cb?: unknown) => {
      captured.push(opts as Record<string, unknown>);
      const fakeRes = Object.assign(new EventEmitter(), { statusCode: 200 });
      const fakeReq = Object.assign(new EventEmitter(), {
        destroy: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      });
      if (typeof cb === "function") {
        queueMicrotask(() => {
          (cb as (res: unknown) => void)(fakeRes);
          queueMicrotask(() => fakeRes.emit("end"));
        });
      }
      return fakeReq as unknown as ReturnType<typeof https.request>;
    }) as unknown as typeof https.request;
  }

  it("passes hostname without the port and a numeric port for explicit-port URLs", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const request = buildHttpsRequest(fakeCapturingHttpsRequest(captured));

    await request({
      url: "https://hooks.example.com:8443/hook?x=1",
      body: "{}",
      headers: {},
      timeoutMs: 1000,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.hostname).toBe("hooks.example.com");
    expect(captured[0]?.port).toBe(8443);
    expect(captured[0]?.path).toBe("/hook?x=1");
    // The old shape passed `host: "hooks.example.com:8443"`, which Node
    // hands verbatim to DNS (getaddrinfo ENOTFOUND) — must not reappear.
    expect(captured[0]?.host).toBeUndefined();
  });

  it("defaults to port 443 when the URL has no explicit port", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const request = buildHttpsRequest(fakeCapturingHttpsRequest(captured));

    await request({
      url: "https://hooks.example.com/hook",
      body: "{}",
      headers: {},
      timeoutMs: 1000,
    });

    expect(captured[0]?.hostname).toBe("hooks.example.com");
    expect(captured[0]?.port).toBe(443);
  });

  it("strips IPv6 brackets from the hostname (mirrors Node's urlToHttpOptions)", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const request = buildHttpsRequest(fakeCapturingHttpsRequest(captured));

    await request({
      url: "https://[::1]:8443/hook",
      body: "{}",
      headers: {},
      timeoutMs: 1000,
    });

    expect(captured[0]?.hostname).toBe("::1");
    expect(captured[0]?.port).toBe(8443);
  });
});
