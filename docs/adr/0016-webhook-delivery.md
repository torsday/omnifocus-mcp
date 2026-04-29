# ADR-0016: Webhook delivery for OmniFocus state changes

**Date:** 2026-04-29
**Status:** Accepted

---

## Context

Users want OmniFocus state changes to fan out into the rest of their automation stack — Slack post when a billing task completes, n8n trigger when a project status flips, simple HTTPS POST to a personal endpoint. Today this requires a separate polling client that re-implements the OF surface; baking webhook delivery into this MCP server turns OF into a producer in the user's broader automation graph with a small, testable surface. [#483](https://github.com/torsday/omnifocus-mcp/issues/483) tracks the implementation; this ADR locks the architecture before code so the implementation slices don't re-litigate the basics.

The decision is non-obvious along four axes:

1. **Trigger source.** Mutation observation via OmniJS (if it exists in the dictionary) vs. polling-on-snapshot (compare diffs at the existing 30-second cache refresh) vs. an explicit timer. Each has a different cost in correctness, complexity, and event lag.
2. **Persistence.** Where do webhook registrations live? In-process memory (lost on restart), a JSON config file (simple, durable), the OF library as sidecar metadata (round-trips with the user's database), or a SQLite store (overkill).
3. **Retry policy.** Network failures, server-side 5xxs, and transient receiver outages need to be tolerated without spamming the receiver or losing events. The retry budget, backoff pattern, and circuit-breaker behaviour all need to be specified up front.
4. **Security model.** Outbound HTTPS to user-supplied URLs is a meaningful surface — credential leakage, signature forgery, MITM via accidental http://, and accidental URL exposure via the capabilities resource all need to be designed against. Defaults must be safe.

If no decision is made: each #483 implementation PR re-argues these basics, the result drifts in scope, and the user gets a half-baked surface that's hard to harden after the fact. Webhooks are an asymmetric trust mechanism (the server makes outbound calls on the user's behalf), so the security defaults need to be stated explicitly, not assumed.

This ADR is design-only. The implementation lands across [#483](https://github.com/torsday/omnifocus-mcp/issues/483).

## Decision

We adopt **polling-on-cache-refresh** as the trigger mechanism, **a JSON config file** as persistence, **exponential backoff with a per-webhook circuit breaker** as retry policy, and **HMAC-SHA256 signatures + HTTPS-only + env-gated registration + redacted capability surface** as the security model. The subsystem is **off by default** behind the `OMNIFOCUS_WEBHOOKS_ENABLED` env flag, mirroring the existing `OMNIFOCUS_ALLOW_RAW_SCRIPT` discipline.

Each axis is detailed below.

### 1. Trigger source: polling-on-cache-refresh

Webhook delivery rides on the existing 30-second LRU read cache (ADR-0006). Every time a cache scope expires and the next read repopulates it, the webhook subsystem diffs the new snapshot against the previous one and emits events for each registered trigger that matches a diff entry. There is **no new timer**, no poll loop, and no observer registered against OmniJS internals.

Rejected alternatives:

- **OmniJS mutation observation**. The OmniFocus Automation API exposes `Database.observeStateChange` (and similar) but these are undocumented for cross-process subscribers and not stable across OmniFocus point releases. JXA does not expose them at all. Building the webhook surface on undocumented observers couples the feature's reliability to an API we can't pin.
- **Independent timer**. Adding a second timer means coordinating two refresh schedules, double-reading the database, and inventing a new "what did I see last time" snapshot — exactly the state the cache already maintains.

Consequence: webhook delivery has a **lag bound by cache TTL** (30s). For users who want sub-second fan-out, that's the wrong tool — they should run a dedicated automation observer outside this server. For the GTD-style "Slack me when this billing task completes" use case, 30 seconds is well below human-perceptible latency and matches the cadence the rest of the surface already uses.

> **Implementation note (added with #668).** The hook lives at `makeDatabaseChangeHandler` in [`src/server/composition.ts`](../../src/server/composition.ts), not at the LRU cache's `wrap()` callback. The handler runs on every `DatabaseWatcher` event — i.e. every time OF reports a real state change to the Swift sidecar — so each fired observation corresponds to a genuine OF mutation rather than an arbitrary cache miss. The handler asks the orchestrator `shouldObserve()` first; if no webhook is registered, it skips the snapshot fetch entirely (zero overhead for the default case). Failure-mode discipline (§4e) is enforced at this seam: snapshot-fetch and observe errors are caught and logged, never propagate into the read path.

### 2. Persistence: JSON config file at platform-standard path

Webhook registrations persist to `~/Library/Application Support/omnifocus-mcp/webhooks.json` on macOS (the only supported runtime per `package.json`'s `os: ["darwin"]`). File mode `0600` — read/write owner only. Schema versioned with a top-level `version: 1` field for forward compatibility.

```jsonc
{
  "version": 1,
  "webhooks": [
    {
      "name": "slack-billing",                          // user-supplied, unique
      "url": "https://hooks.slack.com/services/...",    // HTTPS only
      "trigger": { "on": "task-completed", "filter": { "tagId": "tag_xyz" } },
      "secret": "...",                                   // optional; HMAC seed
      "createdAt": "2026-04-29T10:00:00Z"
    }
  ]
}
```

Rejected alternatives:

- **In-process memory only.** Loses every registration on restart. Forces re-registration via tools every session — friction for a feature whose value is "set and forget."
- **OF library sidecar metadata.** Embedding webhook config as fenced YAML in a special task or project couples the user's data to server-internal state; restoring an OF backup would clobber webhook config and vice versa.
- **SQLite or LevelDB.** Too heavyweight for a flat list of <50 entries (typical user has 1-5). The whole point of the JSON file is human-greppable, restorable, and obviously inspectable.

The single config file is read on subsystem init, watched via `fs.watch` for hot-reload (so `webhook_register` mutations don't require a restart), and the in-memory copy is the source of truth between reloads. Conflicting concurrent writes are protected via the existing `WriteQueue`.

### 3. Retry policy: 1s/5s/30s exponential, circuit-break at 10 consecutive failures

Each delivery attempt has a 5-second HTTP timeout. On any non-2xx response or network error:

- **Retry 1** at 1s
- **Retry 2** at 5s
- **Retry 3** at 30s
- After the third failure, log to stderr (with the response code, body excerpt, and webhook name — never the URL or the secret) and **drop the event**. No persistent dead-letter queue: webhooks are best-effort; replay is the user's responsibility.

A **per-webhook circuit breaker** trips after **10 consecutive failures** across any combination of events: the webhook is auto-disabled for **1 hour**, with an stderr log on disable and another on auto-resume. Disabled webhooks remain in the config file (audit trail) but skip delivery until the cooldown elapses or the user re-enables explicitly via a tool. This protects the user's downstream from a misconfigured URL becoming a denial-of-service against the receiver.

The retry budget is intentionally short. Webhooks are signal-class messages (notifications, automation triggers), not record-class (billing, audit). When in doubt, the user's automation tooling should re-derive state from the OF resources rather than depend on every webhook being delivered.

Rejected alternatives:

- **Unbounded retries.** Spams a misconfigured receiver indefinitely; turns one bad URL into a permanent stderr noise tap.
- **Exactly-once delivery.** Requires a persistent dead-letter store and idempotency keys on every event. Out of scope for v1; the receiver should treat all webhook payloads as at-least-once and dedupe by event timestamp.
- **Linear backoff or fixed interval.** Doesn't give a struggling receiver enough recovery room; 1s/5s/30s gives ~36-second total budget that's fast enough for real outages and slow enough to not pile on.

### 4. Security model

Defaults are restrictive. Every loosening is opt-in.

#### 4a. Off by default — opt-in via `OMNIFOCUS_WEBHOOKS_ENABLED=1`

The webhook subsystem **does not initialize** when `OMNIFOCUS_WEBHOOKS_ENABLED` is unset or any value other than `1`. The `webhook_register` tool itself returns `ValidationError` when the flag is unset — the user can't accidentally register a webhook by typo. This mirrors the existing `OMNIFOCUS_ALLOW_RAW_SCRIPT` discipline (per ADR-0004): an outbound capability that costs the user a TCC-equivalent trust grant must be explicitly turned on.

The flag is documented in CONTRIBUTING.md and surfaced on the `omnifocus://capabilities` resource as `webhooks: { enabled: boolean, count: number }`.

#### 4b. HTTPS only

URLs starting with `http://` are rejected at registration time with `ValidationError` keyed on `field: "url"`. No silent downgrade, no "warning + accept" — the user must use HTTPS. Self-signed certs are accepted (Node's default TLS behaviour), so internal automation hosts work without ceremony, but the channel is encrypted.

#### 4c. HMAC-SHA256 signatures, optional secret

Every delivery includes an `X-OmniFocus-Signature: sha256=<hex>` header computed over the JSON body using the registration's `secret`. The header is **always** present when a secret is registered; receivers with no secret expectation can ignore it. The scheme and header name mirror GitHub's webhook signature convention so existing receivers (n8n, Zapier, custom) work without translation.

Secrets are stored in the config file (mode 0600). They are **never** echoed back through any tool response, never logged, never included in the capability resource. The `webhook_list` tool returns `secretSet: boolean` — the receiver can verify the secret exists without being able to read it.

#### 4d. Capability surface — counts and names only

`omnifocus://capabilities` reports:

```jsonc
{
  "webhooks": {
    "enabled": true,
    "count": 3,
    "names": ["slack-billing", "n8n-project-status", "homeassistant-flagged"]
  }
}
```

URLs are **never** surfaced. Secrets are **never** surfaced. The names exist so a debugging agent can correlate stderr logs with registrations; everything else stays disk-only.

#### 4e. Failure-mode discipline

Webhook delivery failures **never** throw upward into the OF read path. A misconfigured receiver, a network outage, or a circuit-broken webhook is logged to stderr and silently dropped from that scope's diff. The user's reads keep working. This is the inverse of the OF transport's behaviour (where failures throw) — webhooks are signal class, OF reads are record class, and the failure-mode contracts must reflect that.

## Consequences

- **Implementation can proceed in #483.** The four architecture axes are locked. The implementation slices hang off existing infrastructure (cache refresh hook, WriteQueue, capability resource, env-gating pattern) rather than introducing a new core subsystem.
- **30-second event lag is a known property.** Users who need sub-second fan-out cannot use this — and the docs should call that out explicitly.
- **No persistent dead-letter queue.** Receivers must treat events as at-least-once and re-derive when in doubt. The implementation issue's CHANGELOG entry needs to mention this so the user-facing contract is clear.
- **Best-effort delivery has a security floor.** HTTPS only, HMAC by default when secret set, off by default, redacted capability surface. The user can register a misconfigured URL but cannot accidentally leak a credential or downgrade to plaintext.
- **No webhook delivery in tests.** The integration test in #483 stands up a local HTTP receiver (per AC); unit tests stub the delivery transport. The actual fan-out logic is testable end-to-end without hitting the live network.
- **`OMNIFOCUS_WEBHOOKS_ENABLED` joins the existing env-flag family.** `ALLOW_RAW_SCRIPT`, `INTEGRATION`, `PERF`, `E2E` — webhook gating is the fifth flag. Document them as a coherent family in CONTRIBUTING.md.

## References

- [#483](https://github.com/torsday/omnifocus-mcp/issues/483) — implementation
- [#662](https://github.com/torsday/omnifocus-mcp/issues/662) — this ADR slice
- [ADR-0004](./0004-raw-script-escape-hatch.md) — env-gated escape-hatch pattern this mirrors
- [ADR-0006](./0006-read-cache-strategy.md) — 30-second LRU cache the trigger source rides on
- [ADR-0009](./0009-concurrency-pool-and-queue.md) — WriteQueue used to serialize config-file mutations
- [ADR-0013](./0013-tool-response-envelope.md) — typed-error shape that webhook tools return on misconfiguration
- [GitHub webhook signature documentation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) — convention this ADR mirrors for header name and HMAC scheme
