#!/usr/bin/env bash
# =============================================================================
# create-issues.sh — bootstrap the omnifocus-mcp backlog as GitHub Issues
# =============================================================================
#
# Reads from TASKS.md (the source of truth) and creates one GitHub Issue per
# task using `gh issue create`. Issues are created in TASKS.md order; GitHub
# will auto-number them 1..N in the same order. The "Blocked by: #N" refs in
# each body assume this script is run once against an empty issue tracker.
#
# This script is idempotency-naive — running it twice produces duplicates.
# Intended to be run once, at project bootstrap, after labels and milestones
# already exist in the repo.
#
# Labels required (create beforehand):
#   type: feature | chore | spike | infra | docs | bug | test
#   P0 · critical | P1 · high | P2 · medium | P3 · low
#   size: XS | S | M | L | XL
#   risk: high | medium | low           (applied only when medium/high)
#   phase: M0 foundation ... M5 polish
#   domain: task | project | tag | folder | perspective | forecast | review |
#           search | note | attachment | repetition | batch | export | sync |
#           transport | observability | security | lifecycle | config |
#           resources
#
# Milestones required: M0 Foundation, M1 Core surface, M2 Metadata,
#                      M3 Advanced, M4 Long tail, M5 Polish
#
# Run from any directory:  bash scripts/create-issues.sh
# =============================================================================

set -euo pipefail

# --- sanity checks ----------------------------------------------------------

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not on PATH" >&2
  exit 1
fi

gh auth status >/dev/null 2>&1 || {
  echo "error: gh not authenticated. Run 'gh auth login' first." >&2
  exit 1
}

echo "gh authenticated; proceeding to create ~88 issues…" >&2

# --- helpers ----------------------------------------------------------------

# create_issue <title> <labels> <milestone>
# Reads the issue body from stdin (lets us use quoted heredocs cleanly).
# Echoes the created issue URL/number for operator visibility.
create_issue() {
  local title="$1"
  local labels="$2"
  local milestone="$3"
  local body
  body=$(cat)

  local url
  url=$(gh issue create \
    --title "$title" \
    --label "$labels" \
    --milestone "$milestone" \
    --body "$body")
  echo "created: $url"
}

# =============================================================================
# Milestone 0 — Foundation, both transports, operational guardrails
# Issues #1–#33
# =============================================================================

# ---- Issue #1 --------------------------------------------------------------
create_issue \
  "Validate JXA round-trip against live OmniFocus" \
  "type: spike,P0 · critical,size: S,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Before committing to JXA as the primary transport, verify end-to-end: we can shell out to `osascript -l JavaScript` from Node, run a trivial script against OmniFocus, and parse structured JSON back without corruption. This spike de-risks DESIGN §3 (transport options, ADR-0002) and unblocks the `JxaTransport` base class. Results feed into our understanding of cold p95 latency and UTF-8 edge cases.

## Acceptance Criteria

- [ ] A runnable proof script exists under `scripts/spikes/` that invokes JXA via `child_process.execFile` and returns parsed JSON
- [ ] Measured cold + warm round-trip latencies are captured in `docs/spikes/2026-04-jxa-spike.md`
- [ ] Failure modes documented: OF-not-running, permission-denied, malformed JSON, UTF-8 non-ASCII content
- [ ] Spike note names the go/no-go decision and any ADR updates needed
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Time box: 0.5 day. Produce only the minimum to answer the risk question.
- Write output to `docs/spikes/2026-04-jxa-spike.md`; link from ADR-0002 if findings change direction.
- See DESIGN §3 and §6.6 for the transport options and concurrency constraints.

## Dependencies

