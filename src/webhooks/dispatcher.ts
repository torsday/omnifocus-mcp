/**
 * Webhook event dispatcher (per ADR-0016, #483 slice 2).
 *
 * **Slice 2: interface + stub.** The stub `StderrLoggingDispatcher` records
 * what a real delivery would do — useful for observability while the
 * subsystem matures, and for slice 3's tests to assert "this event would
 * have fired" without a network. Slice 3 ships `HttpsDispatcher` with
 * HMAC-SHA256 signing, 1s/5s/30s exponential retry, and the per-webhook
 * circuit breaker.
 *
 * Design constraints from ADR-0016 §4e:
 * - Delivery failures **never** throw upward — the user's OF reads must not
 *   break because a webhook receiver is misconfigured.
 * - Logs to stderr; never to OmniFocus, never to a tool response.
 * - Naming, body shape, and signing are stable across slices — slice 3
 *   swaps the implementation without touching the call site.
 */

import type { WebhookEvent } from "./events.js";
import type { Webhook } from "./types.js";

/**
 * Strategy for delivering a webhook event. Slice 2 ships the stub;
 * slice 3 ships the HTTPS implementation.
 */
export interface WebhookDispatcher {
  /**
   * Deliver one event to its registered receiver.
   *
   * Implementations MUST:
   * - Look up the webhook by `event.webhookName` from the supplied registry
   * - Resolve the URL (and optional secret) from the registry — the event
   *   itself never carries them
   * - Catch every error internally; surface failures only via stderr logs
   *
   * @returns A promise that resolves when the delivery attempt is complete
   *   (succeeded, retried-then-given-up, or the webhook was not found in
   *   the registry). Never rejects.
   */
  deliver(event: WebhookEvent, lookup: (name: string) => Webhook | undefined): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stderr-logging stub
// ---------------------------------------------------------------------------

export interface StderrLoggingDispatcherOptions {
  /** Override the writer; defaults to `process.stderr.write`. */
  write?: (line: string) => void;
}

/**
 * Stub dispatcher: logs what a real delivery would do, returns immediately.
 *
 * Used in slice 2 to validate the diff → dispatch wiring without sending
 * actual HTTP. Slice 3's tests reuse this to assert event-content correctness
 * without standing up an HTTP receiver.
 */
export class StderrLoggingDispatcher implements WebhookDispatcher {
  private readonly write: (line: string) => void;

  constructor(options: StderrLoggingDispatcherOptions = {}) {
    this.write = options.write ?? ((line) => process.stderr.write(line));
  }

  async deliver(event: WebhookEvent, lookup: (name: string) => Webhook | undefined): Promise<void> {
    const target = lookup(event.webhookName);
    if (target === undefined) {
      // The diff produced an event for a webhook that's no longer
      // registered — possible if the user deleted the webhook between
      // diff and dispatch. Log and drop; not an error.
      this.write(
        `[webhook] ${event.kind} for "${event.webhookName}" — webhook not found in registry; dropping.\n`,
      );
      return;
    }

    // Stub log only — never leak the URL or secret. ADR-0016 §4d.
    this.write(
      `[webhook] would deliver ${event.kind} → "${target.name}" (slice-2 stub; HTTPS POST lands in slice 3).\n`,
    );
  }
}
