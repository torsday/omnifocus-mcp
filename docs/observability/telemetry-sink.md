# Telemetry sink — durable JSONL export (#823)

In-process observability (response stats, transport-call log, retry/busy
events, cache invalidations) lives only in memory and is lost on restart. For
trend analysis across days or weeks — "is my JXA latency creeping up?" — the
server can append those events to a file as newline-delimited JSON (JSONL),
which the operator ships and analyses downstream.

The sink is **opt-in and off by default**. When disabled it costs nothing: no
file handles, no subscribers, no per-call overhead.

## Enabling

| Env var | Default | Meaning |
|---|---|---|
| `OMNIFOCUS_TELEMETRY_SINK_PATH` | `""` (disabled) | Append-only JSONL file path. **The parent directory must already exist — the server never creates directories.** |
| `OMNIFOCUS_TELEMETRY_SINK_MAX_BYTES` | `52428800` (50 MiB) | Rotate to a single `<path>.1` backup once the live file would exceed this size. |

```bash
OMNIFOCUS_TELEMETRY_SINK_PATH=/var/log/omnifocus-mcp/telemetry.jsonl \
  omnifocus-mcp
```

## What it records

One JSON object per line. Every line carries a sink-stamped `ts` (ISO-8601)
plus an `event` discriminator and the event's own fields:

| `event` | Source | Notable fields |
|---|---|---|
| `transport.call` | every JXA / OmniJS script invocation | `transport`, `scriptName`, `durationMs`, `spawnFloorMs?`, `scriptMs?`, `outcome` |
| `transport.retry` | retry-once on a transient failure (#816) | `transport`, `scriptName`, `reason`, `outcome`, `delayMs`, `durationMs` |
| `of.busy.detected` | OmniFocus responsive-but-blocked (#835) | `transport`, `scriptName`, `timeoutMs` |
| `cache.invalidated` | read-cache scope invalidation (ADR-0006) | `scopes`, `evicted` |
| `response.stats.sample` | periodic snapshot of `responseStats` | per-tool byte aggregates (only when `OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE > 0`) |

The `response.stats.sample` line is **piggybacked on `transport.call`
traffic**, throttled to at most once per 60 s — there is no dedicated timer,
so an idle server emits no samples.

Example lines:

```jsonl
{"ts":"2026-05-28T14:22:01.001Z","event":"transport.call","transport":"jxa","scriptName":"task_list","durationMs":312,"spawnFloorMs":280,"scriptMs":32,"outcome":"ok"}
{"ts":"2026-05-28T14:22:09.880Z","event":"transport.retry","transport":"jxa","scriptName":"task_get","reason":"timeout","outcome":"ok","delayMs":100,"durationMs":290}
{"ts":"2026-05-28T14:23:00.004Z","event":"cache.invalidated","scopes":["task:*"],"evicted":12}
```

## Guarantees and limits

- **Non-blocking:** `record()` appends to an in-memory buffer and returns
  immediately. A background timer (1 s) flushes the buffer to disk, so disk
  latency never blocks a transport call. Remaining events are flushed on clean
  shutdown (SIGINT/SIGTERM, DESIGN §17).
- **Bounded on disk:** at most two files — the live `<path>` and one rotated
  `<path>.1` backup. This is a rolling operator log, not an archive. Ship lines
  off promptly if you need full history.
- **Fail-safe:** an unrecoverable IO error (e.g. the directory disappears)
  disables the sink for the rest of the process and logs
  `telemetry.sink.disabled` once. Telemetry export never takes down the server.
- **Privacy:** events are PII-redacted at the source (#9) — task names, notes,
  and args never appear; `transport.call` carries an `argsHash`, not args. The
  sink does not bypass that redaction.
- **No shared persistence (ADR-0006):** this is operator-side log shipping of
  already-emitted events, not a server-owned datastore.

## Relationship to `internal_status`

`internal_status` exposes *live, in-memory snapshots* (current cache stats,
latency percentiles, etc.) for a point-in-time health check. The telemetry
sink is the *durable, append-only stream* of the same underlying events for
offline/longitudinal analysis. Use `internal_status` for "how is it doing
right now?"; use the sink for "how has it trended over the last month?".
