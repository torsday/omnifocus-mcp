<!-- Originally DESIGN.md §§1–5, 7, 8 (split per #805) -->

# Decisions: problem framing, options, evaluation, and cuts

## Problem framing

OmniFocus has no public REST API. The only programmatic surfaces are:

1. **JXA** (`osascript -l JavaScript`) — access to the Scripting Bridge dictionary; synchronous; structured return values; older API with some gaps around perspectives and plug-ins
2. **OmniJS** via URL scheme (likely `omnifocus:///omnijs-run?script=…` per Omni Automation docs; _exact form verified in M0 OmniJS spike before `OmniJsTransport` is written_) — Omni's strategic JS API; async, return values only via filesystem/callback; covers everything JXA can't reach, including custom perspectives and plug-in invocation
3. **URL scheme for "add task"** — one-shot task creation; no query surface; ignored for our purposes
4. **The SQLite database file** — undocumented, unstable; **do not touch** (noted here and in AGENTS.md gotchas; no ADR — the decision is too obvious to contest)

We must cover the full OmniFocus feature surface (per `project_scope.md`) via MCP tools and resources, for a single-user, local-only agent setup, with engineering-excellence constraints on reliability, scalability, and maintainability.

---

## Options for language + runtime

| Option | Approach | Fits when | Tradeoffs |
| ------ | -------- | --------- | --------- |
| **A. TypeScript + Node.js** | Official MCP SDK; `child_process` to shell out to `osascript`; same language as JXA scripts | Single-person dev team, wants mature MCP SDK, values type safety and ecosystem | Node startup ~100ms; `execFile` per call adds overhead; still the fastest path to correct and maintainable |
| B. Python + MCP SDK | Python MCP SDK; `subprocess` to `osascript` | Team already Python-native | No advantage — still shelling to osascript; language switch between server and OF scripts; MCP SDK less mature than TS |
| C. Swift + ScriptingBridge | Native in-process calls to OF via ScriptingBridge framework; no `osascript` shell-out | Willing to absorb MCP SDK immaturity for performance | MCP Swift SDK is early; less community; harder to distribute; overkill for 95% of calls whose bottleneck is OF itself, not IPC |
| D. Go + MCP SDK | Static binary; goroutines for queueing | Team wants a single binary | Same shell-out to osascript (no scriptingbridge from Go); language switch; no meaningful win |

**Recommendation: Option A (TypeScript + Node.js).** Recorded as **ADR-0001**.

**What would change this:** if per-call overhead becomes a measured bottleneck in real usage (unlikely — OF's response time dominates), revisit C.

---

## Options for OF transport

| Option | Approach | Fits when | Tradeoffs |
| ------ | -------- | --------- | --------- |
| A. JXA only | Shell to `osascript -l JavaScript`; accept that custom perspectives and plug-ins are out of reach | Want minimum complexity | Fails SPEC requirement for full coverage; leaves ~15% of OF unreachable |
| B. OmniJS only | URL-scheme invocation + filesystem result files | Want Omni's strategic API | Async callback dance; no sync return values; every tool becomes harder |
| **C. Dual transport with router** | `OmniFocusAdapter` interface; internal `TransportRouter` picks JXA by default, OmniJS for the specific features that need it | Want full coverage with the simplest path per feature | More moving parts; two script dialects; requires a router that is itself well-tested |

**Recommendation: Option C.** Recorded as **ADR-0002**.

**What would change this:** if Omni ships a JXA-complete OmniJS alternative with synchronous return values, consolidate on OmniJS.

---

## Options for tool surface

| Option | Approach | Fits when | Tradeoffs |
| ------ | -------- | --------- | --------- |
| A. Few, powerful tools | 8–12 generic tools with wide schemas (`omnifocus_query`, `omnifocus_mutate`) | Want small tool list | Agent must understand complex nested schemas; tool descriptions become essays; error disambiguation is hard |
| **B. Many, narrow tools with consistent verbs** | A wide surface of `<noun>_<verb>` tools: `task_list`, `task_create`, `task_update`, …, `project_list`, … | Want LLM-friendly discoverability | Larger tool surface (modern agents handle wide surfaces fine); more handler boilerplate (mitigated by patterns) |
| C. Split across multiple MCP servers | Read-server + write-server (or per-noun servers) | Want privilege separation | User configures multiple servers; more ops surface; premature for a single-user tool |

**Recommendation: Option B, with namespaced `<noun>_<verb>` naming.** Recorded as **ADR-0003**.

If the agent tool-selection rate degrades as we add tools, fall back to C (split into two servers by read/write). The codebase should remain structured so that split is mechanical, not architectural.

---

## Options for opt-in raw script tools

| Option | Approach | Fits when | Tradeoffs |
| ------ | -------- | --------- | --------- |
| A. No escape hatch | Wrap everything or nothing | Want strict tool contracts | Any OF feature we miss is unreachable until we wrap it; blocks power users |
| **B. Opt-in escape hatch (`run_jxa_script`, `run_omnijs_script`)** | Off by default; enabled by `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; loudly dangerous in description | Single-user tool where the user owns the blast radius | Exposes arbitrary-script execution to the agent; must be off by default |
| C. Always-on escape hatch | Ship enabled | Power-user-only audience | Unsafe default — violates "safe by default" principle |

**Recommendation: Option B.** Recorded as **ADR-0004**.

---

## Reliability / Scalability / Maintainability evaluation

### Reliability

- What happens when OmniFocus is unavailable? → `OmniFocusNotRunning` with suggestion; circuit breaker prevents retry-storm
- What happens when an OmniJS callback never fires? → transport timeout (default 45s), `Timeout` error with `{ transport: "omnijs" }`
- What happens on partial batch failure? → batch is not atomic in v1; error includes per-index failure details; **open question in SPEC**
- Data integrity under concurrent mutations? → serialized writes preclude races at the MCP layer; OF itself handles its own consistency
- Permission revoked mid-session? → typed `PermissionDenied` with instructions; does not crash server

### Scalability

- What breaks first, and when? → For a single-user OF (< 50k tasks typical), the bottleneck is JXA round-trip latency, not anything we control. Batch ops and the LRU cache handle the load patterns we expect.
- 10× load scenario? → N/A for single-user; if this ever grew to a shared MCP (out of scope), the adapter queue becomes the bottleneck and we'd shard by OF install.
- Memory profile? → Tasks + projects held only in the cache; bounded by capacity (256 entries default). No unbounded growth.

### Maintainability

- Can a new developer understand structure from directory layout? → yes (see [architecture.md](./architecture.md))
- Module boundaries reflected in code? → yes: `adapter/` cannot import from `services/`, enforced by a lint rule
- Data mutation atomicity across boundaries? → writes serialized; no distributed transaction concerns
- Deployment unit? → a single Node CLI distributed via `npx omnifocus-mcp` — one deployable

---

## What's being cut (and why it's safe to cut now)

| Cut | Rationale | Trigger to revisit |
| --- | --------- | ------------------ |
| Remote MCP transports (SSE, HTTP) | Single-user local tool; stdio is the right default | A user requests running this on one Mac, consuming from another |
| Streaming responses | Pagination is simpler; forecasts and task lists fit in a single MCP response | A single common query returns > 10MB of data |
| Persistent cache across restarts | 30s TTL is short anyway; restart cost is acceptable | Measured evidence cold-start is hurting UX |
| Multi-install support | One OF per server instance | Any multi-user scenario appears |
| Conflict resolution | OF handles its own sync conflicts | OF stops handling them well |
| Custom telemetry beyond pino | OpenTelemetry is heavy for a single-user tool | A user wants production-style metrics |
| Automatic OF launch on `OmniFocusNotRunning` | Silent side effects are surprising; prefer explicit `app_launch` tool | User preference, trivial to add later |
| Idempotency keys on mutations | Adds complexity; single-user blast radius is small | Multi-agent or unreliable-transport scenarios |
