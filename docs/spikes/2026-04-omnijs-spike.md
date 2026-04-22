# OmniJS Transport Spike — April 2026

**Status:** ✅ GO — `evaluateJavascript` bridge adopted as co-primary transport  
**Issues:** [#2](https://github.com/torsday/omnifocus-mcp/issues/2), [#125](https://github.com/torsday/omnifocus-mcp/issues/125)

---

## Background

DESIGN §3 / ADR-0002 specified two candidate OmniJS transports:

1. **URL-scheme** — `omnifocus://localhost/omnijs-run?script=…` via `osascript open location`
2. **JXA bridge** — `Application("OmniFocus").evaluateJavascript(script)` via `osascript -l JavaScript`

Spike #2 investigated the URL-scheme path first. Spike #125 then validated the JXA bridge, which is strictly superior. Both findings are recorded here.

---

## Transport A: URL-scheme (`omnijs-run`) — ❌ NOT RECOMMENDED

### What works

- Scripts execute inside OF's JS engine when invoked via `osascript -e 'open location "omnifocus://localhost/omnijs-run?script=..."'`
- `new Task(name)` auto-adds to inbox; mutations commit immediately
- UTF-8 survives encoding/decoding

### Critical problems

| Problem | Detail |
|---------|--------|
| **OmniFocus security dialog** | Every invocation triggers an "Allow this automation?" modal the user must click. Blocks unattended use. |
| **File-write sandbox restriction** | OmniFocus 4 is sandboxed; `URL.fileURLWithPath(...).write(...)` silently fails for `/tmp`, `~/Downloads`, `~/Documents`. Cannot write result files. |
| **No network access** | `fetch()` to localhost is blocked inside OmniJS scripts. |
| **Encoding subtleties** | `encodeURIComponent` leaves `()` unencoded, breaking OF's URL parser for function-call syntax. Must use RFC 3986 unreserved-only encoding (matching Python's `urllib.parse.quote`). |
| **IIFE scope breaks `inbox`** | `inbox.append(t)` throws "not a function" when called inside a function scope; works at top level only. |
| **Result retrieval complexity** | Only viable pattern: OmniJS writes a sentinel inbox task; Node polls via JXA. Round-trip latency: p50 ≈ 3–5 s, occasional 60 s+ outliers. |
| **`open` CLI silently ignored** | `open "omnifocus://..."` does nothing; only `osascript -e 'open location "..."'` triggers OF to process the URL. |

### Verdict

The security dialog alone makes this transport non-viable for a background MCP server. **Dropped in favour of the JXA bridge.**

---

## Transport B: JXA bridge (`evaluateJavascript`) — ✅ ADOPTED

### Invocation

```typescript
const result = await execFileAsync("osascript", [
  "-l", "JavaScript",
  "-e", `Application("OmniFocus").evaluateJavascript(${JSON.stringify(script)})`,
]);
const data = JSON.parse(result.stdout.trim());
```

No dialogs. Uses the macOS Automation channel already granted to `osascript`.

### Latency (OF 4.8.8, ~780 tasks, macOS 15)

| Operation | min | p50 | p95 | max |
|-----------|-----|-----|-----|-----|
| Ping (no OF data) | 122 ms | 130 ms | 142 ms | 219 ms |
| Task count (780 tasks) | 435 ms | ~500 ms | ~1.2 s | ~1.4 s |
| Large payload (321 KB) | — | 191 ms | — | — |

> **Note:** p95 task-count variability (1.2 s) reflects JXA's serialisation on OF's main thread. Ping p50 of 130 ms is dominated by `osascript` process startup overhead, not OF work.

### Validated capabilities

| Capability | Result |
|------------|--------|
| Mutations (create/update/complete) | ✅ Commit immediately; no separate sync needed |
| Error surfacing | ✅ Thrown JS errors propagate as non-zero exit + stderr |
| Concurrent calls | ✅ Parallel `osascript` processes serialise on OF's JXA thread; both complete |
| Large payloads (321 KB) | ✅ No truncation |
| UTF-8 / emoji / CJK | ✅ Full round-trip fidelity |
| `async/await` + `Promise.resolve` | ✅ Works |
| `setTimeout` / `setInterval` | ❌ Not available — no event loop |

### API shape delta vs URL-scheme OmniJS

| Global / API | URL-scheme OmniJS | `evaluateJavascript` |
|---|---|---|
| `flattenedTasks` | Function call: `flattenedTasks()` | **Property** (array-like): `flattenedTasks.length`, `.filter(...)` |
| `flattenedProjects` | Function call | **Property** |
| `inbox` | `inbox.append(t)` at top level | Present; `inbox.tasks` is `undefined` — use `new Task(name)` |
| `new Task(name)` | Auto-adds to inbox | Auto-adds to inbox ✅ |
| `new Task(name, project)` | Works | Works ✅ |
| `setTimeout` | Available | ❌ Not available |
| `fetch` | Blocked by sandbox | Not applicable |

### Error format

Errors thrown inside OmniJS surface as:

```
execution error: Error: Error: Error: <message> undefined:<line>:<col> (3)
```

Catch the `execFile` rejection and parse from `stderr`.

---

## Decision

**Adopt the JXA bridge as co-primary transport for all OmniJS scripts.**

- URL-scheme transport dropped entirely
- Update ADR-0002 to reflect this (issue #124)
- `OmniJsTransport` implementation uses `evaluateJavascript` exclusively
- Scripts must treat `flattenedTasks` / `flattenedProjects` as **properties**, not function calls
