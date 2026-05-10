# In-process store retention inventory

Every in-process store that accumulates state over a server session is listed
here. The inventory is the authoritative reference for #813 and is updated
whenever a new store is added.

## Stores

| Store | File | Bound type | Default max | Eviction policy | Env override |
|---|---|---|---|---|---|
| `IdempotencyStore` | `src/server/idempotencyStore.ts` | entries | 1 024 | LRU on insert; TTL on read | `OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES` (constructor opt) |
| `LoopDetector.windows` | `src/loopDetector/LoopDetector.ts` | distinct keys | 4 096 | FIFO on key insert; empty keys removed on prune | `OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS` |
| `ResponseStatsRegistry` | `src/observability/responseStats.ts` | samples per tool | 1 024 reservoir | Reservoir sampling (random replacement) | hard-coded `RESERVOIR_SIZE` constant |
| `ToolRateLimiter.windows` | `src/rateLimit/ToolRateLimiter.ts` | timestamps per tool name | bounded by tool count (~100) | TTL prune on every `check()` call | n/a — tool set is finite |
| `CircuitBreakerRegistry._breakers` | `src/server/circuitBreaker.ts` | one `CircuitBreaker` per tool name | bounded by tool count (~100) | none needed — set is fixed at startup | n/a |
| `transportCall` logger | `src/logging/transportCall.ts` | none — pure emitter | n/a | n/a | n/a |

## `internal_status` exposure

`internal_status` exposes live sizes for the two stores with meaningful
cardinality:

```json
{
  "stores": {
    "idempotencyEntries": 42,
    "loopDetectorKeys": 7
  }
}
```

`null` when the probe is not wired (e.g. minimal test contexts).

## Eviction details

### IdempotencyStore

- **LRU eviction** when `size > maxEntries`: the least-recently-used key is
  deleted before inserting the new entry.
- **TTL eviction** on read: expired entries are removed when `get()` is called.
  Entries that expire but are never read again are evicted lazily on the next
  LRU overflow rather than by a background sweep (no timer threads).

### LoopDetector

- **Empty-key eviction**: after pruning timestamps outside the sliding window,
  if a key's array becomes empty the key is deleted immediately. This is the
  primary reclamation path for short-lived unique-args combos.
- **FIFO cap**: if `windows.size >= maxKeys` when a new key would be inserted,
  the oldest-inserted key (first in `Map` iteration order) is removed first.
  This bounds worst-case memory when a server sees many distinct argument
  combinations per minute.

## Smoke test

Run a synthetic 1 000-call workload and verify no store grows beyond its cap:

```bash
# From repo root
pnpm test src/loopDetector/LoopDetector.test.ts
pnpm test src/server/idempotencyStore.test.ts
```

The LoopDetector test includes a `maxKeys` cap assertion that calls `record()`
with 1 000 distinct arg hashes and confirms `detector.size ≤ maxKeys`.
