/**
 * HttpsDispatcher — outbound HTTPS POST delivery for webhooks (per
 * ADR-0016, #483 slice 3).
 *
 * Replaces the slice-2 `StderrLoggingDispatcher` with the real wire — POSTs
 * the event JSON to the registered URL, signs with HMAC-SHA256 when a
 * secret is set, retries with 1s/5s/30s exponential backoff, and trips a
 * per-webhook circuit breaker after 10 consecutive failures (auto-resume
 * after 1 hour).
 *
 * Failure-mode discipline per ADR-0016 §4e: delivery failures NEVER throw
 * upward. The user's OF reads must keep working when a receiver is
 * misconfigured. All errors are logged to stderr (without leaking the URL
 * or secret) and the event is dropped after the retry budget is exhausted.
 *
 * The HTTPS transport is injectable so unit tests run without a live
 * receiver — see `httpsDispatcher.test.ts`.
 */

import { createHmac } from "node:crypto";
import https from "node:https";
import type { WebhookDispatcher } from "./dispatcher.js";
import type { WebhookEvent } from "./events.js";
import type { Webhook } from "./types.js";

// ---------------------------------------------------------------------------
// Constants — ADR-0016 §3
// ---------------------------------------------------------------------------

/** Per-attempt HTTP timeout (ms). */
const PER_ATTEMPT_TIMEOUT_MS = 5_000;

/** Backoff schedule for retry attempts (ms). Total budget ≈ 36s. */
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;

/** Trip the circuit breaker after this many consecutive failures. */
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;

/** Auto-resume window after circuit-break (ms). */
const CIRCUIT_BREAKER_RESUME_MS = 60 * 60 * 1_000;

/** Header name for the HMAC signature. Mirrors GitHub's convention. */
export const SIGNATURE_HEADER = "X-OmniFocus-Signature";

// ---------------------------------------------------------------------------
// HTTPS request port (injectable for tests)
// ---------------------------------------------------------------------------

export interface HttpsRequestResult {
  statusCode: number;
}

/**
 * One-shot HTTPS POST. Implementations resolve with the response status
 * code on completion or reject on transport-level failure (DNS, TCP,
 * timeout, TLS). Non-2xx responses resolve normally — the dispatcher
 * inspects the status code to decide retry-vs-success.
 */
export type HttpsRequestFn = (args: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) => Promise<HttpsRequestResult>;

/**
 * Build an `HttpsRequestFn` against an injected `https.request` factory.
 *
 * Exported so unit tests can substitute a fake transport (ESM forbids
 * `vi.spyOn` on module namespace exports like `https.request`). Production
 * callers use {@link defaultHttpsRequest}, which closes over the real
 * `https.request`.
 */
