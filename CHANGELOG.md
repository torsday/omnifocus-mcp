# Changelog

All notable changes to `@torsday/omnifocus-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). See [ADR-0011](./docs/adr/0011-versioning-and-stability.md) for the explicit definition of breaking vs additive changes in this project.

## [1.0.1](https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...v1.0.1) (2026-04-26)


### Fixed

* **ci:** allow periods inside PR-title subjects ([6170320](https://github.com/torsday/omnifocus-mcp/commit/6170320ea72bfb0e71444d1685e29a02d47eec3d))


### Documentation

* post-1.0 audit — refresh stale 'in preparation' framing ([369d828](https://github.com/torsday/omnifocus-mcp/commit/369d828a40227498ae8a6d1bff69c14bf13fcd50))
* **readme:** add CI status badge for main branch ([#438](https://github.com/torsday/omnifocus-mcp/issues/438)) ([f9576ec](https://github.com/torsday/omnifocus-mcp/commit/f9576ecbea3e897ecd075fc5939277e90b8b4bd3))
* **readme:** add Security & trust section ([0c7aac3](https://github.com/torsday/omnifocus-mcp/commit/0c7aac3f55172467123edf5c9c545ab7ca1df822))
* **readme:** make Quick Start agent-agnostic ([982c4ac](https://github.com/torsday/omnifocus-mcp/commit/982c4ace406989a88457341b071071a01f39d738))
* **runner:** add runner-setup guide for macos-omnifocus auto-start ([#443](https://github.com/torsday/omnifocus-mcp/issues/443)) ([8a6273d](https://github.com/torsday/omnifocus-mcp/commit/8a6273dee7fb8862aa2963f6b48a3e31c7485824))

## [Unreleased]

_Nothing yet — see [GitHub Issues](https://github.com/torsday/omnifocus-mcp/issues) and [Project #4](https://github.com/users/torsday/projects/4) for the live backlog and status._

---

## [1.0.0] — 2026-04-25

**Summary** — First public release of `@torsday/omnifocus-mcp`. Ships the full MCP surface for OmniFocus on macOS: 80 typed tools, 10 read-only resources, and 4 workflow prompts. Every tool returns the uniform `{ data, meta } | { error, meta }` envelope per ADR-0013, with typed errors carrying `suggestion` and `remediationClass`. Mutation tools support optimistic concurrency (`expectedModifiedAt`), dry-run preview, and idempotency keys. A live database watcher drives targeted cache invalidation.

**Install**

```jsonc
// Claude Desktop or Claude Code MCP config
{
  "mcpServers": {
    "omnifocus": {
      "command": "npx",
      "args": ["-y", "@torsday/omnifocus-mcp@1.0.0"]
    }
  }
}
```

Verify with `npx -y @torsday/omnifocus-mcp@1.0.0 --version`.

**Compatibility** — Node 24+ • macOS 12+ (Monterey, Ventura, Sonoma, Sequoia) • OmniFocus 4.x • MCP protocol 2024-11-05

### Tool surface (80 tools)

Full catalog with parameter tables and example responses: [`docs/tools.md`](./docs/tools.md).

- **Tasks** — list, get, get-many, search (cursor-paginated; optional keyword plus `available` / `dueBefore` / `dueAfter` / tag / project filters), create, update, complete, uncomplete, drop, undrop, delete (requires `confirm: true`), move, reorder, duplicate, batch create / update / complete / delete / drop
- **Projects** — list, get, get-many, create, update, delete, move, set-status, review-set
- **Tags** — list, get, get-many, create, update, delete
- **Folders** — list, get, create, update, delete
- **Perspectives** — list, evaluate (seven built-ins; OmniFocus Pro custom perspectives via OmniJS)
- **Forecast** — get (`date` + `days` ergonomic interface, or raw `from`/`to` range; multi-day responses include `byDate[]`)
- **Review** — list-due, mark-reviewed
- **Notes** — get, set, append
- **Attachments** — list, add, get, remove (path-validated against `OMNIFOCUS_ATTACHMENT_PATHS`)
- **Sync** — status, force-sync
- **OPML / TaskPaper** — `import_opml`, `export_opml`, `import_taskpaper`, `export_taskpaper`
- **Internal** — status, set-config
- **Escape hatch (opt-in via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`)** — `run_jxa_script`, `run_omnijs_script`; every invocation audit-logged

### Resources & prompts

- **10 read-only MCP resources** at `omnifocus://snapshot`, `omnifocus://inbox`, `omnifocus://project/{id}`, `omnifocus://tag/{id}`, … — agents can pass `_links` URIs from any tool response directly to `resources/read`. The snapshot payload includes `lastSyncAt` and `inFlight` so agents can detect stale data without a separate `sync_status` round-trip.
- **4 workflow prompts** — `daily-review`, `weekly-review`, `capture-meeting`, `project-planning`

### Mutation safety

- **`idempotency_key`** on every mutation — first call executes and caches the full envelope; retries within TTL replay verbatim with `meta.idempotentReplay = true`; concurrent calls coalesce onto a single in-flight promise. LRU+TTL store with env-tunable capacity (`OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES`, default 1024) and TTL (`OMNIFOCUS_IDEMPOTENCY_TTL_MS`, default 600 000).
- **`expectedModifiedAt`** — ISO-8601 optimistic concurrency guard. Rejects stale writes with `OF_CONFLICT` before touching OmniFocus.
- **`dry_run`** — returns a preview envelope with `meta.dryRun = true`; performs no mutation and no cache invalidation.
- **`confirm: true` on `task_delete` / `task_batch_delete`** — schemas require explicit confirmation before any adapter call runs, closing a class of accidental-permanent-deletion bugs.

