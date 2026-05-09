# osascript fanout spike — multiplexed script vs persistent daemon

**Date:** 2026-05-09
**Issue:** [#800 — spike(transport): evaluate multiplexed osascript fanout vs persistent daemon to amortize cold-start](https://github.com/torsday/omnifocus-mcp/issues/800)
**Decision:** ✅ **Adopt option (a) — multiplexed JXA scripts, scoped to measured fanout sites. Defer option (b) — persistent daemon — until production traces justify it.**

---

## What was measured

Harness: a Node.js script (`/tmp/spike-fanout-measure.mjs`, not committed) that mirrors `src/adapter/jxa/scriptRunner.ts:68`'s `execFile("osascript", ["-l", "JavaScript", "-", jsonArg], …)` invocation pattern, piping the script body via stdin and passing JSON args as `argv[0]`. Each bench warms up twice, then samples 30 iterations. Wall-clock timed in Node `performance.now()` from `execFile` call to callback resolution — the same boundary `runJxaScript` measures.

Machine: Apple M4, macOS 26.4.1, OmniFocus 4 running, no other heavy processes. Numbers are on the higher end of what a real session sees because each iteration is a true cold spawn (no in-process caching).

| Bench | min | p50 | p95 | max | mean |
|-------|----:|----:|----:|----:|----:|
| 1. JXA noop (`return "ok"`) | 104 ms | **118 ms** | 297 ms | 376 ms | 148 ms |
| 2. JXA + `Application("OmniFocus")` ref | 110 ms | **227 ms** | 392 ms | 494 ms | 226 ms |
| 3. JXA + read inbox count | 212 ms | **332 ms** | 435 ms | 440 ms | 327 ms |
| 4. JXA + read tag count | 236 ms | **278 ms** | 437 ms | 529 ms | 313 ms |
| 5. JXA + read folder count | 214 ms | **262 ms** | 383 ms | 387 ms | 279 ms |
| 6. JXA + 3 reads in 1 script | 248 ms | **323 ms** | 430 ms | 635 ms | 332 ms |
| 7. JXA + 6 reads in 1 script | 314 ms | **380 ms** | 553 ms | 629 ms | 393 ms |

The issue's stated 80–150 ms cold-start figure understates current reality. On this M4 (which is faster than the M-series machines available in 2026-04), a JXA noop is **118 ms p50 / 297 ms p95**. Adding an `Application("OmniFocus")` reference roughly doubles that to **227 ms p50** before you've read anything. A single small read lands in the **260–330 ms p50** range.

### Fixed vs marginal cost

Subtracting:

- **Fixed per-process cost** (osascript startup + JavaScriptCore init + stdin handoff + JSON arg parse + AppleScript Application binding): ~110–230 ms p50, depending on whether you touch OmniFocus at all.
- **Marginal cost per additional read inside the same process** (bench 6 minus bench 3 ≈ minus the cost of two more reads): roughly **20–30 ms each**.

A read fired in a fresh process pays the full ~280 ms; the same read appended to an existing multiplexed script pays ~25 ms. That's the entire economic argument for option (a).

### Fanout comparison

| Pattern | Wall time (p50) |
|---------|--------------:|
| 3 separate cold reads (sequential) | 873 ms |
| 3 reads multiplexed in 1 script | **323 ms** |
| **Saving** | **550 ms (63%)** |

| Pattern | Wall time (p50) |
|---------|--------------:|
| 6 separate cold reads (sequential, proxy) | ~1746 ms |
| 6 reads multiplexed in 1 script | **380 ms** |
| **Saving** | **~1366 ms (78%)** |

The marginal savings *grow* with fanout depth — six small reads in one script is ~5× cheaper than running them separately. That's the load-bearing finding.

---

## Workload analysis: where does fanout actually happen?

The premise in #800 was "a tool that performs three small reads (e.g. 'list tags + list folders + get current forecast')" — which assumes tools internally fan out. Reality after walking the codebase is more nuanced.

### One adapter method = one JXA script

Every method on `JxaTransport` (`src/adapter/jxa/JxaTransport.ts`) issues exactly one `runJxaScript` call. There's no "internal fanout" at the transport layer — the architecture is deliberately one-script-per-method (ADR-0005). So the multi-read pattern, if it exists, lives one layer up at the **service** layer, where service methods may compose multiple adapter calls.

### Real fanout sites found

A grep across `src/services/` for adapter calls per service method surfaced these:

1. **`forecastService.getForecastTag`** (`src/services/forecastService.ts:54-57`) — exactly the canonical case. Two sequential adapter calls per invocation:
   ```ts
   const { tagId } = await this.adapter.getForecastTag();   // call 1
   return { tagId, name: await this.lookupTagName(tagId) }; // call 2 (adapter.getTag)
   ```
   At p50 ~280 ms × 2 = **~560 ms cold**. A multiplexed script returning both fields lands at **~330 ms** — savings ~230 ms.

2. **`forecastService.setForecastTag`** (`src/services/forecastService.ts:66-68`) — write+read fanout. `setForecastTag` is a write (queued single-slot per ADR-0009) followed by `getTag` for the name to round-trip into the response (the "lever-4 readability" pattern from #599). Same two-spawn cost.

3. **`exportService.exportOpml` / `exportTaskPaper`** (`src/services/exportService.ts:104-194`) — fan out one `listTasks` call **per project** via `Promise.all`. Already concurrency-bounded by the read pool (size 2); multiplexing wouldn't help because the bottleneck is OF's main thread, not the spawn cost.

4. **`exportService.importTaskPaper`** (`src/services/exportService.ts:245+`) — sequential `createTask` calls in a loop. These are writes, already serialized by the single-slot write queue per ADR-0009. Multiplexing into a batch script *would* help — and that pattern already exists (`task_batch_create`); import should likely use it (filed as a follow-up below).

### Cache caveat

ADR-0006 ([read cache, 30 s TTL](../adr/0006-read-cache-strategy.md)) means hot paths almost never pay the cold spawn cost twice within 30 s. The fanout cost above is real **only on cache misses** — the first read after invalidation, after a write that broadly invalidates (forecast/perspective/search), or after a fresh process start. So the worst case is the *interactive cold session opener*: an agent starts a conversation, immediately asks "what should I do today?", and the resulting tool calls hit a cold cache.

This bounds the realistic upside: option (a) helps a small number of specific patterns (forecast tag round-trip, taskpaper import) on cold caches. It does not help warm-cache traffic, and it does not help the steady state of a long agent conversation.

---

## Option (a) — multiplexed fanout script

Single JXA script taking `{ ops: [{ name, args }, …] }`, dispatching to existing per-script handlers, returning an array of results. From the TS side this looks like a new adapter method `OmniFocusAdapter.multiRead(ops): Promise<Result[]>` (or per-pattern specializations such as `getForecastTagWithName(): {tagId, name}`).

**Pros**
- Direct measured win: 60–80% wall-time reduction on the multi-read patterns documented above.
- Composable: identical pattern to existing `task_batch_*` mutation scripts — the team already accepts this shape.
- Architecturally invisible: every existing `runJxaScript` call still works unchanged. ADR-0009 unaffected — same parallelism, same queues, same backpressure caps.
- TCC-clean: same one-process-per-call model OmniFocus already trusts.
- Reversible: each multiplexer is a localised addition. No protocol or lifecycle changes.

**Cons**
- One generic multiplexer requires a dispatch table and a stable contract for `ops`. Bug surface: a script-author error in op N fails the whole batch unless the dispatcher catches per-op exceptions. Per-op error envelopes need a small contract decision.
- Specialised helpers (e.g. `getForecastTagWithName`) avoid the dispatch contract but proliferate as new patterns emerge.
- Marginal-cost reads (~25 ms each) still aren't free — past 6–8 ops a single multiplexed script starts approaching the timeout headroom budgeted by `OMNIFOCUS_JXA_TIMEOUT_MS` for very chunky ops.

### Two implementation flavours

Worth recording the choice between them rather than collapsing.

**A1. Specialised composite scripts** — e.g. `forecast_tag_with_name.js`, called by `forecastService.getForecastTag`. No generic multiplexer; each high-value pattern gets its own bespoke JXA script + adapter method. Smallest blast radius, cleanest types, but cargo-cult risk if the "patterns" multiply.

**A2. Generic `multi_read({ ops: [...] })`** — one script, one adapter method, dispatch via a `name`-keyed handler table. Zero new scripts per new pattern. Bigger contract design (per-op result shape, per-op error handling, partial-success semantics).

**Recommendation:** start with A1 for the two `forecastService` methods. They're concrete, isolated, and already demanding the plumbing. If a third or fourth pattern emerges within the next milestone, promote to A2. Don't ship a generic multiplexer ahead of demand.

---

## Option (b) — persistent osascript daemon

Long-running `osascript -l JavaScript` process accepting ops on stdin, returning results on stdout, framed by length-prefixed JSON or newline-delimited JSON.

**Pros**
- Eliminates ~118 ms of fixed per-call cost on **every** call (not just multi-read patterns). On a 50-call session that's ~6 s wall-clock saved, regardless of agent shape.
- The intra-process AppleScript Application binding stays warm — bench 2 (227 ms) effectively becomes the marginal cost of bench 1 (118 ms), saving another ~100 ms per call.
- Doesn't require the agent or service author to know about a multiplex shape. Free upgrade for every existing call site.

**Cons (and why "defer")**
- **TCC and lifecycle.** macOS Automation permission is granted per `(bundle id, peer)` pair. A persistent process holds that grant only as long as it lives. On crash/restart we may re-prompt, may not — the behaviour across macOS 14/15/16 and 26.x has been inconsistent in user reports. Production rollout would need controlled testing before ADR commitment.
- **ADR-0009 interaction is non-trivial.** The current concurrency primitives are: read pool (2 slots), write queue (1 slot), OmniJS queue (1 slot). A single daemon collapses parallelism to 1 — a regression from the current `OMNIFOCUS_READ_POOL_SIZE=2` default. Preserving the parallelism either (a) needs two read daemons (and a read-pool acquire policy that picks between them), or (b) accepts a regression and re-tunes ADR-0009. Either is a meaningful redesign, not a localized change.
- **Failure recovery.** A daemon crash mid-write leaves: partial OF state (already a concern, but currently bounded by per-call timeout + typed-error mapping); pending-call promises that need failure semantics; pipe state needing to be torn down and re-established. The retry/respawn logic adds nontrivial code.
- **SPOF.** Currently each call has independent failure isolation — one stuck script doesn't take down others. A daemon that wedges takes down every reader (or every writer) until detected and respawned.
- **Observability churn.** `transportCall` events currently fire from `runJxaScript` per spawn. Daemon-mode would need to refactor that boundary — not catastrophic but real work.
- **Benefit is unproven at workload.** No production trace currently shows per-call cold-start dominating wall time *after* ADR-0006 cache hits. The 118 ms savings is observable per-call but unclear whether it dominates user-perceived latency. Optimising without production data risks shipping complexity for a small win.

### When to revisit

Revisit option (b) if any of these become true:
- Production telemetry (per-tool p95 latency) shows cold-spawn dominating after the cache layer is excluded — i.e. p95 cold reads cluster near the JXA bootstrap floor and not near the OF read cost.
- A native daemon-mode primitive lands in macOS automation tooling that bypasses TCC re-prompting on respawn.
- The cache TTL is shortened (e.g. for an "always-fresh" mode), making cold spawns far more frequent.

Until then, option (b) is a real but speculative win at significant complexity cost.

---

## ADR-0009 interaction summary

| Option | Read pool (2) | Write queue (1) | OmniJS queue (1) | Backpressure caps | Coalescing |
|--------|---------------|-----------------|------------------|-------------------|------------|
| (a) Multiplexed scripts | unchanged | unchanged | unchanged | unchanged | a multi-op script counts as one call against rate limits — desirable |
| (b) Persistent daemon | redesign needed (single process serializes by default) | needs rewrite (or shared with reads, complicating semantics) | unchanged (already serial) | rate-limit accounting changes shape | re-evaluation needed |

Option (a) slots into ADR-0009 cleanly. Option (b) requires an ADR amendment.

---

## Decision

Adopt **option (a), flavour A1** — ship targeted specialised composite scripts for the two measured fanout sites in `forecastService`. Defer option (a)/A2 (generic multiplexer) until a third high-value pattern emerges. Defer option (b) (persistent daemon) until production telemetry shows per-call cold-spawn dominating post-cache wall time.

### Rationale

- Option (a) is a measured ~60% wall-time win on the two real fanout sites with zero ADR-0009 disruption and a cargo-cult-able existing pattern (`task_batch_*`).
- Specialised scripts (A1) avoid premature generalisation. The two patterns identified do not yet justify the contract design that a generic multiplexer demands; if more patterns emerge, promote to A2 then.
- Option (b) is a more powerful but more speculative win. The architectural cost (ADR-0009 redesign, TCC behaviour validation, failure-recovery code) is real; the benefit is unmeasured in production. The decision rule "instrument before optimising" applies — get the cheap win shipped now, leave the bigger lever pending data.

---

## Follow-ups to file

- **feat(forecast): single-call `getForecastTag` returning `{tagId, name}` via composite JXA script** — implements A1 for the read path. Saves ~230 ms p50 cold per `forecast_get_tag` MCP call. Acceptance: new JXA script `forecast_tag_with_name.js`; `JxaTransport.getForecastTagWithName(): Promise<{tagId, name}>`; `forecastService.getForecastTag` switched to it; existing `getForecastTag` adapter method retained for backward compatibility (or removed in same PR if call sites are refactored). Tag the issue `model: opus-med`.
- **feat(forecast): single-call `setForecastTag` returning `{tagId, name}` via composite JXA script** — same pattern for the write path. Tag `model: opus-med`.
- **perf(import): use `task_batch_create` in `exportService.importTaskPaper` instead of N sequential creates** — independent of the option-(a) decision but surfaced during workload analysis. Existing batch script already exists; the importer just doesn't use it. Tag `model: opus-med`.
- **observability: add per-tool cold-start histogram** — instrument `runJxaScript` to label calls as cold (no in-process cache) vs warm to validate that the option-(b) deferral remains correct as workload evolves. Tag `model: opus-med` and link this spike doc.

These are the input to a future `/groom` pass — not filed inline by this spike to keep the merge tight.

---

## References

- [ADR-0005 — scripts as first-class files](../adr/0005-script-assets-as-files.md)
- [ADR-0006 — read cache, 30 s TTL](../adr/0006-read-cache-strategy.md)
- [ADR-0009 — concurrency: bounded read pool, single-slot write queue](../adr/0009-concurrency-pool-and-queue.md)
- `src/adapter/jxa/scriptRunner.ts` — spawn site (line 68)
- `src/adapter/jxa/JxaTransport.ts` — one-method-one-script structure
- `src/services/forecastService.ts:54-77` — measured fanout sites
- `src/scripts/jxa/task_batch_*.js` — existing batch-script precedent