export function buildHttpsRequest(httpsRequest: typeof https.request): HttpsRequestFn {
  return ({ url, body, headers, timeoutMs }) =>
    new Promise<HttpsRequestResult>((resolve, reject) => {
      const parsed = new URL(url);
      // Decompose into hostname + port. `URL.host` keeps an explicit
      // ":port" suffix, and Node's http client hands the `host` option
      // verbatim to DNS (getaddrinfo ENOTFOUND "example.com:8443") while
      // defaulting the connection to 443 — so explicit-port webhook URLs
      // would never deliver. Mirror Node's `urlToHttpOptions`: bracket-free
      // hostname for IPv6 literals, numeric port when one is present.
      const hostname = parsed.hostname.startsWith("[")
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;
      const req = httpsRequest(
        {
          method: "POST",
          hostname,
          port: parsed.port === "" ? 443 : Number(parsed.port),
          path: `${parsed.pathname}${parsed.search}`,
          headers: { "Content-Length": Buffer.byteLength(body), ...headers },
          timeout: timeoutMs,
        },
        (res) => {
          // Wire response-stream errors into the same rejection path as
          // request-stream errors. Without this listener, an `error` emitted
          // by `res` after the request callback fires (premature socket
          // close, malformed transfer-encoding, peer reset mid-body, TLS
          // error during streaming) escapes as `uncaughtException`,
          // bypassing the retry loop and circuit breaker. ADR-0016 §4e:
          // "delivery failures NEVER throw upward." Attaches before `data`
          // so the listener is in place by the time bytes arrive.
          res.on("error", reject);
          // Drain — Node won't release the socket otherwise.
          res.on("data", () => {});
          res.on("end", () => {
            resolve({ statusCode: res.statusCode ?? 0 });
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
      });
      req.write(body);
      req.end();
    });
}

/** Default implementation closing over the real `node:https` request. */
export const defaultHttpsRequest: HttpsRequestFn = buildHttpsRequest(https.request);

// ---------------------------------------------------------------------------
// Circuit breaker — per-webhook
// ---------------------------------------------------------------------------

interface CircuitState {
  consecutiveFailures: number;
  /** When non-null, deliveries are skipped until `now > openUntil`. */
  openUntil: number | null;
}

// ---------------------------------------------------------------------------
// HttpsDispatcher
// ---------------------------------------------------------------------------

export interface HttpsDispatcherOptions {
  /** Override the HTTPS transport. Defaults to `defaultHttpsRequest`. */
  request?: HttpsRequestFn;
  /** Override the clock — primarily for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Override the sleep used between retries — primarily for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the stderr writer. */
  write?: (line: string) => void;
}

export class HttpsDispatcher implements WebhookDispatcher {
  private readonly request: HttpsRequestFn;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly write: (line: string) => void;
  private readonly circuits = new Map<string, CircuitState>();

  constructor(options: HttpsDispatcherOptions = {}) {
    this.request = options.request ?? defaultHttpsRequest;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.write = options.write ?? ((line) => process.stderr.write(line));
  }

  async deliver(event: WebhookEvent, lookup: (name: string) => Webhook | undefined): Promise<void> {
    let target: Webhook | undefined;
    try {
      target = lookup(event.webhookName);
    } catch (err) {
      this.write(
        `[webhook] ${event.kind} for "${event.webhookName}" — registry lookup threw: ${truncErr(err)}; dropping.\n`,
      );
      return;
    }
    if (target === undefined) {
      // Webhook may have been deleted between diff and dispatch; not an error.
      this.write(
        `[webhook] ${event.kind} for "${event.webhookName}" — webhook not found in registry; dropping.\n`,
      );
      return;
    }

    const circuit = this.getCircuit(target.name);
    if (circuit.openUntil !== null && this.now() < circuit.openUntil) {
      this.write(
        `[webhook] ${event.kind} for "${target.name}" — circuit open (auto-resume in ${Math.ceil((circuit.openUntil - this.now()) / 1000)}s); dropping.\n`,
      );
      return;
    }
    // Circuit was open but the cooldown elapsed — clear and continue.
    if (circuit.openUntil !== null) {
      circuit.openUntil = null;
      this.write(`[webhook] circuit auto-resumed for "${target.name}".\n`);
    }

    const body = JSON.stringify(event);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "omnifocus-mcp-webhook/1",
    };
    if (target.secret !== undefined && target.secret.length > 0) {
      const sig = createHmac("sha256", target.secret).update(body).digest("hex");
      headers[SIGNATURE_HEADER] = `sha256=${sig}`;
    }

    // Total attempts = 1 initial + RETRY_DELAYS_MS.length retries.
    let lastError = "";
    let lastStatus = 0;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const { statusCode } = await this.request({
          url: target.url,
          body,
          headers,
          timeoutMs: PER_ATTEMPT_TIMEOUT_MS,
        });
        if (statusCode >= 200 && statusCode < 300) {
          // Success — reset failure counter, return.
          circuit.consecutiveFailures = 0;
          return;
        }
        lastStatus = statusCode;
        lastError = `non-2xx status ${statusCode}`;
      } catch (err) {
        lastError = truncErr(err);
      }
      // If we've used the budget, stop retrying.
      if (attempt === RETRY_DELAYS_MS.length) break;
      const delayMs = RETRY_DELAYS_MS[attempt] as number;
      await this.sleep(delayMs);
    }

    // All attempts exhausted — count as one failure for the circuit.
    circuit.consecutiveFailures++;
    const failingHard = circuit.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    if (failingHard) {
      circuit.openUntil = this.now() + CIRCUIT_BREAKER_RESUME_MS;
      this.write(
        `[webhook] ${event.kind} for "${target.name}" — failed after ${RETRY_DELAYS_MS.length + 1} attempts (last: ${lastError}). Circuit OPEN for ${CIRCUIT_BREAKER_RESUME_MS / 1000}s.\n`,
      );
      // Reset counter so the next attempt after resume starts fresh.
      circuit.consecutiveFailures = 0;
    } else {
      this.write(
        `[webhook] ${event.kind} for "${target.name}" — failed after ${RETRY_DELAYS_MS.length + 1} attempts (last: ${lastError}). ${circuit.consecutiveFailures}/${CIRCUIT_BREAKER_FAILURE_THRESHOLD} consecutive failures.\n`,
      );
    }
    // Reference for noUnused: lastStatus is captured for log readability;
    // include it explicitly so a future debug-level log can use it.
    void lastStatus;
  }

  private getCircuit(name: string): CircuitState {
    const existing = this.circuits.get(name);
    if (existing !== undefined) return existing;
    const fresh: CircuitState = { consecutiveFailures: 0, openUntil: null };
    this.circuits.set(name, fresh);
    return fresh;
  }

  /**
   * Test introspection: read the circuit state for a webhook name.
   * Production code never calls this.
   */
  inspectCircuit(name: string): Readonly<CircuitState> | undefined {
    const state = this.circuits.get(name);
    return state ? { ...state } : undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Truncate aggressively — error messages from arbitrary HTTP libraries
  // can contain URLs / payload fragments. The webhook's URL is sensitive
  // (per ADR-0016 §4d), so log only a short prefix.
  return msg.slice(0, 80);
}
