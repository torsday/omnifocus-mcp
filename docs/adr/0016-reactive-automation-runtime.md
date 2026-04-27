# ADR-0016: Reactive automation runtime — daemon + rule engine for autonomous LLM responses to OmniFocus changes

**Date:** 2026-04-26
**Status:** Proposed — deferred until v1.x stabilizes

---

## Context

A maintainer or end user captures a task on their iPhone — terse, mid-walk:
`"finance email"`. iCloud syncs it to their home Mac within seconds. They'd
like an LLM running on the home Mac to "hear" the change, evaluate
user-defined rules ("if title is < 30 chars and inbox-only, rewrite as a
verb-phrase; saturate notes with context lifted from related tasks"), and
apply the result back to OmniFocus. By the time the user opens OmniFocus
on their laptop, the title is sharper and the notes are richer.

This is the canonical "reactive automation" scenario for a personal
task-management LLM. v1.0.0 has the **detection layer** (the native Swift
`FSEventStream` watcher binary detects every `.ofocus` write within ~100 ms
and emits `ChangeContext{source, detectedAt, changedPaths}`; mcpServer.ts
fires `notifications/resources/updated` on the affected `omnifocus://*` URIs).

What v1.0.0 lacks:

1. **Always-on runtime.** The MCP server is launched by an MCP client over
   stdio for the duration of that client session. When the client closes,
   the server exits. There is no daemon waiting for events.
2. **Autonomous LLM invocation.** The architecture is **pull**: agent asks
   → server answers. The server never reaches out to an LLM on its own.
   `notifications/resources/updated` tells a connected client "this changed,"
   but no shipped MCP client today autonomously invokes the LLM in response.
3. **Rule engine.** No "if-this-then-that" facility. Changes are detected;
   nothing acts on them.

The full scenario therefore needs a layer **above** v1's MCP surface —
a separate process that owns the always-on lifecycle, the rule
evaluation, and the LLM API calls.

## Comparable systems

This is not a novel pattern; the design is informed by three precedents:

- **Hazel** (Noodlesoft) — desktop file-system rule engine for macOS.
  Watches folders, matches conditions (name, kind, contents), applies
  actions. The closest analogue for "watcher + rules + actions" on the
  user's own machine. Runs as a launchd agent. Trust posture is local-only,
  no cloud, which matches our stated security posture.
- **Tasker** (Android) — task-trigger automation on mobile. More
  general-purpose; less directly applicable but informs the rule-language
  ergonomics question (declarative wins over scripts for common cases).
- **GitHub Actions / `on: push`** — server-side trigger-action pattern with
  workflow files in YAML. Informs the rules-format decision (YAML with a
  scripting escape hatch is a known-good pattern at scale).

The runtime is **Hazel for OmniFocus, with an LLM in the action layer**.
That framing is intentional — it's the simplest mental model for users
familiar with the macOS desktop-automation tradition.

## Options considered

### 1. Do nothing — the user keeps an MCP client open and prompts manually

**Cost:** zero. **Outcome:** the scenario doesn't happen. The user has to
open Claude / Codex / Cursor, paste an instruction, wait, repeat. The
"agent runs in the background while I live my life" affordance is the
whole point of the request, so this option is the no-op baseline.

### 2. Lean on the MCP client to do reactive work

Tell users "configure your MCP client to watch resource notifications and
re-prompt the model on each change." This pushes the always-on lifecycle
and the rule logic into the client.

**Cost:** zero implementation in this project; **but** no shipped MCP
client today (Claude Desktop, Claude Code, Codex CLI, Cursor, Windsurf,
Cline) does this. The MCP `notifications/resources/updated` message is in
the spec but clients use it for cache invalidation in their UI, not as an
autonomous-action trigger. Asking users to write a custom client is no
better than asking them to write a custom daemon — and we'd still own the
prompts, rules, and tool-call orchestration.

### 3. Build the runtime in this project (proposed)

A new always-on process — call it `omnifocus-mcp-runtime` or `omnifocus-rules`
— that:

1. Runs as a **launchd LaunchAgent** so it's always on when the user is
   logged in
2. Embeds the existing MCP server as a subprocess and listens on its
   `notifications/resources/updated` events
3. Loads a user-defined rules file (YAML, with a `js:` escape hatch)
4. On each change, evaluates rules; matched rules invoke an LLM via
   user-configured provider
5. Applies the LLM's structured output through the existing tool surface
   (`task_update`, `note_set`, etc.) — so all the v1 safety primitives
   (idempotency, dry-run, optimistic concurrency) carry over for free
6. Writes an audit log so the user can see "rule X rewrote task Y on
   2026-04-26T14:30:00 — diff attached"

### 4. Hand off to a generic agent framework (LangGraph, n8n, Zapier-MCP)

Make this a configuration story for an existing agent framework rather than
shipping our own runtime. The user wires our MCP into LangGraph or n8n; the
framework provides the daemon, rules, and LLM orchestration.

**Cost:** lower for us; **outcome:** users get a fragmented experience with
the trust posture of whichever framework they pick. None of those
frameworks ship a "polished offline-first secrets-stay-local" model that
matches the project's stated security posture (see #422 / SECURITY.md).
Worth revisiting later, but rejected for the v2 timeframe — owning the
runtime means owning the trust story.

## Decision

Adopt **option 3** as the v2 direction, scoped to a future milestone (M6).
**No implementation work begins until v1.x is stable** — i.e. release-please
has shipped at least three patch/minor releases without operational issues
and the post-1.0 backlog (currently 33 open issues across UX polish, new
resources, and ergonomic tools) has burned down to a manageable level.

This ADR is **Proposed** rather than **Accepted** because one of the seven
sub-decisions below (secrets management) is genuinely open and warrants its
own ADR when M6 starts. The other six are decided here.

### Architecture (committed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          User's Mac (always on)                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                 omnifocus-mcp-runtime                           │    │
│  │                 (launchd LaunchAgent)                           │    │
│  │                                                                 │    │
│  │  ~/.omnifocus-mcp/                                              │    │
│  │    rules.yml         ──► RuleLoader                             │    │
│  │    audit.log         ◄── AuditWriter                            │    │
│  │                                                                 │    │
│  │  Watcher subscriber ──► Debouncer ──► RuleEngine                │    │
│  │                                          │                      │    │
│  │                                          ▼                      │    │
│  │                                       LLM Provider (Anthropic)  │    │
│  │                                          │                      │    │
│  │                                          ▼                      │    │
│  │                                       Tool Dispatcher           │    │
│  └────────────────┬──────────────────────────┬────────────────────┘     │
│                   │                          │                          │
│                   │ stdio MCP                │ stdio MCP                │
│                   ▼                          ▼                          │
│  ┌──────────────────────────┐    ┌─────────────────────────────────┐    │
│  │  omnifocus-mcp (v1)      │    │  omnifocus-mcp (v1)             │    │
│  │  — runtime's subprocess  │    │  — user's MCP client subprocess │    │
│  │    for tool calls        │    │    (Claude / Codex / etc.)      │    │
│  └──────────────┬───────────┘    └────────────────┬────────────────┘    │
│                 │                                 │                     │
│                 └───────────┬─────────────────────┘                     │
│                             │ JXA + OmniJS                              │
│                             ▼                                           │
│                       ┌──────────┐                                      │
│                       │ OmniFocus│                                      │
│                       └──────────┘                                      │
│                                                                         │
│              (no network egress except the LLM API call)                │
└─────────────────────────────────────────────────────────────────────────┘
```

The runtime is a **client of v1's MCP server**, not a replacement.
Everything v1 already does (cache, rate limiter, typed errors, audit
logging, attachment guards) carries over. The runtime and the user's
interactive MCP client (Claude Desktop / Codex / etc.) coexist by each
spawning their own omnifocus-mcp subprocess — there's no resource
contention because OmniFocus serializes JXA writes through a single
queue per process and v1's adapter layer already handles concurrent
reads via the read pool.

### Sub-decisions

#### 1. Process model — subprocess (decided)

The runtime spawns v1's MCP server as a subprocess and speaks MCP over
stdio. v1 stays unchanged; no daemon mode added to the v1 binary.

**Rationale:** keeps the v1 binary's surface stable (one fewer
versioning concern); runtime can ship and version independently;
runtime can choose any MCP server version it wants (e.g. pin to a known
known-good v1.x while the server line continues evolving).

**Alternative rejected:** adding `omnifocus-mcp --daemon` flag. Couples
two lifecycles; complicates the v1 trust story (a stdio-only binary
becomes a process with its own listener); duplicates work the
process-supervision and config layers already need to live in the
runtime regardless.

#### 2. Rules format — YAML with `js:` escape hatch (decided)

```yaml
rules:
  - id: rewrite-short-inbox-titles
    on: task.created
    where:
      and:
        - source: inbox
        - title.length: { lt: 30 }
    do:
      - llm:
          model: claude-3-5-sonnet-20251022
          system: |
            Rewrite this short OmniFocus task title into a clear,
            actionable verb-phrase. Keep it under 60 characters.
            Output JSON: {"title": "..."}
          context:
            title: "{{ task.title }}"
        apply:
          field: title

  - id: tag-from-domain
    on: task.created
    where:
      js: |
        // Escape hatch when YAML can't express it.
        return task.note.match(/from: (\w+@\w+)/);
    do:
      - tags.add: ["@email"]
```

**Rationale:** YAML handles 90 % of rule shapes (matchers, simple
transforms, tag adds) with minimum cognitive load; `js:` escape hatch
covers the long tail without requiring a complete scripting language.
Same pattern that GitHub Actions uses for the same reason.

**Alternative rejected:** TypeScript-only rules. Higher floor for
non-developer users; rules become small programs with bugs and tests;
doesn't compose with a future GUI rule editor.

#### 3. LLM provider — Anthropic-first, abstraction from day one (decided)

v2.0.0 ships with Anthropic API support only. The internal `Provider`
interface is designed from the start to accept additional implementations
(OpenAI, Ollama, Bedrock, etc.) as follow-up work — but those don't ship
in v2.0.

**Rationale:** focuses initial effort on a single provider; the project
maintainer uses Anthropic; Anthropic's tool-use API maps cleanly onto
the apply-result step (LLM returns a structured object the runtime can
unpack into `task_update` calls).

**Alternative rejected:** ship multi-provider from day one. Triples the
testing surface; multi-provider config UX is a feature in itself; YAGNI
until the second user with a non-Anthropic preference shows up.

#### 4. API key management — see ADR-0017 (open; placeholder)

Where does the runtime's `ANTHROPIC_API_KEY` live? Plain config file,
encrypted file, macOS Keychain, env var? This is the design surface
where mistakes are most expensive (an exfiltrated key bills the user's
account silently). Lean: macOS Keychain via `security` CLI as the
primary path; env var as a development fallback; never plaintext in a
config file.

**This sub-decision is intentionally deferred** to a separate ADR-0017
("Reactive runtime — secrets management") to be written when M6
implementation actually starts. The other sub-decisions can be locked
in now without circling on this one.

#### 5. Loop / recursion safety — per-(rule, task) idempotency budget (decided)

v1's `LoopDetector` middleware sees per-tool call patterns; this is a
per-rule pattern that needs its own state. The runtime tracks a
`(rule_id, task_id) → { lastAppliedAt, applicationCount }` map with TTL
(default 24 h). A rule applies to a given task at most
`maxApplicationsPerTask` times (default 3) per TTL window. After that
the runtime logs a `loop.suspected` event and skips the rule.

**Rationale:** simple, observable, easy to reason about. Default `3`
covers iterative refinement (rewrite once, then improve once) plus
a margin; TTL of 24 h means the user gets a fresh budget daily.
`loop.suspected` events are the audit trail for tuning.

#### 6. Editing-conflict dampening — write-quiescence window (decided)

If the user is actively typing on iPhone, the watcher fires on every
keystroke-driven sync. The runtime applies a per-task **quiescence
window** (default 30 s): a rule fires only if the task has had no
writes for at least the window duration. This is implemented in the
debouncer between the watcher subscriber and the rule engine.

**Rationale:** the cost of waiting 30 s is invisible to the user (the
LLM call takes longer than that anyway); the cost of firing
mid-edit is a footgun (the LLM rewrites half a title). Configurable
per rule for cases where the user wants instant fire (e.g. cheap
non-LLM rules like `tags.add`).

#### 7. Cost budget — daily token cap with per-rule accounting (decided)

The runtime enforces a `dailyTokenCap` (default `1_000_000` tokens
across all rules combined) and a per-rule `dailyTokenCap` (no default;
opt-in for cost-sensitive rules). The audit log records token usage per
rule per call so the user can see what's expensive.

When the global cap is hit, the runtime continues to evaluate rules but
**replaces every LLM action with a `skipped: cap_exceeded` log entry**
until the next 00:00 local-time reset. The user's tasks aren't lost —
just not LLM-processed.

**Rationale:** soft cap with clear telemetry beats hard cap that blocks
the runtime entirely; per-rule cap lets users isolate runaway rules
without disabling the whole runtime.

### Concrete rule examples (illustrative, not exhaustive)

These are the rules the maintainer would actually write on day one of
M6 — used as the "minimum viable" target the design must support.

```yaml
rules:
  # Sharpen short inbox titles
  - id: sharpen-titles
    on: task.created
    where: { and: [{ source: inbox }, { title.length: { lt: 30 } }] }
    do:
      - llm:
          model: claude-3-5-sonnet-latest
          system: |
            Rewrite as a clear actionable verb-phrase. Keep it under
            60 chars. Output JSON: {"title": "..."}
          context: { title: "{{ task.title }}" }
        apply: { field: title }

  # Saturate notes when a task lands in a project but has empty notes
  - id: saturate-notes
    on: task.moved
    where:
      and:
        - destination.kind: project
        - note.length: 0
    do:
      - llm:
          model: claude-3-5-sonnet-latest
          system: |
            Given a task title and the project it just moved into, write
            a 2-3 sentence "context" note covering: who else might be
            involved, what success looks like, what could block it.
            Output JSON: {"note": "..."}
          context:
            title: "{{ task.title }}"
            project: "{{ task.project.name }}"
        apply: { field: note }

  # Auto-tag based on title patterns (no LLM — cheap rule, runs always)
  - id: auto-tag-email
    on: task.created
    where: { title: { regex: "(?i)\\b(reply|email|reach out|follow up)\\b" } }
    do:
      - tags.add: ["@email"]

  # Defer "someday" tasks
  - id: defer-someday
    on: task.created
    where: { title: { contains: "someday" } }
    do:
      - field.set: { deferDate: "{{ now + 30d }}" }
      - tags.add: ["someday"]
```

Reading the four rules above, a non-developer should understand the system.
That readability target is the rules-format design constraint.

### Non-goals (explicit)

- **Multi-user / multi-account.** v1 is single-user local-first; M6 stays
  that way. No SaaS, no multi-tenant, no shared rule libraries.
- **Cloud-hosted.** The trust posture from #422 (no cloud, no telemetry,
  no egress beyond LLM API calls) carries over. The runtime runs on the
  user's Mac.
- **Real-time UI / dashboard.** The audit log is a file, not a web UI. If
  someone wants a viewer, that's a follow-on tool — outside M6 scope.
- **Generic event sources.** The runtime watches OmniFocus, period. Email,
  calendar, file system are out of scope. Hazel handles file events;
  IFTTT-class tools handle the rest.
- **Cross-device coordination.** Two Macs running the runtime against the
  same iCloud account is undefined behavior in v2.0. Document a single-Mac
  recommendation; revisit if users actually hit this.

## Consequences

### Positive

- Unlocks the "agent runs in the background while I live my life" mode
  that's the natural successor to v1's pull-only architecture
- Reuses v1's safety primitives (idempotency, dry-run, optimistic
  concurrency) — the runtime composes the v1 tool surface; doesn't
  reinvent it
- The detection layer (database watcher) is already built and shipping
  in v1.0.0; the runtime is mostly orchestration on top
- Trust posture stays intact: nothing leaves the Mac except
  user-configured LLM API calls — and those are the user's choice,
  same as the LLM call any v1 MCP client makes
- Rules format is human-readable from day one; sets up a future GUI
  editor without trapping us in a TS-only design
- The runtime is independently versionable from the v1 server; we can
  ship rule-engine fixes without re-cutting an MCP server release

### Negative

- **Process-model shift.** v1 has a clean stdio-attached lifecycle and
  zero-credentials posture. The runtime is daemon-mode with its own
  API key. That's a real surface-area increase for security review.
- **Cost surface.** A misconfigured rule can burn API credits quickly.
  Mitigated by the daily-cap design but not eliminated — users will
  occasionally hit the cap.
- **Maintenance burden.** A new always-on component is more code to
  maintain, version, and support. The rule engine is non-trivial; the
  debouncer is non-trivial; the audit log format becomes a contract.
- **Support load.** Users will report "rule didn't fire" more often
  than the runtime actually misbehaved; need clear diagnostics in the
  audit log so users can debug their own rules.
- **Security review burden.** Two new threat surfaces: arbitrary user
  rule code (the `js:` escape hatch — sandbox or not?) and the
  always-on API key (covered in ADR-0017).

### Versioning

This is **not** v1.x scope. When implementation starts, increment to
v2.0.0 with the runtime as the headline feature. Per ADR-0011, daemon
mode + rule engine + new config surface = major version bump.

The v1 MCP server line continues evolving independently in v1.x while
v2.x adds the runtime layer on top.

## Cross-references

- [ADR-0006](./0006-read-cache-strategy.md) — read cache invalidated on
  every write; runtime's writes flow through the same path
- [ADR-0009](./0009-concurrency-pool-and-queue.md) — read pool / write
  queue; runtime's writes serialize through the same queue, no special
  handling needed
- [ADR-0011](./0011-versioning-and-stability.md) — version bump
  classification; new runtime is major
- [ADR-0013](./0013-tool-response-envelope.md) — the runtime consumes the
  same envelope as any other client
- [ADR-0017](./0017-runtime-secrets-management.md) — secrets management
  for the runtime's LLM API key (placeholder; to be written when M6
  implementation starts)
- [DESIGN.md §18](../../DESIGN.md#18-security-posture) — trust posture
  the runtime must preserve
- [SECURITY.md](../../SECURITY.md) — reporting channel for any security
  concerns about this design
- Live database watcher implementation — `src/watcher/DatabaseWatcher.ts`
  + `tools/watcher/omnifocus-watcher.swift` (already shipping in v1.0.0)
