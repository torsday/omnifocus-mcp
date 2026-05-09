# ADR-0021: Reactive automation runtime — daemon + rule engine for autonomous LLM responses to OmniFocus changes

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

### 5. Use Claude Code (or another LLM CLI) as the always-on runtime

A natural question: if Claude Code can already work autonomously through
tickets via `/ship-next` loops, can it also *be* the always-on rules
engine? **No, for three structural reasons:**

- **The LLM is request-response, not event-driven.** The Anthropic API
  (and OpenAI, and any other) responds to requests; it does not subscribe
  to event streams. The FSEventStream watcher *is* event-driven, but
  something on the Mac has to *call* the API when an event arrives.
- **LLM CLIs are session-bound, not daemon-mode.** Claude Code, Codex
  CLI, Cursor, and the rest run for the duration of a terminal session.
  Closing the terminal terminates the loop. There is no `--daemon` flag
  that survives logout. launchd needs to own that lifecycle.
- **No tool use without an MCP client process.** Claude does not talk to
  OmniFocus directly — it talks through the v1 MCP server, which runs as
  an stdio child of an MCP client. Without a long-lived process owning
  that pipe, there is no way for Claude to act on events.

A user could pseudo-implement this with `/loop 30s reactive-rules-check`
in Claude Code, but that is **polling instead of event-driven** (worse
latency, more wasted API calls), **bound to the user's session**, and
billed for every poll regardless of whether anything actually changed.
Wrong shape.

The runtime in option 3 is "the missing piece between the watcher and
Claude" — a small, purpose-built daemon that owns the always-on
lifecycle, listens to the watcher, and invokes Claude (or any LLM) via
API when rules match. Most of the runtime is mechanical (debouncer, rule
matcher, audit log writer); the "thinking" part is delegated to Claude
through the API and is just one of several components.

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

### Worked example: end-to-end flow for a single change

A walk-through of the canonical scenario — terse iPhone capture, sharpened
on the home Mac before the user gets to their laptop — showing where each
runtime component fits and what data crosses each boundary.

1. **t=0 s — capture on iPhone.**
   User adds a task in OmniFocus iOS: title `"finance email"`, no project,
   no notes. Hits enter; iOS marks it dirty.

2. **t=0–8 s — iCloud sync.**
   iCloud Documents pushes the new task to all devices subscribed to the
   user's OmniFocus database. Latency varies (typically 2–30 s, depends on
   network); an `.ofocus` zip lands in
   `~/Library/Containers/com.omnigroup.OmniFocus4/Data/.../OmniFocus.ofocus`.

3. **t=8 s — FSEventStream fires.**
   The Swift watcher binary (already shipping in v1.0.0) sees the
   filesystem write and emits a JSON line on stdout:

   ```json
   {"detectedAt":"2026-04-26T14:30:08-07:00","changedPaths":[".../OmniFocus.ofocus"]}
   ```

   The runtime's `WatcherSubscriber` reads the line, parses, and pushes
   `ChangeContext{source:"icloud", detectedAt, changedPaths}` onto its
   internal event queue.

4. **t=8 s — debouncer holds the event.**
   The `Debouncer` records this event with key `(taskId, "task.created")`
   and starts a 30 s quiescence timer. If another change to the same task
   arrives before the timer fires (e.g. user is still typing on iPhone),
   the timer resets. If 30 s passes with no further writes, the event
   releases to the rule engine.

5. **t=38 s — rule engine matches.**
   The `RuleEngine` queries the runtime's MCP subprocess for the task
   detail (`task_get` over stdio) to get the full `Task` object — name,
   note, tags, projectId, dates, source. With the object in hand, it walks
   `rules.yml` top-to-bottom; the `sharpen-titles` rule's `where` clause
   matches (`source == inbox`, `title.length < 30`).

6. **t=38 s — idempotency check.**
   The engine checks its `(rule_id, task_id) → applicationCount` map.
   First time this rule has fired for this task; counter is 0 of 3
   allowed. Proceed.

7. **t=38–42 s — LLM call.**
   The engine assembles the rule's `system` prompt + the templated
   `context` (`title: "finance email"`) and calls the configured provider:

   ```http
   POST https://api.anthropic.com/v1/messages
   Authorization: Bearer <from Keychain>
   model: claude-3-5-sonnet-latest
   ```

   The model returns `{"title": "Email finance team — quarterly recon"}`.
   Latency: ~3.5 s; cost: ~280 tokens.

