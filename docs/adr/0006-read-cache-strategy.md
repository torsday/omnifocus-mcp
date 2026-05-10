# ADR-0006: Read cache — 30-second LRU, invalidated on write

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

Every read tool shells out to `osascript`, which costs 200–500ms cold (startup of the JavaScript interpreter + Scripting Bridge resolution). A typical agent session makes many reads ("list tasks", "get this project", "list tags", "get forecast") in quick succession, often with identical arguments. Without caching, an agent conversation feels sluggish and consumes its context budget on repeated round-trips.

The cache design space:

- **No cache** — simple; every read hits OF; slow
- **Unbounded in-memory cache** — fast; memory grows without bound; stale data risk
- **Bounded in-memory with TTL** — fast; bounded; must decide TTL and invalidation
- **Persistent cache (filesystem/SQLite)** — survives restarts; adds I/O complexity and staleness risk across restarts

Invalidation design:

- **Time-only (TTL expiry)** — simple; stale up to TTL
- **Write-driven invalidation** — fresh; requires tracking which cache keys a mutation affects
- **Both** — safest; TTL as backstop, writes invalidate proactively

## Decision

We will use an **in-memory LRU cache with a 30-second TTL, invalidated proactively by mutations** with conservative (broad) scope.

- **Default capacity:** 256 entries
- **Default TTL:** 30 seconds (`OMNIFOCUS_CACHE_TTL_MS` overrides)
- **Keys:** `<tool_name>:<stable_json_of_args>`
- **Invalidation on mutation:** conservative — e.g. `task_update(id)` invalidates `task:${id}`, `project:${projectId}`, `forecast:*`, `perspective:*`, `search:*`. Broader than strictly necessary, but correct and cheap to reason about.
- **Only reads are cached.** Writes never read the cache and always invalidate.
- **No persistence.** Restart = cold cache. The TTL is short enough that persistence provides marginal value at significant complexity cost.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| No cache | Simplest; always fresh | Slow; bad agent UX; high IPC cost per session |
| In-memory LRU, TTL only | Simple; fast | Stale up to 30s even when we know data changed |
| **In-memory LRU, TTL + write-driven invalidation** | Fast; fresh after our own writes; TTL handles external changes (edits in the OF app itself or from sync) | Invalidation rules need careful definition; over-invalidating hurts cache hit rate |
| Persistent cache (SQLite, filesystem) | Survives restart | Complexity; cross-restart staleness; I/O on every miss; marginal benefit for a 30s TTL |
| Fine-grained dependency tracking (invalidate only affected keys) | Highest hit rate | High complexity; fragile as new queries are added; over-engineering for v1 |

## Consequences

**Positive**

- Typical cached reads return in < 5ms (map lookup + serialization) vs 200–500ms cold
- Sequential reads in an agent turn are effectively free after the first
- After our own writes, the cache is invalidated proactively, so the agent sees fresh data
- External changes (edits in the OF app, sync from another device) are reflected within 30s
- Knob (`OMNIFOCUS_CACHE_TTL_MS`) lets users trade freshness for speed

**Negative**

- 30s staleness window for external changes — a user editing a task in the OF app may see the old value reflected through this MCP for up to 30s
- Conservative invalidation is a simple rule but reduces hit rate after bulky mutations (everything invalidates)
- Memory bound (256 entries) can evict hot entries under heavy read load — acceptable; LRU handles the common case

**Risks**

- **Incorrect invalidation rule** → agent sees stale data after a write. Mitigated by tests that exercise every mutating service method and assert cache state afterward, plus the TTL as a backstop.
- **Cache keyed on serialized args with unstable key ordering** → cache misses that should hit. Mitigated by a single canonical JSON serializer for cache keys (sorted keys, no whitespace).
- **Cache grows memory on high-cardinality queries** (e.g. many different searches) → bounded by LRU capacity; no uncontrolled growth.
- **One oversized cached response pinning memory** (e.g. a forecast page with thousands of full Task objects) → bounded by `OMNIFOCUS_READ_CACHE_MAX_BYTES` (default 16 MB); per-entry `Buffer.byteLength(JSON.stringify(value))` is measured at insert and `lru-cache` evicts oldest entries until the running total fits the cap (#812).

## References

- `DESIGN.md` §6.5 — caching design
- `~/src/github.com/torsday/llm_prompts/agent_systems.md` — per-tool caching policy