### Performance & reliability

- **30s LRU read cache** invalidated on every mutation (ADR-0006) with thundering-herd coalescing on concurrent reads of the same key
- **Live database watcher** — native Swift `FSEventStream` binary streams change events for every `.ofocus` write; targeted `cache.invalidate` per changed object plus per-object `omnifocus://` resource notifications instead of a blanket clear
- **Per-tool sliding-window rate limiter** — default 120 calls / 60s, surfaced via `meta.rateLimit` on every response
- **Dual-threshold loop detector** — warns with `WARN_LOOP_DETECTED` at ≥5 identical calls / 60s; errors with `OF_LOOP_DETECTED` at ≥10
- **Circuit breaker** around the JXA and OmniJS transports — sustained failures fast-fail with `OF_CIRCUIT_OPEN`; closes again on a successful half-open probe
- **`ReadPool` + `WriteQueue`** concurrency primitives per ADR-0009 — bounded-concurrency reads (`OMNIFOCUS_READ_POOL_SIZE`, default 2); single-slot serial writes with soft-cap backpressure (`OMNIFOCUS_WRITE_QUEUE_CAP`, default 50) that throws `OF_QUEUE_FULL` when saturated
- **OmniFocus version gate** — lazy single-flight detection caches `{ version, edition }` on first probe; tools requiring Pro or a minimum version throw a typed `FeatureRequires*` error before any adapter call

### Type system & contracts

- **Branded ID types** (`TaskId`, `ProjectId`, `FolderId`, `TagId`) prevent cross-kind ID confusion (ADR-0008)
- **ISO-8601 with offset** date strings at all adapter boundaries (ADR-0007)
- **Uniform response envelope** — `{ data, meta }` on success, `{ error, meta }` on failure (ADR-0013)
- **`ResponseMeta`** carries `correlationId`, `durationMs`, `cacheHit`, `transport`, `ofVersion`, `syncPending`, `warnings`, `rateLimit`; plus optional `dryRun` and `idempotentReplay`
- **Typed error hierarchy** — `NotFound`, `ValidationError`, `PermissionDenied`, `OmniFocusNotRunning`, `Timeout`, `RateLimited`, `CircuitOpen`, `LoopDetected`, `Conflict`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`, `QueueFull`, `TransportUnavailable` — each with `code`, `suggestion`, and `remediationClass`
- **Structured warning codes** — `WARN_IDS_NOT_FOUND`, `WARN_RESULT_TRUNCATED`, `WARN_SYNC_PENDING`, `WARN_DEPRECATED_FIELD`, `WARN_DRY_RUN`, `WARN_LOOP_DETECTED`
- **Cursor pagination** with `filterHash` validation — swapping filters mid-sequence fails loud
- **`_links` navigation hints** on `Task` and `Project` — `omnifocus://noun/id` URIs for self, related project, parent, tags, and folder

### Security

- **Attachment path validator** — allowlist via `OMNIFOCUS_ATTACHMENT_PATHS` (default `$HOME`), symlink-escape protection, hard-deny on `/System`, `/Library`, `/private/System`, `/private/Library`
- **Raw-script tools opt-in only** — `run_jxa_script` and `run_omnijs_script` register only when `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`; every invocation emits an audit log event with the full script body (ADR-0004)
- **No network I/O** — enforced by a lint rule that forbids `http`, `https`, `node-fetch`, `axios`, `undici` imports
- **Stdout guard** — stray writes to stdout raise an error (MCP uses stdio; any byte corrupts the protocol)
- **No-metadata-interpolation custom lint rule** — user content (task names, notes, tag names) cannot appear in protocol metadata fields (`suggestion`, `error.message`, `meta.warnings`)
- **Config secrets redacted** from the `server.started` structured log event

See [`SECURITY.md`](./SECURITY.md) for the full security policy and reporting channel.

### Developer experience

- Generated tool catalog at [`docs/tools.md`](./docs/tools.md) — parameter tables, example calls, example responses; kept in sync via the `pnpm docs:check` CI gate
- Permission Denied troubleshooting runbook at [`docs/troubleshooting.md`](./docs/troubleshooting.md) covering macOS 12–15
- Property-based tests (fast-check) for cursor codec, `RepetitionRule` schema, transport-text parser
- Snapshot tests lock every tool description; a custom lint rule enforces the four-section description shape (what / when-not / returns / side-effects)
- E2E harness spawns the bundled server and speaks MCP over stdio
- Adapter contract test harness — every `OmniFocusAdapter` implementation must satisfy a parameterised suite (CRUD + filter semantics + typed errors)
- Transport chaos harness covers every DESIGN §19 failure mode (OmniFocus not running, automation permission denied, hard timeout, malformed JSON, `osascript` ENOENT, empty stdout, unclassified script error)

### Breaking changes

None. This is the initial release.

---

[Unreleased]: https://github.com/torsday/omnifocus-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/torsday/omnifocus-mcp/releases/tag/v1.0.0