8. **t=42 s — apply via tool dispatcher.**
   The engine maps the rule's `apply: { field: title }` to a `task_update`
   call on the runtime's MCP subprocess:

   ```jsonc
   tools/call task_update {
     "id": "hKx9vLmNp2",
     "name": "Email finance team — quarterly recon",
     "idempotency_key": "rule:sharpen-titles:hKx9vLmNp2:1714150208",
     "expectedModifiedAt": "2026-04-26T14:30:00-07:00"
   }
   ```

   The v1 server invokes JXA, OmniFocus updates the task name, the
   response envelope confirms `meta.syncPending: true`. Note that the v1
   safety primitives (idempotency key + optimistic concurrency) come along
   for free — if the user re-edited the title on iPhone in the four
   seconds between the read and the write, the call returns `OF_CONFLICT`
   and the rule logs `apply.conflict` and skips gracefully.

9. **t=42 s — audit log entry.**
   The runtime appends one JSON line to `~/.omnifocus-mcp/audit.log`:

   ```json
   {"ts":"2026-04-26T14:30:42-07:00","ruleId":"sharpen-titles",
    "taskId":"hKx9vLmNp2","action":"title-rewrite",
    "before":"finance email","after":"Email finance team — quarterly recon",
    "tokens":{"prompt":120,"completion":160,"total":280},
    "durationMs":3640,"outcome":"applied"}
   ```

   The user can `tail -f ~/.omnifocus-mcp/audit.log` to watch the runtime
   work, or `grep '"outcome":"failed"'` to find regressions.

10. **t=42 s+ — eventual iCloud propagation.**
    OmniFocus's own iCloud sync pushes the rewrite back out within a few
    minutes. By the time the user opens OmniFocus on their laptop or
    iPhone next, the title is sharpened. The user never had to know the
    runtime existed.

Total wall time from iPhone capture to applied rewrite: **~42 s**,
dominated by the 30 s quiescence window and the 3.5 s LLM round-trip. No
part of the critical path is faster than the LLM call — design rules
accordingly.

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

#### 8. `js:` escape hatch — sandboxed via `isolated-vm` with allowlisted helpers (decided)

The `js:` escape hatch in the rules format runs user-supplied JavaScript
in the runtime's process space. Three options considered:

1. **Plain `eval` in the runtime process.** Full capabilities, no
   isolation. The user's `js:` block can `require('fs')`, exfiltrate the
   API key from Keychain, write outside `~/.omnifocus-mcp/`, anything else
   the runtime can do. **Rejected outright** — indistinguishable from
   "your rule file is your runtime configuration."
2. **No `js:` at all — pre-vetted allowlist.** Ship a fixed library of
   matchers and transforms (`title.contains`, `tags.has`, etc.); rules
   compose only from those. Safest, but the long-tail use cases (custom
   regex, computed dates, lookups in the task note) are exactly what the
   escape hatch exists for. **Rejected** as too restrictive.
