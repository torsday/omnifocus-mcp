# JXA Round-Trip Spike

**Date:** 2026-04-21  
**Author:** spike run via `scripts/spikes/jxa-spike.ts`  
**Issue:** [#1 — Validate JXA round-trip against live OmniFocus](https://github.com/torsday/omnifocus-mcp/issues/1)  
**Decision:** ✅ **GO — JXA is viable as the primary transport**

---

## What was tested

Ran `osascript -l JavaScript -e <script>` from Node.js via `child_process.execFile` against a live OmniFocus instance (macOS 25.3.0, OmniFocus 4.x).

Three scenarios were measured (10 iterations each unless noted):

| Scenario | min (ms) | p50 (ms) | p95 (ms) | max (ms) |
|----------|---------|---------|---------|---------|
| Ping (OF running check + name) | 92 | 98 | 130 | 130 |
| Task count (flattenedTasks on 718 tasks) | 192 | 207 | 270 | 270 |
| UTF-8 round-trip (5 iterations) | — | 84 | 87 | — |

Cold-start latency (first call after process launch) is included in the min.

---

## Key findings

### ✅ JSON transport works cleanly

`JSON.stringify` on the JXA side produces valid UTF-8 JSON; `JSON.parse` on the Node side handles it correctly. No corruption observed.

### ✅ UTF-8 non-ASCII content round-trips without corruption

The string `"Héllo wörld — 日本語 🎯 ☃"` passed through `osascript` stdout into Node unchanged. Character encoding is not a concern.

### ✅ Error surfaces predictably

When a JXA script throws, `execFile` rejects with a non-zero exit code and the error message in stderr. Wrapping in try/catch is sufficient.

### ✅ Malformed JSON is detectable

When a script returns a non-JSON string, `JSON.parse` throws at the Node boundary. The adapter layer must wrap this.

### ⚠️ Latency profile

- **Simple calls (ping):** p50 ~100 ms, p95 ~130 ms
- **Heavy calls (718-task full scan):** p50 ~207 ms, p95 ~270 ms
- **DESIGN §6.6 constraint satisfied:** < 500 ms on warm OF

For tool responses, agents should set MCP client timeout to ≥ 2s to leave headroom for queue wait + JXA execution.

### ⚠️ JXA is single-threaded relative to OF's main thread

Concurrent `osascript` calls serialise at the OF side. The read pool (ADR-0009, #20) caps concurrency at 2 read slots. Do not exceed 2 concurrent JXA reads; mutations need the write queue.

---

## Failure modes catalogued

| Scenario | Observed behaviour |
|----------|--------------------|
| Script throws `Error` | `execFile` rejects; non-zero exit; message in stderr `execFileError.stderr` |
| Malformed JSON returned | `JSON.parse` throws `SyntaxError` at Node boundary |
| OF not running | Expected: `osascript` exits non-zero with "application can't be found" or equivalent; wrap in `OmniFocusNotRunning` |
| Permission denied | macOS prompts on first invocation; on deny, `osascript` exits non-zero with "not allowed" |
| Timeout (OF wedged) | Use `child_process.execFile` with `timeout` option (recommended: 10 s); kills process on expiry |

---

## ADR implications

ADR-0002 (JXA + OmniJS dual transport) is **confirmed**. No direction change needed.

The JxaTransport base class (#17) should:
1. Invoke `execFile("osascript", ["-l", "JavaScript", "-e", script], { timeout: 10_000 })`
2. Parse stdout as JSON
3. Map exit codes / stderr patterns to typed `OmniFocusError` subclasses

---

## Proof script

`scripts/spikes/jxa-spike.ts` — runnable via `pnpm exec tsx scripts/spikes/jxa-spike.ts`.
