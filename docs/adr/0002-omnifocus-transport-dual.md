# ADR-0002: Dual transport — JXA primary, OmniJS fallback — behind a single adapter

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

OmniFocus has no public network API. Programmatic access lives at three levels:

1. **JXA** (`osascript -l JavaScript`) — Scripting Bridge dictionary, synchronous, returns structured values. Stable, broad, but has gaps: custom perspective evaluation, plug-in invocation, a handful of newer settings.
2. **OmniJS via URL scheme** — Omni's strategic cross-platform API. Covers everything including custom perspectives and plug-ins. Asynchronous; return values require writing to a file the caller reads back, because URL-scheme invocations don't have a native return channel.
3. **Direct SQLite read** — undocumented, unstable, unsupported. Rejected (noted in `DESIGN.md` §1).

The project scope commits to full OF coverage (`project_scope.md`). No single transport covers the full surface cleanly.

Failing to decide now means ad-hoc reaching for whichever transport is convenient per tool, which leaks transport concerns into service code and makes testing harder.

## Decision

We will expose **one adapter interface (`OmniFocusAdapter`) with two underlying transports**: `JxaTransport` (primary) and `OmniJsTransport` (fallback). A `TransportRouter` selects the right transport per operation based on feature capability, and is itself an `OmniFocusAdapter` — services know nothing about transports.

Default routing:

- JXA for CRUD on tasks, projects, tags, folders, notes, attachments, built-in perspectives, forecast, review, search
- OmniJS for custom perspective evaluation, plug-in invocation, and any future feature Omni exposes only in OmniJS

> **Scheduling update (2026-04-19):** the user confirmed rich reliance on custom perspectives. `OmniJsTransport` is built in Milestone 0 (spike) and wired through `TransportRouter` in Milestone 2 — no longer a late-phase addition. This is a sequencing change, not a design change; the dual-transport decision stands.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| JXA only | Simplest; sync returns; fewer moving parts | Fails the full-coverage requirement; ~15% of OF unreachable |
| OmniJS only | Omni's strategic API; future-proof | Async callback dance for every call; every tool gets harder; filesystem roundtrip for every return value |
| **Dual transport with router** | Each feature routes to the transport that fits best; router is testable in isolation; services unaware | More code; two script dialects; router itself must be tested carefully |
| Dual transport, per-service selection | Services pick their transport | Transport concern leaks into services; violates layering; harder to test |

## Consequences

**Positive**

- Services depend only on `OmniFocusAdapter`; swapping or adding transports never touches service code
- Tests use `InMemoryAdapter` — no mocking of `osascript` or URL schemes
- Each script lives in its own file (`src/scripts/{jxa,omnijs}/*.js`); a future migration of any specific operation from JXA to OmniJS (or vice versa) touches exactly one script and one router entry

**Negative**

- Two script dialects to maintain (JXA syntax differs subtly from OmniJS, and they use different OmniFocus APIs)
- `OmniJsTransport` is async-with-callback-file — more fragile than JXA; needs timeouts and robust cleanup
- Router logic is additional surface to maintain as Omni ships new features

**Risks**

- **OmniJS callback hangs** if OF is wedged — mitigated by a 45s per-call timeout on `OmniJsTransport` (default; overridable via `OMNIFOCUS_OMNIJS_TIMEOUT_MS`), plus circuit breaker at the tool level
- **Silent divergence** between a feature's JXA and OmniJS implementations — mitigated by picking one transport per feature, not both
- **Omni deprecating JXA** — unlikely near-term; if it happens, each operation can be migrated to OmniJS in isolation because of the router seam

## References

- `DESIGN.md` §3, §6.3 — transport options and adapter interface
- `SPEC.md` — the functional surface that requires full coverage
- Omni Automation docs (omni-automation.com) — OmniJS reference
- OmniFocus Scripting Dictionary (accessible via Script Editor → File → Open Dictionary) — JXA reference