3. **Sandboxed JS via [`isolated-vm`](https://github.com/laverdet/isolated-vm).**
   User code runs in a separate V8 isolate with no Node.js APIs by
   default. The runtime exposes a curated helper namespace
   (`of.{title, tags, project, dates}` plus `RegExp`, `Date`, `JSON`,
   string methods). The isolate has a memory cap (8 MB default) and
   execution-time cap (50 ms default) per `js:` evaluation. **Decided.**

The decision uses `isolated-vm` (not `vm2`, which had repeated
sandbox-escape CVEs and was deprecated by its maintainer in 2023). The
allowlist of helpers exposed inside the sandbox is documented as a
versioned API per ADR-0019: adding new capabilities is a minor version
bump on the runtime; removing capabilities is a major.

A `js:` block that times out, exceeds memory, or throws logs
`js.escape.aborted` in the audit log and falls through as a non-match —
never blocks the runtime, never crashes other rules.

#### 9. Implementation language — TypeScript on Node.js (decided)

The runtime targets TypeScript on Node.js, matching v1's stack. Four
options considered:

1. **TypeScript / Node.js (decided).** Same stack as v1, so the
   maintainer's primary expertise transfers directly; `isolated-vm`
   (sub-decision #8) is a Node.js native module with no peer in other
   languages at the same security-audit and maintenance bar; the
   Anthropic SDK is canonical in Node.js (`@anthropic-ai/sdk`); the
   runtime can directly import v1's domain types, error taxonomy, and
   envelope shape — eliminating duplication risk. YAML parsing, JSON
   Lines, file-watching, and child-process spawning are all trivial.
2. **Swift.** Familiar (we already ship a Swift binary for the
   FSEventStream watcher) and has first-class Keychain + launchd
   integration. **Rejected:** no mature sandboxed-JS solution
   (`JavaScriptCore` exists but doesn't match `isolated-vm`'s isolation
   guarantees); the community Anthropic Swift SDK lags the Node SDK by
   months on each protocol revision; can't share types with v1's TS.
3. **Go.** Single static-binary distribution would simplify install (no
   Node runtime needed on the user's Mac). **Rejected:** the Anthropic
   Go SDK lags; `v8go` is the closest `isolated-vm` equivalent but
   isn't security-audited at the same bar and has had quiet
   maintenance windows; no type sharing with v1; introduces a third
   language for the maintainer to context-switch into.
4. **Rust.** All Go's pros plus deeper safety guarantees and `rusty_v8`
   for sandboxing. **Rejected:** steepest learning curve; the
   Anthropic Rust SDK is community-maintained; iteration speed
   (compile times) hurts a phase-1-through-6 trajectory where the
   maintainer is learning while building.

The choice is largely **determined by sub-decision #8**: once the design
commits to a sandboxed JS escape hatch with `isolated-vm`, the host
language follows. The runtime's hot path (LLM call ~3.5 s + JXA write
~50 ms) is bottlenecked by network and OS — not by CPU or memory — so
the usual "Node is heavy for daemons" objection doesn't apply at
single-user scale. Node startup cost (~200 ms) is irrelevant for a
process that wakes on FSEvents debounced by 30 s.

**Distribution:** the runtime ships as a separate npm package
(`@torsday/omnifocus-mcp-runtime` or similar) with a `bin` entry. Users
install with `npx -y` or `npm i -g`, same model as v1. Requires Node ≥ 22
on the user's Mac, installable via Homebrew / asdf / nvm / fnm — same
prerequisite as v1.

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
  rule code (sandboxed via `isolated-vm` per sub-decision #8) and the
  always-on API key (covered in ADR-0017).

### Failure modes and recovery

The runtime is designed to fail loudly and recover automatically. Each
failure path below has an explicit handling strategy.

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| LLM API unreachable / 5xx | `Provider` returns error | `audit: llm.error`; rule emits `apply.skipped`; idempotency key **not** consumed | Retried on the next matching change; transient outage doesn't lose work |
| LLM API rate limit (429) | `Provider` returns 429 with `retry-after` | `audit: llm.rate_limited`; rule re-queued for the indicated window; subsequent rules in the same change continue | Auto-retried; if rate-limited 3× in a row, rule pauses for 1 hour |
| LLM returns malformed JSON | Output parser throws | `audit: llm.parse_error` with raw output; rule emits `apply.skipped` | Manual: user fixes the rule's prompt or output schema |
| `apply` returns `OF_CONFLICT` | v1's optimistic-concurrency guard | `audit: apply.conflict`; rule re-queued with fresh `expectedModifiedAt` from a new read; second conflict abandons the rule for this change | Auto-retry (1 attempt); the change isn't lost — next sync re-fires the rule with fresh state |
| `apply` returns any other typed error | v1's typed-error envelope | `audit: apply.error` with `code` / `suggestion` / `remediationClass`; **environment-class** errors pause the runtime; **input-class** errors skip the rule | Environment errors: user fixes (start OmniFocus, grant permission). Input errors: user fixes the rule. |
| Runtime crashes mid-evaluation | launchd's `KeepAlive` policy | launchd restarts the runtime; in-flight rule's idempotency key is **not** in the store yet, so it'll re-fire on the next change event | No data loss; at most one duplicate evaluation, caught by the idempotency budget |
| Watcher subprocess dies | Runtime detects EOF on watcher stdout | Runtime respawns the watcher; falls back to `fs.watch` (same fallback v1 already implements) for as long as the binary respawn keeps failing | Auto-respawn with exponential backoff; user notified via audit log if 5 consecutive respawns fail |
| Daily cost cap hit | Per-day token counter ≥ `dailyTokenCap` | `audit: cap.exceeded`; LLM actions are replaced with `skipped: cap_exceeded`; non-LLM actions continue | Auto-resets at 00:00 local time |
| Rules file fails to load (YAML syntax, schema invalid) | YAML parser or schema validator throws on `SIGHUP` reload | Runtime keeps the previous valid rules in memory; logs `rules.load_failed` with line number | User fixes the file; runtime loads on next `SIGHUP` or restart. **Production rules don't break on a typo.** |
| `js:` block times out / OOM / throws | `isolated-vm` traps the limit violation | `audit: js.escape.aborted` with rule ID and limit hit; rule's `where` is treated as non-match (rule does not fire) | User tunes the rule or raises the per-rule limit (configurable) |
| API key revoked / invalid | Provider returns 401 | `audit: auth.invalid`; runtime pauses **all** LLM rules and surfaces a clear error; non-LLM rules continue | User updates the Keychain entry; runtime resumes on next watcher event |

The general philosophy: **no failure silently drops a user's change.** The
watcher itself is the source of truth — any unhandled event will fire
again on the next sync. Rules that can't apply right now will get another
chance.

### Versioning

This is **not** v1.x scope. When implementation starts, increment to
v2.0.0 with the runtime as the headline feature. Per ADR-0011, daemon
mode + rule engine + new config surface = major version bump.

The v1 MCP server line continues evolving independently in v1.x while
v2.x adds the runtime layer on top.

## Phased implementation order

When M6 starts, build in this sequence — each phase ends in a working,
testable state. Phases 1–3 deliver a useful "mechanical rules engine"
without an LLM, which is a defensible v2.0-alpha shipping target if the
maintainer wants early feedback before the LLM phases land.

**Phase 1 — runtime skeleton** (~1–2 weeks)
- launchd LaunchAgent that spawns and supervises the runtime
- Watcher subscriber consuming events from v1's existing watcher binary
- Audit log writer (single JSONL file, no rotation yet)
- Static "log everything; do nothing" mode for live testing

**Phase 2 — debouncer + idempotency** (~1 week)
- Per-task quiescence window (default 30 s, configurable)
- `(rule_id, task_id) → applicationCount` map with TTL
- Hard-coded test rule for end-to-end validation

**Phase 3 — rules format** (~2 weeks)
- YAML loader with JSON-schema validation (`zod` already a project dep)
- `where` clause evaluator (matchers: equality, regex, length, etc.)
- `apply` clause dispatcher (field set, tag add/remove)
- **No LLM yet** — rules are still mechanical
- Shippable as `omnifocus-rules@2.0.0-alpha.1`

**Phase 4 — LLM provider** (~1–2 weeks)
- `Provider` interface
- Anthropic implementation (per sub-decision #3)
- API key from macOS Keychain (per ADR-0017 once written)
- Token counting + daily cap

**Phase 5 — `js:` escape hatch** (~1 week)
- `isolated-vm` integration
- Helper namespace (`of.{title, tags, project, dates}`)
- Memory + time limits with `audit: js.escape.aborted` on violation

**Phase 6 — polish** (~1–2 weeks)
- `omnifocus-rules` CLI: `start`, `stop`, `status`, `test <rule>`, `tail-audit`
- Audit log rotation (daily, 30-day retention default)
- Documentation: getting-started, rule cookbook, troubleshooting
- v2.0.0 release

Total: ~7–10 weeks calendar time for a single maintainer working
part-time.

## Cross-references

### Existing ADRs this design composes with

- [ADR-0006](./0006-read-cache-strategy.md) — read cache invalidated on
  every write; runtime's writes flow through the same path
- [ADR-0009](./0009-concurrency-pool-and-queue.md) — read pool / write
  queue; runtime's writes serialize through the same queue, no special
  handling needed
- [ADR-0011](./0011-versioning-and-stability.md) — version bump
  classification; new runtime is major
- [ADR-0013](./0013-tool-response-envelope.md) — the runtime consumes the
  same envelope as any other client

### Future satellite ADRs (to be written at M6 kickoff)

This ADR is intentionally a strategy hub. Several technical sub-areas
warrant their own ADRs when implementation actually starts — they'd
bloat this document past readability and have decisions that depend on
prototyping.

- **ADR-0017 — Reactive runtime secrets management.** Where the LLM API
  key lives (Keychain primary, env var fallback) and the threat model
  around its compromise. Must precede phase 4.
- **ADR-0018 — Rules-language schema and versioning.** The full YAML
  schema, validation rules, and how rules-format breaking changes are
  handled (migration tooling? deprecation cycles?). Must precede phase 3.
- **ADR-0019 — `js:` sandbox capabilities and helper API.** The exact
  surface exposed inside the `isolated-vm` sandbox; what's allowlisted,
  what's not, and the API stability contract for the helper namespace.
  Must precede phase 5.
- **ADR-0020 — Audit log format.** The JSON Lines schema, event types,
  rotation policy, and external-tooling contract (so users can pipe to
  `jq`, ship to a SIEM, etc.). Must precede phase 6.

### Other docs

- [DESIGN.md §18](../../DESIGN.md#18-security-posture) — trust posture
  the runtime must preserve
- [SECURITY.md](../../SECURITY.md) — reporting channel for any security
  concerns about this design

### Implementation files (already shipping in v1.0.0)

- `src/watcher/DatabaseWatcher.ts` — TypeScript subscriber + `fs.watch`
  fallback
- `tools/watcher/omnifocus-watcher.swift` — native FSEventStream binary
