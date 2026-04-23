# ADR-0002: Dual transport — JXA primary, OmniJS fallback — behind a single adapter

**Date:** 2026-04-19
**Status:** Accepted — amended 2026-04-21 (OmniJS invocation method superseded; see amendment below)

---

## Context

OmniFocus has no public network API. Programmatic access lives at three levels:

1. **JXA** (`osascript -l JavaScript`) — Scripting Bridge dictionary, synchronous, returns structured values. Stable, broad, but has gaps: custom perspective evaluation, plug-in invocation, a handful of newer settings.
2. **OmniJS via `evaluateJavascript` bridge** — `Application("OmniFocus").evaluateJavascript(script)` called from `osascript -l JavaScript`. Omni's strategic cross-platform API via JXA. Synchronous, no dialogs, full return value. *(See amendment below — the URL-scheme path originally listed here was invalidated by spike #125.)*
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
| OmniJS only | Omni's strategic API; future-proof | Async callback dance for every call (URL scheme); `evaluateJavascript` is synchronous but JXA-side overhead still adds ~130ms |
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

- **OmniJS hangs** if OF is wedged — mitigated by a 45s per-call timeout on `OmniJsTransport` (default; overridable via `OMNIFOCUS_OMNIJS_TIMEOUT_MS`), plus circuit breaker at the tool level; `evaluateJavascript` propagates errors synchronously so polling-timeout risk is eliminated
- **Silent divergence** between a feature's JXA and OmniJS implementations — mitigated by picking one transport per feature, not both
- **Omni deprecating JXA** — unlikely near-term; if it happens, each operation can be migrated to OmniJS in isolation because of the router seam

## References

- `DESIGN.md` §3, §6.3 — transport options and adapter interface
- `SPEC.md` — the functional surface that requires full coverage
- Omni Automation docs (omni-automation.com) — OmniJS reference
- OmniFocus Scripting Dictionary (accessible via Script Editor → File → Open Dictionary) — JXA reference

---

## Amendment — 2026-04-21: OmniJS invocation via `evaluateJavascript`, not URL scheme

**Spike issues:** [#2](https://github.com/torsday/omnifocus-mcp/issues/2), [#125](https://github.com/torsday/omnifocus-mcp/issues/125)
**Spike doc:** `docs/spikes/2026-04-omnijs-spike.md`

The original design described OmniJS invocation via the `omnifocus://localhost/omnijs-run?script=...` URL scheme. Spike investigation invalidated this path:

| Problem | Impact |
|---------|--------|
| Security dialog on every call | Blocks unattended MCP server use |
| OmniFocus 4 sandbox | File writes to `/tmp`, `~/Downloads`, `~/Documents` silently blocked |
| No network access | `fetch()` blocked inside OmniJS scripts |
| URL encoding subtleties | `encodeURIComponent` insufficient; IIFE syntax breaks OF's URL parser |
| Slow result retrieval | Only viable pattern: sentinel inbox task polled via JXA; p50 ≈ 3–5s, outliers 60s+ |

**Adopted instead:** `Application("OmniFocus").evaluateJavascript(script)` called via `osascript -l JavaScript`.

```typescript
const { stdout } = await execFileAsync("osascript", [
  "-l", "JavaScript",
  "-e", `Application("OmniFocus").evaluateJavascript(${JSON.stringify(script)})`,
]);
const result = JSON.parse(stdout.trim());
```

**Properties of this approach:**
- No security dialogs — uses the macOS Automation channel already granted to `osascript`
- Synchronous return value — no polling, no sentinel tasks
- p50 ~130ms (ping), ~500ms (780 tasks), ~191ms (321KB payload)
- Errors propagate as non-zero exit + stderr
- Concurrent calls serialise on OF's JXA thread; both complete

**API shape delta** (OmniJS inside `evaluateJavascript` vs URL-scheme OmniJS):
- `flattenedTasks` and `flattenedProjects` are **properties** (array-like), not function calls
- `inbox.tasks` is `undefined` — use `new Task(name)` to add to inbox
- `setTimeout`/`setInterval` not available

**Rule for all future OmniJS scripts:** use `evaluateJavascript` exclusively. The URL-scheme path is permanently dropped. Any open issue referencing the URL-scheme OmniJS transport should be re-read against this amendment before implementation begins.

---

## Amendment — 2026-04-23: OmniJS is escape-hatch-only due to security-dialog constraint

**Issue:** [#124](https://github.com/torsday/omnifocus-mcp/issues/124)
**References:** `docs/spikes/2026-04-omnijs-spike.md`, ADR-0004, ADR-0012

### Clarification

The original decision framed the JXA/OmniJS split as a **capability** split: JXA for most operations, OmniJS for features JXA cannot reach (custom perspectives, plug-in invocation). This framing is incomplete.

The stronger constraint is the **security dialog triggered by unsigned OmniJS callers via the URL scheme**. Even after adopting `evaluateJavascript` (which eliminates the URL-scheme dialog), OmniJS remains subject to a modal in contexts where the macOS Automation permission has not already been granted to the calling process. In practice this means:

> **OmniJS is suitable only for explicit, human-initiated invocations — never for autonomously-called MCP tools.**

The correct model is:

| Context | Appropriate transport |
|---------|----------------------|
| Autonomous MCP tool call (any cadence) | JXA only |
| Human-triggered escape hatch (`OMNIFOCUS_ALLOW_RAW_SCRIPT=1`) | OmniJS (`runOmniJsScript`) |
| Future OmniJS-only features (custom perspectives, plug-ins) | OmniJS, but only when invoked by the user explicitly via the tool |

### Why we don't work around this

Two obvious workarounds were evaluated and rejected:

1. **Signed Omni Automation plug-in** — would allow unsigned calls. Rejected: ADR-0012 distributes via `npx`/npm, which cannot bundle and sign OmniFocus plug-ins. Users would need a separate manual installation step, breaking the one-command quickstart.

2. **Prompt the user once at startup** — open a sentinel OmniJS call to force the permission dialog before any tool is used. Rejected: the `osascript` Automation permission is granted per-app and is already granted for `JxaTransport`. The remaining dialogs are OmniJS-specific and cannot be pre-triggered without launching a visible OmniFocus interaction.

### Routing table impact

`TransportRouter`'s `ROUTING_TABLE` currently maps all domain methods to `"jxa"` and only `runOmniJsScript` to `"omnijs"`. This is the correct steady-state. Future methods that require OmniJS capabilities (e.g. custom perspective evaluation via `evaluateJavascript`) **must** be user-invoked tools and **must** document the requirement that the user hold a prior Automation permission grant.

### See also

- ADR-0004 — the `OMNIFOCUS_ALLOW_RAW_SCRIPT=1` opt-in gate; same rationale applied at the tool layer
- ADR-0012 — npm distribution ruling out signed plug-in workaround
