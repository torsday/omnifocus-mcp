/**
 * Server composition primitives — the seam where individual primitives
 * (transports, router, response-meta defaults) are wired into the runtime
 * shape that `startServer` consumes.
 *
 * Splitting this out of `mcpServer.ts` keeps the bootstrap file readable
 * once #289 (49 tool registrations) and #290 (10 resource registrations)
 * land — both call into the factories defined here so they don't re-do the
 * adapter chain plumbing.
 *
 * Cache wrapping (#22) and service composition (`TaskService`, etc. for #289)
 * arrive in follow-ups and will likely also live in this file.
 *
 * @see DESIGN.md §17 — lifecycle
 * @see ADR-0002 — JXA + OmniJS dual transport
 * @see ADR-0009 — read pool + write queue + OmniJS queue
 */

import { JxaTransport } from "../adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../adapter/router.js";
import type { Config } from "../config/env.js";
import type { ResponseMeta, Transport } from "../envelope/index.js";
import { generateCorrelationId } from "../logging/correlation.js";

// ---------------------------------------------------------------------------
// Adapter chain
// ---------------------------------------------------------------------------

/**
 * Compose the live `OmniFocusAdapter` chain from the validated runtime
 * config.
 *
 * Wires `JxaTransport` and `OmniJsTransport` with their per-transport
 * timeouts (`OMNIFOCUS_JXA_TIMEOUT_MS` / `OMNIFOCUS_OMNIJS_TIMEOUT_MS`) and
 * fronts them with `TransportRouter`, which dispatches each method to the
 * transport chosen by `ROUTING_TABLE` (ADR-0002).
 *
 * Cache wrapping is intentionally out of scope here — `OmniFocusLruCache`
 * (ADR-0006) wraps the returned adapter in a separate composition step so
 * tests can exercise the raw transport chain without the LRU layer.
 */
export function composeAdapter(config: Config): TransportRouter {
  const jxa = new JxaTransport({ timeoutMs: config.OMNIFOCUS_JXA_TIMEOUT_MS });
  const omnijs = new OmniJsTransport({ timeoutMs: config.OMNIFOCUS_OMNIJS_TIMEOUT_MS });
  return TransportRouter.fromTransports(jxa, omnijs);
}

// ---------------------------------------------------------------------------
// Response-meta factory
// ---------------------------------------------------------------------------

/** Default values for fields that callers haven't yet measured. */
const DEFAULT_TRANSPORT: Transport = "jxa";
const DEFAULT_OF_VERSION = "unknown";

/**
 * Build a `ResponseMeta` with a fresh correlationId and conservative
 * defaults for fields the caller hasn't measured yet.
 *
 * Tools wrap their handler bodies with timing and transport observation
 * (#283) and pass measured values via `partial`; the defaults here are the
 * shape every tool should fall back to before that wrap lands.
 *
 * `ofVersion` stays `"unknown"` until the lazy OF probe (#36) populates a
 * shared cell that subsequent calls read from.
 */
export function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: generateCorrelationId(),
    durationMs: 0,
    cacheHit: false,
    transport: DEFAULT_TRANSPORT,
    ofVersion: DEFAULT_OF_VERSION,
    ...partial,
  };
}
