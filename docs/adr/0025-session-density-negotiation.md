# ADR-0025: Negotiate response density once at the MCP init handshake

**Date:** 2026-06-03
**Status:** Accepted

---

## Context

The token-efficiency audit ([#770](https://github.com/torsday/omnifocus-mcp/issues/770)) flipped the per-tool response-shaping defaults to a lean baseline: `_links` are opt-in ([#792](https://github.com/torsday/omnifocus-mcp/issues/792)), `includeSubtasks` defaults false ([#796](https://github.com/torsday/omnifocus-mcp/issues/796)), `noteHtml` is dropped from read envelopes ([#791](https://github.com/torsday/omnifocus-mcp/issues/791)), and note bodies truncate at `DEFAULT_NOTE_PREVIEW_CHARS` (200).

That is the right default for most agents, but a client that genuinely wants the **rich** shape (HATEOAS links, inline subtasks, full notes) must now re-specify those flags on *every* call. There was no way to express "I want the verbose shape for this whole session" once. [#818](https://github.com/torsday/omnifocus-mcp/issues/818) asks for a single `density` preference negotiated at connect time that supplies session-wide defaults, with per-call args still overriding.

Two design questions had to be answered:

1. **Where does session state live?** MCP has no per-request session object. But [ADR-0010](0010-stdio-as-sole-transport.md) makes **stdio the sole transport**, so a server process serves exactly one client connection for its lifetime. "Per-connection state" therefore collapses to a process-level singleton — no per-request plumbing, no connection registry.
2. **How does the client signal it?** The MCP `initialize` request carries a `capabilities` object with an open `experimental` record (`Record<string, object>` in the SDK types). That is the designated extension point.

## Decision

Negotiate density at the `initialize` handshake and hold it in a process singleton.

- **Capability contract.** The client signals `capabilities.experimental.density` as one of `"compact" | "default" | "full"`. The server reads it in the SDK's `oninitialized` callback via `getClientCapabilities()` and stores it in `src/state/sessionState.ts` (alongside the existing `replayStore` process state). Anything missing or unrecognized → `"default"`.
- **Additive, not breaking.** The singleton starts at `"default"`; a client that signals nothing gets byte-for-byte the pre-#818 behavior. Despite the issue's `breaking-change` label, no existing consumer changes.
- **Profiles** (`src/state/density.ts`) resolve the read-shaping flags:
  - `default` / `compact` → `{ includeLinks: false, includeSubtasks: false, notePreviewChars: 200 }`. They **coincide**: the audit already made the lean shape the baseline, so there is no leaner-than-default tier to express without changing audited contracts. `compact` exists as an explicit, self-documenting opt-in to that baseline.
  - `full` → `{ includeLinks: true, includeSubtasks: true, notePreviewChars: -1 (no truncation) }` — the operative new lever.
- **Per-call precedence.** Each existing default site resolves `input.flag ?? sessionDefault(flag)` via the `resolve*` helpers, so an explicit argument always wins over the session default. The resolution sites are unchanged in number — the session default merely replaces the hard-coded fallback.
- **Observability.** `internal_status` reports the negotiated `density` so a caller can confirm what took effect.

## Consequences

- A client sets one capability and gets a session-wide shape; the lean default is unchanged for everyone else.
- **`noteHtml` and page `limit` are intentionally not density-tunable.** `noteHtml` has no read-path inclusion flag (it is always elided from read envelopes and fetched via `note_get_html`), and the page `limit` default is already 50 across `default`/`compact`. Wiring them would mean inventing new contracts, out of scope here. The issue's AC listed them; this ADR records why they were excluded.
- The singleton is correct **only because** stdio is the sole transport. If a future transport multiplexes connections in one process (would require revisiting ADR-0010), density must move to per-connection state. This coupling is called out so it isn't silently violated.

### Alternatives considered

- **A `density` argument on every tool** — rejected: that is the status quo the issue exists to remove.
- **An env var (`OMNIFOCUS_DENSITY`)** — rejected: density is a per-client preference negotiated at runtime, not server-operator config; the handshake is the natural place and lets different clients of the same binary differ.
- **A dedicated `set_density` tool** — rejected: adds a stateful side-effecting tool and a round-trip; the handshake already exists and is the canonical negotiation point.
- **Make `compact` strictly leaner than `default`** (e.g. drop note previews entirely) — rejected: would change an audited contract (#775) and risk hiding data the lean default deliberately keeps; deferred to a future ADR if a leaner tier is ever justified.