- Blocks: JxaTransport base class (#17) and everything downstream.
EOF

# ---- Issue #2 --------------------------------------------------------------
create_issue \
  "Validate OmniJS URL-scheme + callback-file pattern" \
  "type: spike,P0 · critical,size: S,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

OmniJS is load-bearing for M2 custom-perspective evaluation (per SPEC resolved-decisions and DESIGN §3/§9). We need to verify the URL-scheme invocation pattern (`omnifocus:///omnijs-run?script=…`) and the filesystem-callback result pattern work reliably from Node: p95 latency, timeout-when-OF-wedged handling, and race conditions on callback-file writes. This is the riskiest unknown in M0 and blocks `OmniJsTransport`.

## Acceptance Criteria

- [ ] Proof script under `scripts/spikes/` invokes OmniJS via URL scheme and retrieves a structured result via callback file
- [ ] Measured p50/p95 latencies, timeout behavior (simulate wedged OF), and concurrent-invocation collision outcomes captured in `docs/spikes/2026-04-omnijs-spike.md`
- [ ] Exact URL-scheme form confirmed or contradicted against Omni Automation docs; any deviation filed as an ADR update
- [ ] Failure modes enumerated: OF not running, permission, invalid script, callback-file permission
- [ ] Any required design pivot filed as a new ADR (e.g., alternate callback mechanism)
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Time box: 1 day.
- DESIGN §3 sentence: "exact URL form verified in M0 OmniJS spike before `OmniJsTransport` is written" — that's this spike.
- See ADR-0002 for the dual-transport decision.

## Dependencies

- Blocks: OmniJsTransport (#18), custom-perspective evaluation (#55), plugin_invoke (#74), run_omnijs_script (#75).
EOF

# ---- Issue #3 --------------------------------------------------------------
create_issue \
  "Publish @torsday/omnifocus-mcp@0.0.1 placeholder to claim the name" \
  "type: infra,P0 · critical,size: XS,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Per ADR-0012 (npx distribution), the canonical install channel is `npx @torsday/omnifocus-mcp`. Publishing a 0.0.1 placeholder secures the scope+name before anyone squats it. See DESIGN §23.

## Acceptance Criteria

- [ ] `@torsday/omnifocus-mcp@0.0.1` is live on npm (no functional code, just metadata + a stub bin)
- [ ] Stub binary prints a "not yet implemented" notice on stderr and exits non-zero

## Technical Notes

- One-way door; pick carefully. Keep the 0.0.1 bundle minimal.

## Dependencies

- Blocks: future release workflow (#82).
EOF

# ---- Issue #4 --------------------------------------------------------------
create_issue \
  "Initialise package.json, tsconfig.json, biome.json, vitest.config.ts, tsup.config.ts" \
  "type: infra,P0 · critical,size: S,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Stand up the TypeScript + Node 20 toolchain per ADR-0001. Establishes the build, test, lint, and bundle commands the rest of the backlog assumes. See DESIGN §6.2 (directory layout) and §25 (dependency inventory).

## Acceptance Criteria

- [ ] `pnpm install` succeeds from a clean clone
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all run (no files yet is fine; configs must be valid)
- [ ] `tsup` emits single-file ESM bundle to `dist/index.js` with shebang
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Exact version pinning in lockfile per DESIGN §25.
- Biome config encodes `coding.md` standards.

## Dependencies

- Blocked by: #3
- Blocks: everything else in M0.
EOF

# ---- Issue #5 --------------------------------------------------------------
create_issue \
  "Lint rules: forbid http/https/fetch/axios/undici imports; forbid \`as <ID>\` casts in domain code" \
  "type: infra,P0 · critical,size: S,phase: M0 foundation,domain: security" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §18 (security posture) and ADR-0008 (ID strategy), the server has zero network surface and IDs must flow through branded constructors. Enforce both by lint rather than review. See DESIGN §6.7 (error taxonomy) — also forbid generic `Error` throws.

## Acceptance Criteria

- [ ] `pnpm lint` fails on any import of `http`, `https`, `fetch`, `node-fetch`, `axios`, or `undici`
- [ ] `pnpm lint` fails on `as TaskId`/`as ProjectId`/etc. casts outside `src/domain/ids.ts`
- [ ] `pnpm lint` fails on `throw new Error(...)` outside `src/errors/`
- [ ] CI pipeline fails the PR on lint violations
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Biome custom rules or eslint overlay — pick whichever is less fragile.
- Add unit tests for each rule (positive + negative fixture).

## Dependencies

- Blocked by: #4
EOF

# ---- Issue #6 --------------------------------------------------------------
create_issue \
  ".claude/settings.json — permission allowlist and post-edit lint hook" \
  "type: infra,P1 · high,size: S,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Constrain what Claude Code can do in this repo (allowlist pnpm + gh; deny destructive rm) and run `pnpm lint --write` automatically after edits. Keeps velocity high without losing guardrails.

## Acceptance Criteria

- [ ] `.claude/settings.json` committed with a narrowly-scoped permission allowlist
- [ ] Post-edit hook runs biome format on changed files

## Technical Notes

- See `update-config` skill conventions.

## Dependencies

- None
EOF

# ---- Issue #7 --------------------------------------------------------------
create_issue \
  "GitHub Actions PR pipeline on macos-latest × Node 20/22 (typecheck, lint, build, unit)" \
  "type: infra,P0 · critical,size: M,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §20 (CI/CD), every PR to `main` runs on `macos-latest` across Node 20 and 22, and must pass typecheck/lint/build/unit before merge. Protects the `main` branch from drift.

## Acceptance Criteria

- [ ] `.github/workflows/pr.yml` runs on `macos-latest` with a Node 20 + 22 matrix
- [ ] Pipeline executes `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`
- [ ] Branch protection on `main` requires PR pipeline green
- [ ] Pipeline completes in under 3 minutes on a cold cache
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Integration tier is gated separately (#81) — do not run here.
- Use `actions/setup-node@v4` with `cache: pnpm`.

## Dependencies

- Blocked by: #4
- Blocks: integration CI (#81), release workflow (#82), bundle-size budget (#83).
EOF

# ---- Issue #8 --------------------------------------------------------------
create_issue \
  "Typed error hierarchy (OmniFocusError + full concrete classes)" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

DESIGN §6.7 defines the full error taxonomy as the authoritative list: environment, input, transient, infrastructure, and lifecycle classes. Every throw flows through these — generic `Error` is banned by lint (#5). The `code`/`suggestion`/`details` shape is what makes errors actionable per `agent_systems.md`. This is prerequisite for the response envelope (#15) and every service-layer error path.

## Acceptance Criteria

- [ ] `src/errors/index.ts` exports the complete hierarchy from DESIGN §6.7: `OmniFocusNotRunning`, `PermissionDenied`, `NotFound`, `ValidationError`, `ScriptError`, `TransportUnavailable`, `FeatureRequiresPro`, `FeatureRequiresOfVersion`, `CircuitOpen`, `QueueFull`, `Timeout`, `RateLimited`, `ServerShuttingDown`
- [ ] Each class carries `code` (string literal, exact values in DESIGN §6.7), default `suggestion`, and optional `details: Record<string, unknown>`
- [ ] Unit tests cover: `instanceof` chain, `code` stability, JSON serialization of `details`
- [ ] `RateLimited`/`QueueFull`/`CircuitOpen` are top-level classes, **not** subclasses of `ValidationError`
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Exact codes per DESIGN §6.7 — do not invent new ones.
- Export a discriminated union type `OmniFocusErrorCode` for exhaustive switch.

## Dependencies

- Blocks: response envelope helpers (#15), transports (#17/#18), every service.
EOF

# ---- Issue #9 --------------------------------------------------------------
create_issue \
  "Structured logger (pino → stderr) with PII redaction at info+" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §21 observability contract: JSON lines on stderr, never stdout. PII (task `name`, `note`, `noteHtml`, `tagNames`) redacted at `info` and above; visible only at `debug` or below. Pino redaction paths are declarative and fast.

## Acceptance Criteria

- [ ] `src/logging/logger.ts` exports a singleton pino logger writing to `process.stderr`
- [ ] Redaction paths cover `name`, `note`, `noteHtml`, `tagNames` (array path), applied at `info`+
- [ ] `OMNIFOCUS_LOG_LEVEL` env var tunes runtime level
- [ ] Unit tests assert: no writes to stdout; PII paths redacted at info; visible at debug
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Use pino `redact.paths` + `redact.censor`.
- See DESIGN §22 for env-var contract.

## Dependencies

- Blocks: stdout-write guard (#11), every tool invocation emission.
EOF

# ---- Issue #10 -------------------------------------------------------------
create_issue \
  "Correlation-ID generator (ULID) + per-request propagation" \
  "type: feature,P0 · critical,size: XS,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

DESIGN §21 requires a correlation ID on every event and in every envelope. Reuse client-supplied IDs when present; generate a ULID otherwise. ULIDs sort lexicographically, which helps log correlation.

## Acceptance Criteria

- [ ] Helper creates a correlation-ID context per MCP request (AsyncLocalStorage or equivalent)
- [ ] Reuses an incoming id if the MCP meta provides one; else generates a ULID
- [ ] Unit test proves per-request propagation into logger output

## Technical Notes

- Use `ulid` package (already in the dependency inventory).

## Dependencies

- None direct; used by logger (#9) and envelope helpers (#15).
EOF

# ---- Issue #11 -------------------------------------------------------------
create_issue \
  "Stdout-write guard: startup hook + integration test asserting zero bytes out" \
  "type: feature,P0 · critical,size: XS,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

Stdout is MCP's transport. A single stray byte corrupts the protocol. Per DESIGN §17 startup and §18 security, we hook `process.stdout.write` to throw on any non-MCP write, and add an integration test that runs the server for 5s and asserts zero bytes leaked.

## Acceptance Criteria

- [ ] Startup hook installs an assertion wrapper around `process.stdout.write`
- [ ] Integration test: spawn the server, exercise a trivial tool call, inspect stdout bytes — assert only MCP framing bytes are present
- [ ] Any `console.log` / `process.stdout.write` from our code is flagged by the hook
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- The MCP SDK itself writes to stdout legitimately — the guard must whitelist its path (e.g., via function-reference check or explicit enable-disable).

## Dependencies

- Blocked by: #9
EOF

# ---- Issue #12 -------------------------------------------------------------
create_issue \
  "Env-var config loader + startup validation" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: config" \
  "M0 Foundation" <<'EOF'
## Context

DESIGN §22 enumerates every env var the server consumes. Parse once at startup into a typed config object; invalid values fail startup loudly rather than at first tool call. No config file in v1.

## Acceptance Criteria

- [ ] `src/config/env.ts` validates and parses all DESIGN §22 vars with zod
- [ ] Invalid config exits 1 with a readable message on stderr
- [ ] Defaults match DESIGN §22 exactly
- [ ] Unit tests cover: missing vars → defaults, bad types → startup failure
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- `OMNIFOCUS_TOOL_RATE_LIMIT` uses `N/SECONDS` format — bespoke parser.
- Log a `server.started` event including a redacted config summary (hash path-shaped values per DESIGN §17).

## Dependencies

- Blocks: MCP bootstrap (#27), rate limiter (#24), cache (#21).
EOF

# ---- Issue #13 -------------------------------------------------------------
create_issue \
  "Branded ID types + constructors (TaskId, ProjectId, TagId, FolderId, AttachmentId)" \
  "type: feature,P0 · critical,size: XS,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

Per ADR-0008 and DESIGN §13, IDs are branded opaque strings. `TaskId` cannot be mistaken for `ProjectId` at compile time. Constructors validate non-empty + OF's conservative ID regex.

## Acceptance Criteria

- [ ] `src/domain/ids.ts` exports branded types and `.of(s)` / `.parse(s)` constructors
- [ ] Zod schemas produce branded values via `z.string().transform(...)`
- [ ] Unit tests cover the bug class: assigning a `TagId` to a `TaskId` parameter fails at compile time (dtslint-style)

## Technical Notes

- The lint rule in #5 forbids manual `as TaskId` casts outside this module.

## Dependencies

- Blocks: adapter interface (#16), domain schemas (#34), isoDateString helper adjacent.
EOF

# ---- Issue #14 -------------------------------------------------------------
create_issue \
  "isoDateString() zod helper — validates ISO-8601 with offset; rejects bare local" \
  "type: feature,P0 · critical,size: XS,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

DESIGN §14 and ADR-0007 pin the boundary to ISO-8601 with offset. Bare-local (`2026-04-19T12:00:00`) must be rejected. A shared zod refinement prevents each tool from re-implementing the check.

## Acceptance Criteria

- [ ] Helper accepts `2026-04-19T12:00:00Z` and `2026-04-19T12:00:00-05:00`
- [ ] Rejects bare-local, Unix epochs, and empty strings with a helpful message
- [ ] Unit tests cover positive and negative cases

## Technical Notes

- Regex-plus-Date-parse is fine; no luxon/date-fns needed.

## Dependencies

- Blocks: domain schemas (#34), pagination cursor (#35).
EOF

# ---- Issue #15 -------------------------------------------------------------
create_issue \
  "Response envelope helpers — ok() / err()" \
  "type: feature,P0 · critical,size: XS,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

DESIGN §12 and ADR-0013 define the uniform `{ data, meta, pagination? }` / `{ error, meta }` shape returned by every tool. Helpers keep the envelope consistent across 60+ tools.

## Acceptance Criteria

- [ ] `ok(data, meta?, pagination?)` returns a `ToolSuccess<T>` populated with correlationId, durationMs, transport, ofVersion, cacheHit
- [ ] `err(error, meta?)` accepts an `OmniFocusError` and produces a `ToolError`
- [ ] Unit tests lock the shape; snapshot the envelope on a representative success and error
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Duration, transport, cacheHit are injected by the handler harness, not inferred.

## Dependencies

- Blocked by: #8
- Blocks: every tool handler.
EOF

# ---- Issue #16 -------------------------------------------------------------
create_issue \
  "OmniFocusAdapter interface + InMemoryAdapter skeleton" \
  "type: feature,P0 · critical,size: M,phase: M0 foundation,domain: transport" \
  "M0 Foundation" <<'EOF'
## Context

The adapter interface is the sacred seam (DESIGN §6.1, §6.3). Services only see `OmniFocusAdapter`; never `osascript`, never URL schemes. `InMemoryAdapter` is the unit-test double. Contract tests (#30) assert behavioral substitutability. Scope of `InMemoryAdapter` is deliberately narrow — see DESIGN §19 "InMemoryAdapter contract scope".

## Acceptance Criteria

- [ ] `src/adapter/OmniFocusAdapter.ts` declares the full interface per DESIGN §6.3 (one method per SPEC functional requirement)
- [ ] `src/adapter/inMemory/InMemoryAdapter.ts` implements enough of the interface to support unit tests — CRUD on tasks/projects/tags/folders, filter application, NotFound/ValidationError
- [ ] Contract-test compatible (contract harness arrives in #30)
- [ ] Does not simulate `available`/`blocked` derivation, recurring-task cascade, perspective evaluation, sync, attachments, TaskPaper/OPML — those are integration-only (per DESIGN §19)
- [ ] Unit tests cover the deliberately-in-scope surface
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Methods use branded IDs, ISO-8601 strings, and typed errors at every return path.

## Dependencies

- Blocked by: #13
- Blocks: JxaTransport (#17), OmniJsTransport (#18), every service.
EOF

# ---- Issue #17 -------------------------------------------------------------
create_issue \
  "JxaTransport base class + script runner" \
  "type: feature,P0 · critical,size: M,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

`JxaTransport` is the primary OmniFocusAdapter implementation. Shells to `osascript -l JavaScript` with a single JSON argument per ADR-0005. Translates transport-level failures into typed errors (DESIGN §6.7). Carries the 30s default timeout (`OMNIFOCUS_JXA_TIMEOUT_MS`). See DESIGN §6.4 for script asset discipline.

## Acceptance Criteria

- [ ] `src/adapter/jxa/JxaTransport.ts` implements `OmniFocusAdapter` where JXA can reach (tasks, projects, tags, folders, forecast, search, sync, notes, repetition, attachments, review)
- [ ] `runScript(name, argsJson)` executes via `child_process.execFile` with hard timeout, kills the process on timeout, and surfaces `Timeout` error with transport tag
- [ ] Translates `OmniFocusNotRunning`, `PermissionDenied`, malformed JSON, non-zero exit codes into typed errors
- [ ] Scripts loaded at build time via the tsup loader (#28); no inline strings
- [ ] Contract tests pass (once #30 arrives)
- [ ] UTF-8 preserved end-to-end; `LANG=en_US.UTF-8` set in child env
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Single JSON arg via `process.argv[1]` inside JXA scripts; never shell interpolation (DESIGN §18 controls row).
- Measured latency on top of the #1 spike results — if p95 exceeds SPEC NFRs, escalate.

## Dependencies

- Blocked by: #1, #16
- Blocks: TransportRouter (#19), lifecycle manager (#25), chaos harness (#31), app_launch (#29).
EOF

# ---- Issue #18 -------------------------------------------------------------
create_issue \
  "OmniJsTransport base class with timeout, file cleanup, structured error handling" \
  "type: feature,P0 · critical,size: L,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

OmniJS is the fallback transport for features JXA cannot reach — custom perspectives (M2), generic plug-in invocation, and any feature the Omni Automation API exposes exclusively. Per DESIGN §3 and §16, it invokes the `omnifocus:///omnijs-run?script=…` URL scheme and reads back via a filesystem callback. Timeout default 45s (`OMNIFOCUS_OMNIJS_TIMEOUT_MS`). Separate queue from JXA per ADR-0009.

## Acceptance Criteria

- [ ] `src/adapter/omnijs/OmniJsTransport.ts` implements `OmniFocusAdapter` for OmniJS-only features; delegates the rest
- [ ] Callback-file path randomized per call; cleanup guaranteed on success and failure
- [ ] Hard timeout terminates the wait and emits `Timeout` error with `transport: "omnijs"`
- [ ] Translates wedged-OF, permission, malformed-callback-JSON into typed errors
- [ ] Serializes invocations via the dedicated OmniJS queue (#20)
- [ ] Integration test proves a trivial round-trip against live OF
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- URL form verified in #2 spike.
- Never pass arbitrary input via URL interpolation — base64url the JSON arg.

## Dependencies

- Blocked by: #2, #16
- Blocks: TransportRouter (#19), custom-perspective evaluation (#55), plugin_invoke (#74), run_omnijs_script (#75), chaos harness (#31).
EOF

# ---- Issue #19 -------------------------------------------------------------
create_issue \
  "TransportRouter — per-operation selection (implements OmniFocusAdapter)" \
  "type: feature,P0 · critical,size: M,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

`TransportRouter` is itself an `OmniFocusAdapter` that delegates per-method to `JxaTransport` or `OmniJsTransport`. Services see only the router. Keeps the seam clean (DESIGN §6.1) and lets us move operations between transports without touching services.

## Acceptance Criteria

- [ ] `src/adapter/router.ts` implements `OmniFocusAdapter`, holds references to both transports, routes each method to the correct one
- [ ] Routing table is a single literal object (one row per method → transport name) — auditable in one file
- [ ] Per-call `transport` metadata flows into the response envelope
- [ ] Contract tests (#30) pass against the router
- [ ] Unit tests cover the routing table with a stub JXA and stub OmniJS
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Follow DESIGN §3: JXA is the default; OmniJS for custom perspectives, plug-in invocation, and any JXA gaps discovered during implementation.

## Dependencies

- Blocked by: #17, #18
- Blocks: TaskService + M1 tool wiring (#36), sync_trigger (#73), plugin_invoke (#74), run_*_script (#75).
EOF

# ---- Issue #20 -------------------------------------------------------------
create_issue \
  "Read pool (2 slots) + write queue (single slot, cap 50) + OmniJS queue" \
  "type: feature,P0 · critical,size: M,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Concurrency model per ADR-0009 and DESIGN §16: small read pool (default 2), strictly-serialized writes (single slot, cap 50 pending → `QueueFull`), and a separate single-slot OmniJS queue because URL-scheme callbacks contend on the filesystem.

## Acceptance Criteria

- [ ] Read pool gates concurrent `osascript` invocations at `OMNIFOCUS_READ_POOL_SIZE` (default 2)
- [ ] Write queue serializes writes; cap `OMNIFOCUS_WRITE_QUEUE_CAP` (default 50); over-cap calls reject immediately with `QueueFull` + suggestion
- [ ] OmniJS queue is distinct from JXA queue; single slot
- [ ] Queue depths surfaced for `internal_status` (#77)
- [ ] Unit tests: saturation of each queue produces the expected error; normal flow preserves ordering
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Reads dirty-read the cache; writes must not block reads.

## Dependencies

- Blocked by: #17, #18
- Blocks: TaskService (#36), internal_status (#77).
EOF

# ---- Issue #21 -------------------------------------------------------------
create_issue \
  "LRU read cache with TTL + invalidation scope API" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: transport" \
  "M0 Foundation" <<'EOF'
## Context

ADR-0006 and DESIGN §6.5: 30s LRU (default), 256 entries, keyed by tool + serialized args. Mutations invalidate conservatively-scoped keys. The cache layer sits between service and adapter — never bypassed.

## Acceptance Criteria

- [ ] `src/cache/lruCache.ts` wraps `lru-cache` with `wrap(key, factory)` + `invalidate(scope)` APIs
- [ ] TTL comes from `OMNIFOCUS_CACHE_TTL_MS`; capacity from `OMNIFOCUS_CACHE_CAPACITY`
- [ ] Typed invalidation scopes: `task:${id}`, `project:${id}`, `forecast:*`, `perspective:*`, `search:*`, `tag:${id}`, `folder:${id}`
- [ ] `cache.invalidated` event emits after mutation (DESIGN §21)
- [ ] Stats surface for internal_status (#77)
- [ ] Unit tests: hit/miss/eviction, TTL expiry, scope invalidation matrix
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Cache keys must include filterHash so cursor pagination is stable (DESIGN §15).

## Dependencies

- Blocks: thundering-herd coalescing (#22), cache-invalidation wiring (#45).
EOF

# ---- Issue #22 -------------------------------------------------------------
create_issue \
  "Thundering-herd coalescing in cache layer" \
  "type: feature,P1 · high,size: S,phase: M0 foundation,domain: transport" \
  "M0 Foundation" <<'EOF'
## Context

Two identical in-flight reads should coalesce into one adapter call per DESIGN §16. Keeps JXA from fanning out under tool-call bursts.

## Acceptance Criteria

- [ ] Second concurrent call for the same cache key awaits the first's result rather than issuing a new adapter call
- [ ] Unit test: fire 10 identical `task_list` calls concurrently, assert 1 adapter invocation
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- "Pending requests" map keyed by cache key; clear on resolution or rejection.

## Dependencies

- Blocked by: #21
EOF

# ---- Issue #23 -------------------------------------------------------------
create_issue \
  "Per-tool circuit breaker" \
  "type: feature,P1 · high,size: S,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §6.10 and `agent_systems.md`: 3 consecutive failures per tool within 60s opens the circuit; 60s half-open test before re-enabling. Prevents a broken OF install from burning the agent's context in retries.

## Acceptance Criteria

- [ ] Per-tool breaker with states closed/open/half-open
- [ ] Opens on 3 consecutive failures within 60s; half-opens after 60s; single probe closes it
- [ ] While open, calls fail fast with `CircuitOpen` + wait-suggestion
- [ ] `circuit.opened` and `circuit.closed` events emitted (DESIGN §21)
- [ ] Unit tests over the full state machine

## Technical Notes

- State surface feeds `internal_status` (#77).

## Dependencies

- None direct; layered under the tool handler harness.
EOF

# ---- Issue #24 -------------------------------------------------------------
create_issue \
  "Per-tool rate limiter (default 30/60s, overridable)" \
  "type: feature,P2 · medium,size: S,phase: M0 foundation,domain: observability" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §16, per-tool rate limit rejects with top-level `RateLimited` (not ValidationError). Default generous per `OMNIFOCUS_TOOL_RATE_LIMIT` (`120/60` in DESIGN §22); TASKS notes 30/60s — use the DESIGN §22 default and make it overridable.

## Acceptance Criteria

- [ ] Token-bucket limiter per tool name using `OMNIFOCUS_TOOL_RATE_LIMIT`
- [ ] Exceeded calls reject with `RateLimited` + wait suggestion
- [ ] Unit tests over burst-allowed and sustained-rejection cases

## Technical Notes

- Distinct class from `ValidationError`, per DESIGN §6.7.

## Dependencies

- None direct.
EOF

# ---- Issue #25 -------------------------------------------------------------
create_issue \
  "Lifecycle manager — lazy OF detection, OF version cache, FeatureRequiresOfVersion gate" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: lifecycle,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §17, startup must be < 500ms and must not probe OF (to avoid permission-prompt storms). First tool call that needs OF triggers detection; the result caches `{ ofVersion, ofEdition }` for all future envelopes. Tools that require a minimum OF version consult the cache and throw `FeatureRequiresOfVersion`.

## Acceptance Criteria

- [ ] Lifecycle manager exposes `ensureOfAvailable()` (async) used by tools that need OF
- [ ] On first call, runs a tiny JXA probe; caches version + edition
- [ ] Subsequent calls are cached and near-free
- [ ] Emits `of.detected` event on first success (add to taxonomy if not yet present)
- [ ] `FeatureRequiresOfVersion` thrown when tool's `minimumVersion` > detected
- [ ] Unit tests: stub JXA transport to exercise the gate
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- `meta.ofVersion` flows through response envelope helpers (#15).

## Dependencies

- Blocked by: #17
EOF

# ---- Issue #26 -------------------------------------------------------------
create_issue \
  "Graceful shutdown — SIGINT/SIGTERM drain in-flight, reject new, flush logs" \
  "type: feature,P1 · high,size: S,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §17 shutdown sequence: stop accepting new calls (`ServerShuttingDown`), drain in-flight reads (5s grace), drain writes (10s grace), flush logger, exit 0.

## Acceptance Criteria

- [ ] SIGINT/SIGTERM both trigger the sequence
- [ ] New tool calls during drain receive `ServerShuttingDown`
- [ ] In-flight reads and writes complete or time out per grace windows
- [ ] Logger flushes before exit; `server.shutdown` event emitted with `reason` and `graceMs`
- [ ] Unit test simulates the lifecycle with a stub transport
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Unhandled exception path logs `fatal` and exits 1 (DESIGN §17).

## Dependencies

- None direct; consumed in the MCP bootstrap.
EOF

# ---- Issue #27 -------------------------------------------------------------
create_issue \
  "MCP server bootstrap over stdio — empty tool registry, initialize handler" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Stand up the MCP server on stdio (ADR-0010) with `@modelcontextprotocol/sdk`. No tools registered yet — they arrive in later issues. The `initialize` handler responds with server capabilities; ready for `tools/list` and `resources/list` once those are populated. DESIGN §17 pins startup to < 500ms.

## Acceptance Criteria

- [ ] `src/server/mcpServer.ts` boots the MCP server over stdio
- [ ] Responds to `initialize` with capabilities + server info + version
- [ ] `tools/list` returns empty array (populated later)
- [ ] Registers signal handlers that call the graceful-shutdown sequence (#26)
- [ ] Unit test: spawn the process, send `initialize`, assert the response
- [ ] Cold-start time < 500ms on a warm macOS
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Tool registry arrives from per-noun registrations in M1+.

## Dependencies

- Blocks: loop-detection middleware (#76), internal_status (#77).
EOF

# ---- Issue #28 -------------------------------------------------------------
create_issue \
  "Script-inlining build step (tsup loader for src/scripts/**)" \
  "type: feature,P0 · critical,size: S,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

ADR-0005: scripts are first-class source files. But they still need to be embedded in the bundled `dist/index.js` so the server doesn't depend on a reachable script directory at runtime. A tsup loader reads each `src/scripts/**/*.js`, stringifies its contents, and exposes it via an import.

## Acceptance Criteria

- [ ] `import task_list from './scripts/jxa/task_list.js'` returns the script source as a string at runtime
- [ ] Works for both JXA and OmniJS scripts
- [ ] Unit test loads a fixture script and asserts round-trip of content
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Tsup plugin API supports custom loaders. A light esbuild onLoad hook works.

## Dependencies

- Blocked by: #4
- Blocks: JxaTransport (#17), OmniJsTransport (#18).
EOF

# ---- Issue #29 -------------------------------------------------------------
create_issue \
  "app_launch tool (explicit, never automatic)" \
  "type: feature,P3 · low,size: XS,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Per SPEC out-of-scope ("Automatic OmniFocus launch"), we never surprise-launch OF. An explicit `app_launch` tool lets the agent launch OF when the user asks.

## Acceptance Criteria

- [ ] `app_launch` tool launches OF via a tiny JXA call
- [ ] Idempotent if OF already running
- [ ] Returns `{ launched: boolean, alreadyRunning: boolean }` in the envelope
- [ ] Unit test: stub transport; assert call path

## Dependencies

- Blocked by: #17
EOF

# ---- Issue #30 -------------------------------------------------------------
create_issue \
  "Adapter contract test harness — one suite, all implementations" \
  "type: test,P0 · critical,size: M,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §19, the same contract tests must run against `InMemoryAdapter`, `JxaTransport`, `OmniJsTransport`, and `TransportRouter`. This is how we guarantee they're behaviorally substitutable at the seam. Splits into unit tier (InMemory) and integration tier (real transports), gated by `OMNIFOCUS_INTEGRATION=1`.

## Acceptance Criteria

- [ ] `tests/contract/adapter.contract.ts` exports a parameterized suite taking an adapter factory
- [ ] Runs green against `InMemoryAdapter` in the unit tier
- [ ] Same suite is runnable against `JxaTransport`, `OmniJsTransport`, and `TransportRouter` under `OMNIFOCUS_INTEGRATION=1`
- [ ] Tests cover: task/project/tag/folder CRUD, filter semantics, NotFound/ValidationError error mapping
- [ ] Deliberately excludes `available`/`blocked` derivation, recurring cascade, perspective evaluation, sync, attachments, TaskPaper (integration-only per DESIGN §19)
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Document the split in `tests/README.md`.

## Dependencies

- Blocked by: #16
EOF

# ---- Issue #31 -------------------------------------------------------------
create_issue \
  "Chaos-injection harness for transport (OF-not-running, permission, timeout, malformed JSON)" \
  "type: test,P1 · high,size: M,phase: M0 foundation,domain: transport,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Per DESIGN §19, chaos tests cover the "unhappy-but-expected" paths at the transport layer: OF not running, permission denied mid-session, OF timeout, malformed JSON from a script. Ensures each surfaces as the correct typed error.

## Acceptance Criteria

- [ ] Harness can inject each failure mode into `JxaTransport` and `OmniJsTransport` independently
- [ ] Tests assert the typed error class, code, and suggestion for each failure
- [ ] Circuit breaker (#23) opens correctly under sustained failure

## Dependencies

- Blocked by: #17, #18
EOF

# ---- Issue #32 -------------------------------------------------------------
create_issue \
  "Integration seed-fixture script (scripts/seed-integration-db.js)" \
  "type: infra,P1 · high,size: M,phase: M0 foundation,domain: lifecycle,risk: medium" \
  "M0 Foundation" <<'EOF'
## Context

Integration tests need a reproducible OF database. Seed script populates known projects, tasks, tags, folders, perspectives, and attachments; idempotent; safe to re-run. See DESIGN §19.

## Acceptance Criteria

- [ ] `scripts/seed-integration-db.js` runs against a clean OF install and produces the fixture
- [ ] Re-running is idempotent (no duplicate creations)
- [ ] Documents preconditions (OF must be running) and exits cleanly if not
- [ ] README explains how to run it before `pnpm test:integration`

## Dependencies

- None direct.
EOF

# ---- Issue #33 -------------------------------------------------------------
create_issue \
  "Initial README.md with install + single usage example" \
  "type: docs,P2 · medium,size: XS,phase: M0 foundation,domain: lifecycle" \
  "M0 Foundation" <<'EOF'
## Context

Skeleton README that explains what this is, how to install, and a single working example. Expanded in M5 (#84).

## Acceptance Criteria

- [ ] README explains purpose (1 paragraph), install (`npx`), one example (`task_list`)
- [ ] Links to SPEC.md and DESIGN.md for deeper reading

## Dependencies

- None direct.
EOF

# =============================================================================
# Milestone 1 — Core task & project surface + pagination
# Issues #34–#48
# =============================================================================

# ---- Issue #34 -------------------------------------------------------------
create_issue \
  "Task + Project domain zod schemas matching docs/domain-reference.md" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: task,domain: project" \
  "M1 Core surface" <<'EOF'
## Context

Defines the zod/TS types for `Task` and `Project` per `docs/domain-reference.md`; downstream services require these before any CRUD is implemented. See DESIGN §13 (IDs) and §14 (dates) for the contracts. Uses branded IDs (#13) and `isoDateString()` (#14).

## Acceptance Criteria

- [ ] `src/domain/task.ts` and `src/domain/project.ts` export zod schemas and inferred types covering every field in `docs/domain-reference.md`
- [ ] Dates are ISO-8601 with offset; nulls used for "not set"
- [ ] Tag references are arrays of `TagId`; parent/child/ancestor relations use branded IDs
- [ ] Unit tests: round-trip parse from representative JSON, reject bad dates and naked strings where IDs are required
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Keep schemas in lockstep with `docs/domain-reference.md`; if that document is missing or out of date, fix it here and flag.

## Dependencies

- Blocked by: #13, #14
- Blocks: every M1 tool.
EOF

# ---- Issue #35 -------------------------------------------------------------
create_issue \
  "Pagination cursor codec — encode/decode {lastId, lastCreatedAt, filterHash}" \
  "type: feature,P0 · critical,size: S,phase: M1 core,domain: transport" \
  "M1 Core surface" <<'EOF'
## Context

DESIGN §15 pins cursor-based pagination with a filterHash for stability. Cursors are opaque to clients, base64url-encoded internally, and sortable-by-`(createdAt ASC, id ASC)`.

## Acceptance Criteria

- [ ] Encode/decode helpers with explicit error on filterHash mismatch (ValidationError)
- [ ] Stable sort order: `created > lastCreatedAt OR (created == lastCreatedAt AND id > lastId)`
- [ ] Unit tests round-trip representative cursors and reject tampered ones
- [ ] Property tests (#67) consume this codec

## Technical Notes

- filterHash derives from sha256 of the sorted filter object — stable across runs.

## Dependencies

- Blocked by: #14
- Blocks: task_list (#36), search_query (#57), property tests (#67).
EOF

# ---- Issue #36 -------------------------------------------------------------
create_issue \
  "TaskService + task_list (with filters + pagination)" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: task,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

`task_list` is the reference tool (DESIGN §26): filters by project, tag, flagged, available, blocked, completion, date ranges, parent. Cursor pagination with default limit 200; unbounded queries rejected with a validation error asking for a filter or limit (DESIGN §15). `TaskService` wraps the cache (ADR-0006) around the adapter call.

## Acceptance Criteria

- [ ] `task_list` tool registered with the exact schema and description from DESIGN §26
- [ ] Filters: `projectId`, `tagIds`, `flagged`, `available`, `completed` (any/only/exclude), `dueBefore`, `dueAfter`, `deferredBefore`, `parentId`, `limit` (1..1000 default 200), `cursor`
- [ ] At least one of filter-or-limit-or-cursor required; otherwise ValidationError with suggestion "Provide a filter or a limit"
- [ ] Returns `{ data: { tasks }, meta, pagination }` envelope
- [ ] Unit tests (InMemoryAdapter): filters applied correctly; pagination stable across calls; unbounded query rejected
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Handler < 30 LOC (DESIGN §26).
- Cache key = (tool, filter) + filterHash.

## Dependencies

- Blocked by: #19, #34, #35
- Blocks: task_get (#37), task_update (#39), task_move (#41), notes (#62), MCP resources (#58), M1 test suites (#46/#47/#48).
EOF

# ---- Issue #37 -------------------------------------------------------------
create_issue \
  "task_get" \
  "type: feature,P0 · critical,size: S,phase: M1 core,domain: task" \
  "M1 Core surface" <<'EOF'
## Context

Single-task read by persistent ID, including its subtask tree. Never accepts a name (DESIGN §13). Cache-aware.

## Acceptance Criteria

- [ ] `task_get` tool accepts `{ id: TaskId, includeSubtasks?: boolean }` (default true)
- [ ] Returns `Task` or `NotFound` with actionable suggestion
- [ ] Unit tests cover happy path + NotFound

## Dependencies

- Blocked by: #36
EOF

# ---- Issue #38 -------------------------------------------------------------
create_issue \
  "task_create (inbox / project / subtask)" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: task,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Create a task in the inbox, a project, or as a subtask. All editable fields accepted at creation per SPEC "Tasks" and `docs/domain-reference.md`. Emits a cache invalidation for the target project's scope (DESIGN §6.5). Mutation note in tool description — not reflected to other devices until `sync_trigger`.

## Acceptance Criteria

- [ ] `task_create` tool with input schema covering name (required), projectId OR parentTaskId OR inbox (oneOf), plus optional note, flagged, dueDate, deferDate, estimatedMinutes, tagIds, sequential, completedByChildren
- [ ] Returns the new `TaskId` in `data`
- [ ] Conservative cache invalidation on the project scope
- [ ] Tool description documents: what it does, when not to (use task_batch_create for bulk), returns (id), side-effects (mutates; sync required for cross-device)
- [ ] Unit tests: happy paths for each target; ValidationError on bad input
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #34
- Blocks: task_parse_transport_text (#66).
EOF

# ---- Issue #39 -------------------------------------------------------------
create_issue \
  "task_update (all editable properties)" \
  "type: feature,P0 · critical,size: L,phase: M1 core,domain: task,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Update every editable task property per SPEC: name, plain note, flagged, due/defer/estimated, tags (add/remove semantics), sequential/parallel, completedByChildren. Rich-text note and repetition arrive in M3 (#63, #61). Mutation invalidates `task:${id}` and `project:${projectId}` plus `forecast:*`, `perspective:*`, `search:*` scopes.

## Acceptance Criteria

- [ ] Input schema is partial over the editable field set; unknown fields rejected
- [ ] Tag semantics: `tagIds` replaces; `addTagIds` and `removeTagIds` are additive (pick the simplest pair and document — default is replace if `tagIds` provided; add/remove if additive vars provided; never both in one call)
- [ ] Returns the updated `Task`
- [ ] Tool description covers: mutation, cache invalidation scope, sync-required-for-cross-device
- [ ] Unit tests cover each field plus ValidationError on invalid inputs
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- Rich-note (HTML) fields arrive in M3; v1 of this tool handles plain `note` only.

## Dependencies

- Blocked by: #36
- Blocks: task_move/reorder/duplicate (#41), cache invalidation wiring (#45), RepetitionRule wiring (#61), batch ops (#65), property tests (#67).
EOF

# ---- Issue #40 -------------------------------------------------------------
create_issue \
  "task_complete / task_uncomplete / task_drop / task_undrop" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: task" \
  "M1 Core surface" <<'EOF'
## Context

Four tools for task status transitions (distinct from deletion, which is a hard remove — see #93/#94 note in SPEC "Tasks"; we use `task_delete` for that). `task_drop` is a reversible status change per SPEC.

## Acceptance Criteria

- [ ] All four tools registered with consistent verb naming
- [ ] Each accepts `{ id: TaskId }` and optional `at?: isoDateString`
- [ ] Idempotent: completing an already-completed task returns success with `noChange: true`
- [ ] Cache invalidation covers task + project + forecast + perspective scopes
- [ ] Unit tests cover happy + idempotent paths

## Dependencies

- Blocked by: #34
EOF

# ---- Issue #41 -------------------------------------------------------------
create_issue \
  "task_move / task_reorder / task_duplicate (with recursive: boolean)" \
  "type: feature,P1 · high,size: M,phase: M1 core,domain: task,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Structural operations on tasks per SPEC. `task_duplicate` supports `recursive` to include subtasks. Also covers `task_find_by_name` (P2, ambiguity-aware) and `task_delete` (P1, irreversible) from the same SPEC "Tasks" section — combine where convenient, or split this issue if scope grows.

## Acceptance Criteria

- [ ] `task_move` moves a task to a different project, folder, or parent
- [ ] `task_reorder` positions a task within its parent
- [ ] `task_duplicate(recursive: boolean)` clones a task (and subtasks when recursive)
- [ ] `task_find_by_name` returns all matches (documented as ambiguity-aware; not the default lookup)
- [ ] `task_delete` hard-removes; tool description flags irreversibility; requires explicit `confirm: true` flag
- [ ] Cache invalidation correct for each operation

## Technical Notes

- Keep `task_delete` in this bundle because it rounds out the structural-ops surface; carries its own risk label in the milestone-1 review table (high).

## Dependencies

- Blocked by: #39
EOF

# ---- Issue #42 -------------------------------------------------------------
create_issue \
  "ProjectService + project_list (pagination) + project_get" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: project" \
  "M1 Core surface" <<'EOF'
## Context

Project read surface with pagination, mirroring `task_list`'s shape. Filters: folder, status (active / on-hold / done / dropped), flagged, review-due. `project_get` returns the project with its full task tree.

## Acceptance Criteria

- [ ] `project_list` supports folder, status, flagged, reviewDueBefore filters + cursor pagination
- [ ] Same "at-least-one-of filter/limit/cursor" refinement as task_list
- [ ] `project_get({ id, includeTaskTree?: boolean = true })`
- [ ] Unit tests against InMemoryAdapter
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #34
- Blocks: project_create/update (#43), project_move/complete/drop (#44), MCP resources (#58), review suite (#64), OPML export (#72), TaskPaper export (#71).
EOF

# ---- Issue #43 -------------------------------------------------------------
create_issue \
  "project_create + project_update (completion criteria, review interval)" \
  "type: feature,P0 · critical,size: M,phase: M1 core,domain: project" \
  "M1 Core surface" <<'EOF'
## Context

Create a project (root or in a folder) with completion criteria (parallel / sequential / single-action); update name, note, status, completion criteria, flagged, review interval, next review date. Per SPEC "Projects".

## Acceptance Criteria

- [ ] `project_create` accepts target (root/folder), completion criteria, and optional initial fields
- [ ] `project_update` is partial over the editable field set
- [ ] Cache invalidation for project + folder + review scopes
- [ ] Tool descriptions cover side-effects and sync note

## Dependencies

- Blocked by: #42
EOF

# ---- Issue #44 -------------------------------------------------------------
create_issue \
  "project_complete / project_drop / project_move (+ project_delete)" \
  "type: feature,P0 · critical,size: S,phase: M1 core,domain: project" \
  "M1 Core surface" <<'EOF'
## Context

Structural + status transitions on projects; plus `project_delete` (P1, irreversible). Bundled into one issue because the shape is repetitive across verbs.

## Acceptance Criteria

- [ ] `project_complete`, `project_drop`, `project_move` implemented
- [ ] `project_delete` requires `confirm: true` and is loudly flagged in the description
- [ ] Cache invalidation for each
- [ ] Unit tests cover happy + ValidationError paths

## Dependencies

- Blocked by: #42
EOF

# ---- Issue #45 -------------------------------------------------------------
create_issue \
  "Cache invalidation wired for all M1 mutations" \
  "type: feature,P0 · critical,size: S,phase: M1 core,domain: transport,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Every mutation in M1 must invalidate the right cache scopes (DESIGN §6.5). Central place to audit the scope matrix and add missing entries.

## Acceptance Criteria

- [ ] Invalidation matrix table committed to `docs/cache-invalidation.md` (one row per mutating tool, columns for each scope)
- [ ] Each M1 mutation tool calls the invalidation layer with the correct scope set
- [ ] Unit tests for each mutation assert the exact invalidation scopes
- [ ] `cache.invalidated` event emitted with the scope list

## Dependencies

- Blocked by: #21, #39
- Blocks: M2 and M3 mutations inherit this pattern.
EOF

# ---- Issue #46 -------------------------------------------------------------
create_issue \
  "M1 unit suite against InMemoryAdapter" \
  "type: test,P0 · critical,size: M,phase: M1 core,domain: task,domain: project" \
  "M1 Core surface" <<'EOF'
## Context

Happy + edge + error tests for every M1 service method (the Goldilocks standard in `coding.md`). Runs against `InMemoryAdapter` for < 10s total suite time (per SPEC success criteria).

## Acceptance Criteria

- [ ] Each M1 tool has happy, edge, and error tests
- [ ] Suite runs green in under 10s on macOS CI
- [ ] Coverage target per DESIGN §19: every error path in every service method is exercised

## Dependencies

- Blocked by: #36, #37, #38, #39, #40, #41, #42, #43, #44
EOF

# ---- Issue #47 -------------------------------------------------------------
create_issue \
  "M1 script-tier tests (each JXA script in isolation)" \
  "type: test,P0 · critical,size: M,phase: M1 core,domain: task,domain: project,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Per DESIGN §19 tier table, each JXA/OmniJS script has at least one test giving it input JSON and asserting output JSON. Gated on `OMNIFOCUS_INTEGRATION=1`.

## Acceptance Criteria

- [ ] Script-tier test exists for each M1 script (`task_list`, `task_create`, `task_update`, `task_complete`, `task_move`, `project_list`, `project_create`, `project_update`, `project_move`, `project_complete`)
- [ ] Tests pass under `OMNIFOCUS_INTEGRATION=1` against seed-fixture DB
- [ ] Suite runs in reasonable time (< 60s)

## Dependencies

- Blocked by: #36, #37, #38, #39, #40, #41, #42, #43, #44
EOF

# ---- Issue #48 -------------------------------------------------------------
create_issue \
  "M1 integration tests (gated on OMNIFOCUS_INTEGRATION=1)" \
  "type: test,P0 · critical,size: M,phase: M1 core,domain: task,domain: project,risk: medium" \
  "M1 Core surface" <<'EOF'
## Context

Full adapter-level integration tests — the same spec assertions as the unit tier, but against a live OF via `TransportRouter`. Uses the seed fixture (#32).

## Acceptance Criteria

- [ ] M1 integration suite runs green under `OMNIFOCUS_INTEGRATION=1 pnpm test:integration`
- [ ] Suite completes in under 2 minutes (per SPEC success criteria)
- [ ] Fails informatively when OF isn't running (skips with a clear message, doesn't hang)

## Dependencies

- Blocked by: #46, #32
EOF

# =============================================================================
# Milestone 2 — Metadata + custom perspectives (OmniJS-enabled)
# Issues #49–#59
# =============================================================================

# ---- Issue #49 -------------------------------------------------------------
create_issue \
  "Tag schema + tag_list + tag_get" \
  "type: feature,P1 · high,size: S,phase: M2 metadata,domain: tag" \
  "M2 Metadata" <<'EOF'
## Context

Tags per SPEC "Tags" and `docs/domain-reference.md`. List returns flat and hierarchical shape; get includes task count.

## Acceptance Criteria

- [ ] `Tag` zod schema + branded `TagId` (reuse #13)
- [ ] `tag_list` (with optional hierarchical output)
- [ ] `tag_get({ id })` returns tag + task count
- [ ] Unit tests against InMemoryAdapter

## Dependencies

- Blocked by: #16
- Blocks: tag CRUD (#50), tag locations (#51), MCP resources (#58).
EOF

# ---- Issue #50 -------------------------------------------------------------
create_issue \
  "Tag CRUD + set_status + set_allows_next_action" \
  "type: feature,P1 · high,size: M,phase: M2 metadata,domain: tag" \
  "M2 Metadata" <<'EOF'
## Context

Full tag CRUD: create (optional parent), update (name, parent), delete, move. Plus `tag_set_status` (active/on-hold/dropped) and `tag_set_allows_next_action` (OF flag).

## Acceptance Criteria

- [ ] `tag_create`, `tag_update`, `tag_delete`, `tag_move` implemented
- [ ] `tag_set_status`, `tag_set_allows_next_action` implemented
- [ ] Cache invalidation on tag + dependent task scopes
- [ ] Unit tests

## Dependencies

- Blocked by: #49
EOF

# ---- Issue #51 -------------------------------------------------------------
create_issue \
  "tag_set_location + tag_get_location (lat/lon/radius/trigger)" \
  "type: feature,P2 · medium,size: S,phase: M2 metadata,domain: tag,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

OF Pro supports location-based tags. Exposed per SPEC resolved-decisions; flagged as potentially unused in SPEC. See `docs/domain-reference.md` for the lat/lon/radius/trigger shape.

## Acceptance Criteria

- [ ] `tag_set_location({ id, lat, lon, radiusMeters, trigger })` and `tag_get_location({ id })` implemented
- [ ] `FeatureRequiresPro` returned on Standard installs
- [ ] Unit tests

## Dependencies

- Blocked by: #49
EOF

# ---- Issue #52 -------------------------------------------------------------
create_issue \
  "Folder CRUD (folder_list / get / create / update / delete / move)" \
  "type: feature,P1 · high,size: M,phase: M2 metadata,domain: folder" \
  "M2 Metadata" <<'EOF'
## Context

Folders hold projects (and other folders). Full CRUD per SPEC "Folders". Delete requires `confirm: true` and must handle the non-empty case explicitly.

## Acceptance Criteria

- [ ] `folder_list` returns folders with project counts
- [ ] `folder_get` returns a folder including its project + subfolder tree
- [ ] `folder_create`, `folder_update` (rename), `folder_move`, `folder_delete` implemented
- [ ] `folder_delete` rejects by default when non-empty; `cascade: true` explicit override
- [ ] Unit tests

## Dependencies

- Blocked by: #16
EOF

# ---- Issue #53 -------------------------------------------------------------
create_issue \
  "Perspective schema + perspective_list (built-in + custom)" \
  "type: feature,P0 · critical,size: S,phase: M2 metadata,domain: perspective" \
  "M2 Metadata" <<'EOF'
## Context

Lists every perspective the user has — built-in (Inbox, Forecast, Flagged, Projects, Tags, Review, Nearby) plus custom (OF Pro). `perspective_evaluate` arrives in #54 (JXA) and #55 (OmniJS).

## Acceptance Criteria

- [ ] `Perspective` zod schema per `docs/domain-reference.md`
- [ ] `perspective_list` returns both built-in and custom with a `kind` discriminator
- [ ] Custom perspectives include their filter JSON when available
- [ ] Unit tests

## Dependencies

- Blocked by: #16
- Blocks: perspective_evaluate (#54, #55), MCP resources (#58).
EOF

# ---- Issue #54 -------------------------------------------------------------
create_issue \
  "perspective_evaluate for built-in perspectives (JXA)" \
  "type: feature,P0 · critical,size: M,phase: M2 metadata,domain: perspective,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

Evaluates a built-in perspective by ID/name and returns the resulting task list. Built-ins go through JXA; custom go through OmniJS (#55).

## Acceptance Criteria

- [ ] Handles Inbox, Forecast, Flagged, Projects, Tags, Review, Nearby
- [ ] Returns `Task[]` with pagination
- [ ] Tool description explicitly says "built-in only; use perspective_evaluate for custom" — or we unify both verbs with a routing table (pick one; document)
- [ ] Unit tests
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #53
EOF

# ---- Issue #55 -------------------------------------------------------------
create_issue \
  "perspective_evaluate for custom perspectives (OmniJS)" \
  "type: feature,P0 · critical,size: L,phase: M2 metadata,domain: perspective,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

Load-bearing for this project (user lives in custom perspectives per SPEC resolved-decisions). Executes an OmniJS script that evaluates the perspective and serializes the task list back via the callback-file pattern (#2 spike, #18 transport).

## Acceptance Criteria

- [ ] Custom perspectives evaluated through `OmniJsTransport`
- [ ] Consistent output shape with built-in evaluator (pagination, Task[], envelope)
- [ ] Returns `FeatureRequiresPro` when the OF edition doesn't support custom perspectives
- [ ] Integration test: evaluate a known seeded custom perspective; assert non-empty task list
- [ ] Tool description routes agents to this tool specifically for custom perspectives — or the unified tool selects transport internally per #54's decision
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

- This is the primary reason OmniJS was promoted to M0 (SPEC/TASKS rationale).

## Dependencies

- Blocked by: #19, #53
EOF

# ---- Issue #56 -------------------------------------------------------------
create_issue \
  "forecast_get (range + include flags)" \
  "type: feature,P0 · critical,size: M,phase: M2 metadata,domain: forecast,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

Returns forecast-view tasks for a date range grouped by (overdue / due-today / deferred-today / flagged). Cached (30s) because it's the most common read. Per SPEC key flow "what's on my plate today".

## Acceptance Criteria

- [ ] `forecast_get({ from, to, includeDeferred, includeFlagged, includeOverdue })`
- [ ] Returns grouped `{ overdue, dueToday, deferredToday, flagged }` structure
- [ ] ISO-8601 dates throughout
- [ ] Unit tests + integration tests
- [ ] Cold p95 under SPEC's 600ms target (measured)
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #16
EOF

# ---- Issue #57 -------------------------------------------------------------
create_issue \
  "search_query (name / note / fulltext with filters + pagination)" \
  "type: feature,P1 · high,size: L,phase: M2 metadata,domain: search,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

Full-text search across task name + note with filters (project, tag, completion status, date range) plus cursor pagination. Per SPEC "Search".

## Acceptance Criteria

- [ ] `search_query({ q, scope: name|note|all, filters…, limit, cursor })`
- [ ] Cursor codec reused (#35)
- [ ] Unit + integration tests; integration exercises UTF-8 queries
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #35
EOF

# ---- Issue #58 -------------------------------------------------------------
create_issue \
  "MCP resources (inbox, forecast/today, project, tag, perspective)" \
  "type: feature,P1 · high,size: M,phase: M2 metadata,domain: resources" \
  "M2 Metadata" <<'EOF'
## Context

DESIGN §28: MCP resources are a distinct primitive (read-only, URI-addressable). Surfaces: `omnifocus://inbox`, `omnifocus://forecast/today`, `omnifocus://project/{id}`, `omnifocus://tag/{id}`, `omnifocus://perspective/{id}` (built-in + custom). Same cache and same service layer as the equivalent tools.

## Acceptance Criteria

- [ ] `resources/list` enumerates static + dynamic URIs; dynamic list is paginated
- [ ] Each URI returns `application/json` with the equivalent tool's `data` payload (no envelope)
- [ ] Invalidation follows the same scope matrix (#45)
- [ ] Unit tests and integration tests

## Technical Notes

- Resource URIs are part of the public contract (ADR-0011) — adding is minor, renaming is major.

## Dependencies

- Blocked by: #36, #42, #53
EOF

# ---- Issue #59 -------------------------------------------------------------
create_issue \
  "M2 script + integration tests including custom-perspective coverage" \
  "type: test,P0 · critical,size: M,phase: M2 metadata,domain: perspective,risk: medium" \
  "M2 Metadata" <<'EOF'
## Context

Locks the M2 surface against regressions with both script-tier and integration-tier tests. Must include a seeded custom-perspective case exercising the OmniJS path.

## Acceptance Criteria

- [ ] Script-tier test per M2 JXA/OmniJS script
- [ ] Integration test evaluates a seeded custom perspective and asserts output shape + non-emptiness
- [ ] Tests gated on `OMNIFOCUS_INTEGRATION=1`

## Dependencies

- Blocked by: #49, #50, #51, #52, #53, #54, #55, #56, #57, #58
EOF

# =============================================================================
# Milestone 3 — Repetition, notes, review, batch, transport text
# Issues #60–#67
# =============================================================================

# ---- Issue #60 -------------------------------------------------------------
create_issue \
  "RepetitionRule schema with cross-field validation" \
  "type: feature,P1 · high,size: M,phase: M3 advanced,domain: repetition,risk: medium" \
  "M3 Advanced" <<'EOF'
## Context

Repetition rules have inter-field constraints: `weekdays` only valid when `unit=weeks`; `monthlyAnchor` only when `unit=months`; etc. Per SPEC "Tasks" and key flow "updates a recurring task's repetition rule".

## Acceptance Criteria

- [ ] `RepetitionRule` zod schema with cross-field refinements
- [ ] Rejects invalid combinations with a helpful ValidationError
- [ ] Unit tests over the matrix of methods × units × steps × weekdays
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #34
- Blocks: repetition wiring (#61), property tests (#67).
EOF

# ---- Issue #61 -------------------------------------------------------------
create_issue \
  "Wire repetition into task_update + task_set_repetition + task_clear_repetition" \
  "type: feature,P1 · high,size: M,phase: M3 advanced,domain: repetition" \
  "M3 Advanced" <<'EOF'
## Context

Repetition is both a field on `task_update` (pass a full rule object) and two dedicated verbs: `task_set_repetition` and `task_clear_repetition`. The dedicated verbs keep per-field updates atomic and agent-friendly.

## Acceptance Criteria

- [ ] `task_update` accepts an optional `repetition: RepetitionRule | null` (null clears)
- [ ] `task_set_repetition({ id, rule })` and `task_clear_repetition({ id })` dedicated tools
- [ ] OF rejection surfaces as `ScriptError` with OF's message
- [ ] Unit tests cover set, clear, and invalid-rule rejection

## Dependencies

- Blocked by: #60
EOF

# ---- Issue #62 -------------------------------------------------------------
create_issue \
  "note_get / note_set / note_append (plain text)" \
  "type: feature,P1 · high,size: S,phase: M3 advanced,domain: note" \
  "M3 Advanced" <<'EOF'
## Context

Plain-text note read/write/append on tasks and projects. Rich-text (HTML) arrives in #63.

## Acceptance Criteria

- [ ] `note_get({ targetKind: task|project, id })` returns plain text
- [ ] `note_set`, `note_append` implemented with the same target shape
- [ ] Cache invalidation on the task/project scope
- [ ] Unit tests

## Dependencies

- Blocked by: #36
- Blocks: note_get_html/set_html (#63).
EOF

# ---- Issue #63 -------------------------------------------------------------
create_issue \
  "note_get_html / note_set_html (rich-text round-trip)" \
  "type: feature,P1 · high,size: M,phase: M3 advanced,domain: note,risk: medium" \
  "M3 Advanced" <<'EOF'
## Context

OF stores notes as rich text; per SPEC resolved-decisions we expose HTML fragment round-trip for fidelity. Plain read remains the default (#62).

## Acceptance Criteria

- [ ] `note_get_html` returns an HTML fragment (UTF-8)
- [ ] `note_set_html` accepts an HTML fragment; preserves OF's supported subset
- [ ] Integration tests cover a fidelity round-trip fixture (bold, link, list, inline image)
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #62
EOF

# ---- Issue #64 -------------------------------------------------------------
create_issue \
  "Review suite (review_list_due, review_mark_reviewed, review_set_interval, project_mark_reviewed)" \
  "type: feature,P1 · high,size: M,phase: M3 advanced,domain: review" \
  "M3 Advanced" <<'EOF'
## Context

Weekly-review workflow per SPEC "Review". `review_list_due` lists projects due for review sorted by `nextReviewDate`; `review_mark_reviewed` sets `nextReviewDate` from the interval; `review_set_interval` changes the schedule; `project_mark_reviewed` is a convenience alias on a single project.

## Acceptance Criteria

- [ ] All four tools implemented
- [ ] Cache invalidation on the review scope
- [ ] Unit tests cover happy + NotFound cases

## Dependencies

- Blocked by: #42
EOF

# ---- Issue #65 -------------------------------------------------------------
create_issue \
  "task_batch_create / task_batch_update / task_batch_complete (best-effort)" \
  "type: feature,P1 · high,size: L,phase: M3 advanced,domain: batch,risk: medium" \
  "M3 Advanced" <<'EOF'
## Context

Per SPEC key flow "bulk-creates 20 tasks": validation phase is atomic (all-or-nothing); execution phase is best-effort with per-index errors. One JXA round-trip for the execution phase. Response: `{ created: [...], failed: [...] }`. Not idempotent in v1.

## Acceptance Criteria

- [ ] `task_batch_create({ projectId?, tasks: CreateTaskInput[] })` rejects the whole batch if any input fails schema validation; execution phase returns per-index outcomes
- [ ] `task_batch_update` and `task_batch_complete` follow the same shape
- [ ] Exactly one JXA round-trip per batch (measured)
- [ ] Response includes both `created`/`updated`/`completed` and `failed` arrays with index + errorCode
- [ ] Integration tests cover the spec's edge cases (1 of 20 invalid, OF rejects mid-batch, duplicate retry caveat documented in description)
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #39
EOF

# ---- Issue #66 -------------------------------------------------------------
create_issue \
  "task_parse_transport_text (OF's transport-text DSL → task creates)" \
  "type: feature,P2 · medium,size: M,phase: M3 advanced,domain: task" \
  "M3 Advanced" <<'EOF'
## Context

OF's transport text: `Project: task @tag //note ::defer !! #due`. Parses to one or many task creates. Per SPEC "Tasks".

## Acceptance Criteria

- [ ] Parser handles all documented forms; returns an array of `CreateTaskInput`
- [ ] Ambiguity (e.g., tag not found) surfaces as warnings in `meta.warnings`, not hard errors
- [ ] Property tests (#67) exercise the parser
- [ ] Unit tests cover all forms

## Dependencies

- Blocked by: #38
- Blocks: property tests (#67).
EOF

# ---- Issue #67 -------------------------------------------------------------
create_issue \
  "Property tests — RepetitionRule schema, transport-text parser, cursor codec" \
  "type: test,P1 · high,size: M,phase: M3 advanced,domain: repetition,domain: transport" \
  "M3 Advanced" <<'EOF'
## Context

High-edge-case-density areas. fast-check property tests catch what example tests miss. Per DESIGN §19.

## Acceptance Criteria

- [ ] Property tests for RepetitionRule (valid/invalid combinations)
- [ ] Property tests for transport-text parser (round-trip on valid forms)
- [ ] Property tests for cursor codec (encode → decode → encode stability)
- [ ] Each passes at 100 runs minimum

## Dependencies

- Blocked by: #60, #35, #66
EOF

# =============================================================================
# Milestone 4 — Long tail: attachments, export/import, sync, plug-ins
# Issues #68–#75
# =============================================================================

# ---- Issue #68 -------------------------------------------------------------
create_issue \
  "Attachment suite (attachment_list / add / remove / save_to_path)" \
  "type: feature,P2 · medium,size: L,phase: M4 long-tail,domain: attachment,risk: medium" \
  "M4 Long tail" <<'EOF'
## Context

Attachments are paths, never bytes in MCP text responses (per CLAUDE.md and SPEC). `attachment_list`, `attachment_add(fromPath)`, `attachment_remove`, `attachment_save_to_path(toPath)`. See SPEC key flow "saves an attachment to disk".

## Acceptance Criteria

- [ ] All four tools implemented
- [ ] All paths go through the path-scope validator (#69)
- [ ] `attachment_add` enforces size cap (#70); rejects with ValidationError if exceeded
- [ ] `attachment_save_to_path` returns `{ saved, path, sizeBytes }`
- [ ] Integration tests cover the disk-full and NotFound edges
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #36
EOF

# ---- Issue #69 -------------------------------------------------------------
create_issue \
  "Attachment path-scope validator ($HOME default, OMNIFOCUS_ATTACHMENT_PATHS override)" \
  "type: feature,P2 · medium,size: S,phase: M4 long-tail,domain: security" \
  "M4 Long tail" <<'EOF'
## Context

DESIGN §18 controls: `fs.realpathSync` resolution **before** allowlist check, to defeat symlink escape. Default allowlist is `$HOME`; override via `OMNIFOCUS_ATTACHMENT_PATHS` (colon-separated).

## Acceptance Criteria

- [ ] Validator resolves symlinks before checking the allowlist
- [ ] Rejects paths under `/System`, `/Library`, and any path outside the allowlist with a clear reason
- [ ] Unit tests cover the symlink-escape attack and benign path cases

## Dependencies

- None direct; used by #68.
EOF

# ---- Issue #70 -------------------------------------------------------------
create_issue \
  "Attachment size cap enforcement (OMNIFOCUS_MAX_ATTACHMENT_MB)" \
  "type: feature,P2 · medium,size: XS,phase: M4 long-tail,domain: security" \
  "M4 Long tail" <<'EOF'
## Context

Default 100MB per SPEC resolved-decisions. Enforced on `attachment_add`.

## Acceptance Criteria

- [ ] `stat` the source path; reject files exceeding the cap with a helpful ValidationError
- [ ] Unit test at the boundary (just-under and just-over)

## Dependencies

- None direct.
EOF

# ---- Issue #71 -------------------------------------------------------------
create_issue \
  "TaskPaper export + import" \
  "type: feature,P2 · medium,size: M,phase: M4 long-tail,domain: export" \
  "M4 Long tail" <<'EOF'
## Context

Per SPEC "Export & import": export is lossy (no attachments, HTML notes, custom perspectives, tag locations, or non-simple repetition). Lossiness matrix lives in `docs/domain-reference.md`.

## Acceptance Criteria

- [ ] `export_taskpaper({ scope: project|folder|selection, id })` returns TaskPaper text
- [ ] `import_taskpaper({ text, targetContainerId })` creates tasks and returns `{ created: [...], warnings: [...] }`
- [ ] Lossiness warnings surface in the response's `meta.warnings`
- [ ] Integration tests cover a round-trip of the supported subset

## Dependencies

- Blocked by: #36, #42
EOF

# ---- Issue #72 -------------------------------------------------------------
create_issue \
  "OPML export" \
  "type: feature,P3 · low,size: S,phase: M4 long-tail,domain: export" \
  "M4 Long tail" <<'EOF'
## Context

Per SPEC — OPML represents structure + text only. Lower priority than TaskPaper.

## Acceptance Criteria

- [ ] `export_opml({ scope, id })` returns OPML text
- [ ] Unit + integration test covers a small project tree

## Dependencies

- Blocked by: #42
EOF

# ---- Issue #73 -------------------------------------------------------------
create_issue \
  "sync_trigger + sync_status" \
  "type: feature,P2 · medium,size: S,phase: M4 long-tail,domain: sync" \
  "M4 Long tail" <<'EOF'
## Context

`sync_trigger` asks OF to sync; `sync_status` returns last-sync time + outcome. Per SPEC "Sync" and every mutating tool's caveat about cross-device propagation.

## Acceptance Criteria

- [ ] Both tools implemented
- [ ] `sync_status` returns `{ at: isoDate, status: "ok"|"error", errorMessage? }` or `null` if never synced
- [ ] Unit + integration tests

## Dependencies

- Blocked by: #16
EOF

# ---- Issue #74 -------------------------------------------------------------
create_issue \
  "plugin_invoke (generic; no named wrappers in v1)" \
  "type: feature,P3 · low,size: M,phase: M4 long-tail,domain: perspective" \
  "M4 Long tail" <<'EOF'
## Context

Generic OmniJS plug-in invocation per SPEC resolved-decisions. No named wrappers in v1.

## Acceptance Criteria

- [ ] `plugin_invoke({ identifier, arg })` executes the plug-in via OmniJS
- [ ] Returns the plug-in's structured result
- [ ] FeatureRequiresPro where applicable
- [ ] Integration test against a seeded plug-in

## Dependencies

- Blocked by: #19
EOF

# ---- Issue #75 -------------------------------------------------------------
create_issue \
  "run_jxa_script / run_omnijs_script — opt-in, audit-logged, dangerous" \
  "type: feature,P2 · medium,size: M,phase: M4 long-tail,domain: security,risk: high" \
  "M4 Long tail" <<'EOF'
## Context

Per ADR-0004, the escape hatch is off by default and enabled via `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`. Every invocation emits a `raw_script.invoked` event at `info` with the full script body (DESIGN §21). Descriptions loudly flag danger. Only registered when the env var is set (DESIGN §17 startup step 4).

## Acceptance Criteria

- [ ] `run_jxa_script({ script, arg? })` and `run_omnijs_script({ script, arg? })` implemented
- [ ] Not registered in `tools/list` unless `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`
- [ ] Every invocation audit-logged at info with full script body
- [ ] Descriptions include prominent safety warnings
- [ ] Integration test asserts both (a) tools absent without the flag, (b) tools present with the flag
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- Blocked by: #19
EOF

# =============================================================================
# Milestone 5 — Polish, observability, release
# Issues #76–#88
# =============================================================================

# ---- Issue #76 -------------------------------------------------------------
create_issue \
  "Loop-detection middleware (repeat-call warning in response)" \
  "type: feature,P2 · medium,size: M,phase: M5 polish,domain: observability" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §6.11: track recent (tool, serialized-args) hash invocations; if ≥5 identical calls within 60s, the next response includes `{ warning: "identical_call_repeated", count, suggestion }`. Keeps agents from burning context in tight loops.

## Acceptance Criteria

- [ ] Middleware wraps every tool handler
- [ ] Warning appears in `meta.warnings` on the triggering call
- [ ] `loop.detected` event emitted (DESIGN §21)
- [ ] Unit tests: identical args → triggers after 5; different args → never triggers

## Dependencies

- Blocked by: #27
EOF

# ---- Issue #77 -------------------------------------------------------------
create_issue \
  "internal_status tool (uptime, OF version, cache stats, circuit states, queue depth)" \
  "type: feature,P2 · medium,size: S,phase: M5 polish,domain: observability" \
  "M5 Polish" <<'EOF'
## Context

DESIGN §21 metrics surface — the snapshot tool for operators. Returns `{ uptimeMs, ofVersion, ofRunning, lastSync, cache, circuits, queueDepth }`.

## Acceptance Criteria

- [ ] Tool returns the full snapshot shape
- [ ] No side effects; safe to call repeatedly
- [ ] Unit tests against stubbed subsystems

## Dependencies

- Blocked by: #27
EOF

# ---- Issue #78 -------------------------------------------------------------
create_issue \
  "Tool-description lint test — every tool matches what/when-not/returns/side-effects shape" \
  "type: test,P2 · medium,size: S,phase: M5 polish,domain: observability" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §6.8 and `agent_systems.md`: every tool description follows a consistent shape so agents can triage quickly.

## Acceptance Criteria

- [ ] Test iterates over registered tools and asserts the description contains: a what sentence, a when-not clause, a returns clause, and a side-effects clause
- [ ] Test fails the CI PR pipeline on violations
- [ ] Unit tests over the matcher itself

## Dependencies

- None direct.
- Blocks: snapshot tests (#79), docs/tools.md generation (#85).
EOF

# ---- Issue #79 -------------------------------------------------------------
create_issue \
  "Snapshot tests on tool descriptions" \
  "type: test,P2 · medium,size: S,phase: M5 polish,domain: observability" \
  "M5 Polish" <<'EOF'
## Context

Catches accidental drift in tool descriptions that might confuse agents. Per DESIGN §19.

## Acceptance Criteria

- [ ] Snapshot per tool committed
- [ ] Diff review required before updating a snapshot (standard vitest workflow)

## Dependencies

- Blocked by: #78
EOF

# ---- Issue #80 -------------------------------------------------------------
create_issue \
  "E2E harness — spawn server, act as MCP client, exercise each tool" \
  "type: test,P1 · high,size: L,phase: M5 polish,domain: lifecycle,risk: medium" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §19 tier 5: spawn the bundled server, drive it via MCP over stdio, exercise every tool. Gated on `OMNIFOCUS_E2E=1`. Final stop before release.

## Acceptance Criteria

- [ ] Test harness spawns `dist/index.js` and speaks MCP over stdio
- [ ] Every registered tool is invoked at least once
- [ ] Returns green under `OMNIFOCUS_E2E=1` against a seeded OF
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Dependencies

- None direct.
EOF

# ---- Issue #81 -------------------------------------------------------------
create_issue \
  "Integration CI workflow (manual + self-hosted runner optional)" \
  "type: infra,P2 · medium,size: M,phase: M5 polish,domain: lifecycle,risk: medium" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §20 `integration.yml`: manual dispatch + tag push, runs on a self-hosted macOS runner with seeded OF. Self-hosted runner is optional in v1 (contributors can run locally).

## Acceptance Criteria

- [ ] `.github/workflows/integration.yml` with `workflow_dispatch` + tag-push triggers
- [ ] Runs `OMNIFOCUS_INTEGRATION=1 pnpm test:integration`
- [ ] Works on a self-hosted runner labeled `macos-omnifocus`; degrades gracefully when no runner is available

## Dependencies

- Blocked by: #7, #32
EOF

# ---- Issue #82 -------------------------------------------------------------
create_issue \
  "Release workflow — tag push → build → pnpm publish --access public" \
  "type: infra,P1 · high,size: M,phase: M5 polish,domain: lifecycle" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §20 `release.yml`: tag push triggers build + publish + auto-generated GitHub Release notes (from `release_notes.md` prompt).

## Acceptance Criteria

- [ ] Triggers on tag push `v*.*.*`
- [ ] Runs the PR pipeline plus a publish step
- [ ] `pnpm publish --access public`; uses a repo secret for the npm token
- [ ] Creates a GitHub Release with notes
- [ ] Dry-run path (no tag) validates the pipeline without publishing

## Dependencies

- Blocked by: #7
EOF

# ---- Issue #83 -------------------------------------------------------------
create_issue \
  "Bundle-size budget check in CI (< 500 KB minified)" \
  "type: infra,P2 · medium,size: XS,phase: M5 polish,domain: lifecycle" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §20: the minified bundle must stay under 500 KB. Blocks release when exceeded.

## Acceptance Criteria

- [ ] CI step measures `dist/index.js` post-minify size
- [ ] Fails the pipeline if > 500 KB; prints current size vs budget

## Dependencies

- Blocked by: #7
EOF

# ---- Issue #84 -------------------------------------------------------------
create_issue \
  "Full README — install, Claude Desktop/Code config, permission, troubleshooting" \
  "type: docs,P1 · high,size: M,phase: M5 polish,domain: lifecycle" \
  "M5 Polish" <<'EOF'
## Context

Expand the M0 skeleton README (#33) into the ship-ready landing page. Must cover install (npx + global), Claude Desktop config snippet, Claude Code mcp add snippet, macOS Automation permission flow, and the permission-prompt recovery runbook link (#88).

## Acceptance Criteria

- [ ] README includes every section named in DESIGN §23
- [ ] Permission-denied recovery linked inline
- [ ] Example interactions (2-3 prompts → tool calls)

## Dependencies

- None direct.
EOF

# ---- Issue #85 -------------------------------------------------------------
create_issue \
  "docs/tools.md — generated reference of every tool with schema + example" \
  "type: docs,P2 · medium,size: M,phase: M5 polish,domain: observability" \
  "M5 Polish" <<'EOF'
## Context

A generated catalog so users can discover tools without running the server. Generator reads tool metadata + zod schemas and emits markdown.

## Acceptance Criteria

- [ ] Generator script `scripts/generate-tool-docs.ts` emits `docs/tools.md`
- [ ] One section per tool: name, description, input schema, example call, example response
- [ ] CI check verifies docs are up to date (regenerate + diff)

## Dependencies

- Blocked by: #78
EOF

# ---- Issue #86 -------------------------------------------------------------
create_issue \
  "Client config snippets — Claude Desktop, Claude Code, generic stdio" \
  "type: docs,P1 · high,size: S,phase: M5 polish,domain: lifecycle" \
  "M5 Polish" <<'EOF'
## Context

Ship-ready copy-pasteable config snippets for the three principal client targets (per SPEC resolved-decisions).

## Acceptance Criteria

- [ ] `docs/clients/claude-desktop.md` with working `mcpServers` snippet
- [ ] `docs/clients/claude-code.md` with `claude mcp add` command
- [ ] `docs/clients/generic-stdio.md` describing arbitrary stdio client setup
- [ ] Snippets verified end-to-end (agent can invoke `internal_status`)

## Dependencies

- None direct.
EOF

# ---- Issue #87 -------------------------------------------------------------
create_issue \
  "CHANGELOG + release notes for v1.0.0" \
  "type: docs,P2 · medium,size: S,phase: M5 polish,domain: lifecycle" \
  "M5 Polish" <<'EOF'
## Context

Per DESIGN §24 versioning contract, the `CHANGELOG.md` is required. Use the `release_notes.md` prompt to draft 1.0.0 notes.

## Acceptance Criteria

- [ ] `CHANGELOG.md` present, follows Keep a Changelog conventions
- [ ] 1.0.0 entry enumerates the full public surface
- [ ] Breaking changes section prepared (empty for 1.0.0)

## Dependencies

- None direct.
EOF

# ---- Issue #88 -------------------------------------------------------------
create_issue \
  "Permission-prompt recovery runbook (docs/troubleshooting.md)" \
  "type: docs,P2 · medium,size: S,phase: M5 polish,domain: security" \
  "M5 Polish" <<'EOF'
## Context

Per SPEC key flow "Cold start" and DESIGN §17: the first `osascript` invocation triggers the macOS Automation permission prompt. If the user denies or dismisses it, we need a runbook for recovery.

## Acceptance Criteria

- [ ] `docs/troubleshooting.md` has a Permission Denied section with step-by-step recovery (System Settings → Privacy & Security → Automation)
- [ ] Linked from README (#84) and from the `PermissionDenied` error's suggestion text

## Dependencies

- None direct.
EOF

echo ""
echo "done. Created 88 issues." >&2
