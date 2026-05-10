<!-- Originally DESIGN.md §§16–17 (split per #805) -->

# Concurrency, backpressure, and lifecycle

## Concurrency & backpressure

### Pools

- **Read pool:** default 2 concurrent `osascript` child processes. Larger pools don't help because OF's main thread serializes requests anyway; 2 gives us pipeline overlap without thrash. Configurable via `OMNIFOCUS_READ_POOL_SIZE`.
- **Write queue:** single-slot. Writes run one at a time.
- **OmniJS queue:** separate single-slot queue because URL-scheme callbacks contend for the file system.

### Backpressure

- Write queue has a soft cap (50 pending) beyond which new writes reject immediately with `QueueFull`. Prevents a runaway agent from pinning memory.
- Read pool uses unbounded queueing but a per-tool rate limit (default 120 calls / 60s / tool) rejects with a top-level `RateLimited` error (see [architecture.md](./architecture.md#error-taxonomy)) to prevent loop-detection edge cases. The default is deliberately generous — a weekly-review session can burst through `task_list`, `project_list`, `task_get`, `project_mark_reviewed` without tripping it.
- When a call is rejected for backpressure, the response includes `suggestion: "Wait before retrying; <N> operations queued"`.

### Thundering herd

Two identical in-flight reads coalesce: the second caller awaits the first's result rather than issuing a duplicate `osascript`. Cache layer handles this via a "pending requests" map keyed by the cache key.

Recorded as **ADR-0009**.

---

## Lifecycle

### Startup sequence

1. Parse env vars, set log level
2. Initialize logger (stderr-only; hook `process.stdout.write` to detect violations and throw)
3. Register MCP server (stdio transport)
4. Register tools conditionally: always-on toolset always; `run_jxa_script` / `run_omnijs_script` only if `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`
5. Log `server.started` event with version, capabilities, and resolved config — **path-shaped env vars (`OMNIFOCUS_ATTACHMENT_PATHS`, `TZ`) are logged as hashes, not literal values, to avoid leaking directory structure in operator logs**
6. Wait for `initialize` RPC from client

**OF detection is lazy:** we do not probe OF until the first tool call that needs it. Rationale: startup should be < 500ms with no macOS permission prompts; probing OF can take seconds and trigger permission dialogs.

### Version detection

On first successful JXA call, the adapter caches `{ ofVersion, ofEdition }` via a tiny JXA one-liner. Included in every response's `meta.ofVersion` thereafter. Tools that require OF 4 (or specific minor versions) check this and surface `FeatureRequiresOfVersion` if unmet.

### Shutdown sequence

- `SIGINT` / `SIGTERM`:
  1. Stop accepting new tool calls (MCP server rejects with `ServerShuttingDown`)
  2. Drain in-flight reads (grace window: 5s)
  3. Wait for write queue to drain (grace window: 10s)
  4. Close logger; flush stderr
  5. Exit 0
- Unhandled exception:
  - Log at `fatal`
  - Exit 1 (the client will reconnect on its own; partial state in OF is OF's concern)
