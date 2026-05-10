<!-- Originally DESIGN.md §21 (split per #805) -->

# Observability contract

## Log format

One JSON line per event to stderr, compact (no whitespace):

```json
{"level":"info","time":1713570000000,"event":"tool.invoked","tool":"task_list","correlationId":"01JBZK...","durationMs":142,"cacheHit":false,"transport":"jxa","result":"success"}
```

Fields that are **always** present: `level`, `time`, `event`, `correlationId` (for request-scoped events).

## Event taxonomy

| Event                    | When                                          | Extra fields                        |
| ------------------------ | --------------------------------------------- | ----------------------------------- |
| `server.started`         | Once, at boot                                 | `version`, `config`, `tools`        |
| `server.shutdown`        | Once, at shutdown signal                      | `reason`, `graceMs`                 |
| `tool.invoked`           | After every tool call                         | `tool`, `durationMs`, `transport`, `cacheHit`, `result`, `code?` |
| `tool.error`             | Instead of `tool.invoked` on error            | +`code`, `message`                  |
| `transport.call`         | At `debug`; every JXA/OmniJS call             | `script`, `argsHash`                |
| `transport.retry`        | When a transport-level retry occurs            | `attempt`, `reason`                 |
| `cache.invalidated`      | After a mutation                              | `scope`, `keysRemoved`              |
| `circuit.opened`         | When circuit opens                            | `tool`, `failures`                  |
| `circuit.closed`         | When circuit recovers                         | `tool`, `downtimeMs`                |
| `loop.detected`          | On repeated identical invocation              | `tool`, `count`                     |
| `raw_script.invoked`     | Every call to `run_jxa_script` / `run_omnijs_script`, regardless of log level | `script` (full body) |

## Metrics surface

No Prometheus, no OTel in v1. The `internal_status` tool returns a snapshot:

```typescript
{
  uptimeMs: number,
  ofVersion: string,
  ofRunning: boolean,
  lastSync: { at: string, status: "ok" | "error" } | null,
  cache: { size: number, hits: number, misses: number, evictions: number },
  circuits: Record<ToolName, "closed" | "open" | "half-open">,
  queueDepth: { read: number, write: number, omniJs: number }
}
```

## Correlation

- MCP request-level correlation ID: if the client provides one (via MCP meta), we reuse; else we generate a ULID
- Emitted on every event within the request's lifecycle
- Useful for reconstructing a single tool call across transport, cache, and circuit events
