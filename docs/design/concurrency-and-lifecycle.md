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
  4. Run cleanup hooks — kill any `osascript` child still in flight (see below)
  5. Close logger; flush stderr
  6. Exit 0
- Unhandled exception:
  - Log at `fatal`
  - Exit 1 (the client will reconnect on its own; partial state in OF is OF's concern)

Grace windows are configurable via `OMNIFOCUS_READ_GRACE_MS` / `OMNIFOCUS_WRITE_GRACE_MS`.
The controller is `src/server/shutdown.ts`; signal handlers and hook registration
are wired in `src/server/mcpServer.ts`.

#### Orphan-process cleanup (#839)

Both script runners spawn `osascript` via `child_process.execFile`. Each child
holds the OmniFocus database open while it runs, so a child orphaned at exit
keeps OF locked and the *next* server start can't read or write until the orphan
finally times out. To prevent that, every spawned child is registered in
`src/adapter/_shared/childRegistry.ts`; the shutdown controller's
`osascript-children` cleanup hook runs **after** the drain window and terminates
any survivor — `SIGTERM` first, then `SIGKILL` after a 2s grace
(`DEFAULT_CHILD_KILL_GRACE_MS`). A clean drain leaves the registry empty, so the
hook is a no-op in the common case. The `DatabaseWatcher` Swift child is killed
separately on `process` `exit` and `stop()`.

#### Audit findings (what is *not* leaked)

- **Idempotency store** (`src/server/idempotencyStore.ts`) and **read cache**
  (`src/cache/lruCache.ts`) are both purely in-memory (`Map`-backed). There is no
  on-disk state, so there is nothing to flush and no "half-written" corruption
  risk on exit — the drain already lets in-flight writes complete before the
  process ends. No flush step is needed.
- **Telemetry sink flush** is deferred until the opt-in JSONL sink (#823) exists;
  when it lands it should register its own cleanup hook via `registerCleanup`.
