# ADR-0009: Concurrency — bounded read pool, single-slot write queue

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Every MCP tool call ultimately spawns an `osascript` child process or invokes OmniFocus via URL scheme. Both paths are serialized on OmniFocus's main thread: OF is a desktop app, not a server, and its scripting engine processes one request at a time. Naïvely firing off 20 parallel `osascript` calls does not yield a 20× speed-up — it yields thrashing, occasional deadlocks, and inconsistent results.

At the same time, a zero-concurrency policy (process one call at a time, ever) is wasteful: we can overlap IPC (`osascript` startup, JXA script compile) while OF is still processing the previous request.

For writes, the story is different: concurrent writes against OF risk observable inconsistency (e.g. two tag-add operations where only one wins). We need a stronger guarantee than OF's own: strict serialization.

And we need backpressure. A misbehaving or looping agent could issue hundreds of calls; without a cap, memory grows and the event loop starves.

## Decision

Three separate concurrency primitives:

- **Read pool:** bounded concurrency, default **2** simultaneous `osascript` reads. Configurable via `OMNIFOCUS_READ_POOL_SIZE`.
- **Write queue:** strict single-slot — one write at a time, in FIFO order. Configurable soft cap of **50** pending writes via `OMNIFOCUS_WRITE_QUEUE_CAP`. Exceeding the cap returns `QueueFull` immediately.
- **OmniJS queue:** separate single-slot queue for OmniJS calls (both read and write). The callback-file pattern needs filesystem exclusivity.

Plus:

- **Thundering-herd coalescing** on reads: two identical in-flight reads share one underlying call; the second caller awaits the first's result.
- **Per-tool rate limits:** default 30 calls / 60s / tool, configurable via `OMNIFOCUS_TOOL_RATE_LIMIT`. Exceeding returns a `RateLimited` variant of `ValidationError` with `Retry-After`-style guidance in the suggestion.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Unlimited parallelism | Simplest | OF thrashes; writes race; memory unbounded under agent misbehavior |
| Single global queue (serial everything) | Strongest guarantees; simplest logic | Wasteful — reads wait for other reads unnecessarily; poor UX for interactive agent |
| **Pool for reads + single-slot for writes + separate OmniJS queue** | Best of both; serializes only where correctness demands it; backpressure bounded | Three primitives to test and tune; modest complexity |
| Pool for everything with mutex per OF-object | Fine-grained | Huge complexity; OF doesn't expose lock primitives; false sense of safety |

## Consequences

**Positive**

- Reads feel snappy for the interactive case (one-at-a-time cold, sub-50ms cached)
- Writes are observably consistent: if write A completes before write B is issued, B sees A's effect
- Agent loops can't take down the server: queue caps + rate limits reject fast
- Coalescing cuts redundant work when an agent asks the same question twice in quick succession

**Negative**

- Three primitives to understand (pool, write queue, OmniJS queue); onboarding cost
- Pool size of 2 is a guess; if measurement shows 1 or 3 is better, change the default (non-breaking)
- Rate-limit errors may confuse agents if the limit is too tight; defaults are generous but tunable

**Risks**

- **Write starvation** if reads monopolize — does not apply; reads and writes use separate primitives. Writes have their own dedicated queue.
- **Queue memory growth** under agent misbehavior — bounded by cap (50 writes + unbounded-but-rate-limited reads); practical memory ceiling is tens of kilobytes.
- **Rate limits too strict for integration tests** — `OMNIFOCUS_TOOL_RATE_LIMIT=off` disables them for test runs.
- **Read-pool size too high** causing OF thrashing — tune down via env var, no code change.

## References

- `DESIGN.md` §16 — concurrency & backpressure
- `SPEC.md` — non-functional requirements on reliability
- `~/src/github.com/torsday/llm_prompts/agent_systems.md` — per-tool policy, circuit breakers, loop detection
