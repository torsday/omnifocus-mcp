# ADR-0015: NL-excellence response envelope — kinds, hints, summaries

**Date:** 2026-04-26
**Status:** Accepted

---

## Context

The NL-excellence epic (#491) proposes five patterns that together turn the server from a competent tool surface into an active guide for an agent driving OmniFocus. Three of those patterns touch the response envelope defined in ADR-0013:

- **Hints on success** — every `ok` response can carry an optional `hints[]` array of suggested next-turn actions
- **Clarification-needed** — a third response variant for negotiation when the agent's request is ambiguous, distinct from "request was wrong" (`error`) and "request succeeded" (`ok`)
- **Echo-back summary** — every write returns a server-generated, human-readable one-liner of what happened, so the agent can quote the change to the user without reconstructing it from `data`

ADR-0013 froze the envelope shape (`data` / `meta` / `pagination` / `error`) and made it part of the v1 contract — additive changes at minor; rename or remove at major (per ADR-0011). All three NL-excellence dimensions are *additive*, but the shape and naming lock in for the long haul. The cost of a regret here is one major version. Deciding the shape five times across five tickets invites drift; deciding once, here, is cheaper.

Two of the five children of the epic — the intents resource (`omnifocus://intents`) and the inverse `*_describe` tools — do **not** touch the envelope; they are independent of this ADR and can land before or after.

This ADR is design-only. No code lands under #490; the three envelope-touching children (#491 / hints, clarification, echo-back) gate on this ADR being **Accepted**.

## Decision

### 1. `clarification-needed` is a new top-level response kind

The envelope grows a third variant alongside `ok` and `error`:

```typescript
interface ToolClarification {
  clarification: {
    code: string;                 // stable identifier from a small clarification taxonomy
    message: string;              // human-readable explanation of what's ambiguous
    questions: ClarificationQuestion[];  // 1..n; the agent picks one or surfaces them
    partial?: Record<string, unknown>;   // accepted-so-far slot values; the agent re-issues with these merged
  };
  meta: ResponseMeta;             // present, identical to `ok`/`error` shape
}

interface ClarificationQuestion {
  field: string;                  // dotted path into the input schema (e.g. "projectId", "due.timezone")
  prompt: string;                 // human-readable single-question prompt
  candidates?: Array<{            // optional small set of likely answers; agent or user picks one
    value: unknown;
    label: string;
    reason?: string;              // why this candidate; helps the agent rank without a re-read
  }>;
  allowFreeform?: boolean;        // default true; false means "must be a candidate"
}
```

Rationale for **new kind, not error sub-variant**:

- **Semantics:** clarification is a *negotiation*, not a failure. An `error` says "your request was wrong"; `clarification-needed` says "your request was reasonable but underspecified — here's what I need to commit." Conflating them forces every error-handler in every consumer to peek at a `code` to decide whether to surface to the user or re-prompt the agent.
- **Operational distinction:** `error.code = "needs-clarification"` is the kind of overloaded sentinel that ages badly. Logs, metrics, and SLOs already partition by envelope kind; a sub-variant requires every observability path to special-case it (or pretend it's an error and skew the error rate).
- **Prior art:** the same shape appears in conversational-form patterns (slot-filling) and MCP tool-result extensions in adjacent ecosystems; consumers will expect it as a peer of `ok`/`error`, not a flavor of error.

The cost is one extra branch in every consumer's switch. Acceptable: consumers ignoring unknown shapes still get safe behaviour (see §4 backward compat) — nothing crashes if a v1 consumer encounters a `clarification` envelope from a v1.x server, the `error` field is simply absent, and the existing `error` branch doesn't fire.

### 2. `hints[]` is an optional array on `ok` responses

The success envelope grows one optional field:

```typescript
interface ToolSuccess<T> {
  data: T;
  meta: ResponseMeta;
  pagination?: { /* unchanged from ADR-0013 */ };
  hints?: Hint[];                 // 0..N; absent and empty are equivalent
}

interface Hint {
  kind:                           // closed discriminator; new kinds are a minor version bump
    | "missing-detail"            // the result is good but a follow-up read would enrich the picture
    | "would-conflict"            // a likely-next mutation would conflict with current state
    | "next-natural-step"         // a tool that commonly follows this one
    | "consider-alternative"      // a better-fitting tool exists for what the agent likely wants next
    | "stale-data";               // the agent is operating on a cached/older view; refresh recommended
  reason: string;                 // human-readable, one short sentence; agent may quote
  suggestedTool?: string;         // canonical tool name; consumer may auto-route
  suggestedArgs?: Record<string, unknown>;  // partial args for `suggestedTool`; consumer fills the rest
  severity?: "info" | "warn";     // default "info"; "warn" means ignoring is risky but not blocking
}
```

**Emission policy — opt-in, per tool, per call site:**

- Hints are *opt-in per tool*. Tools that don't have a meaningful follow-up to suggest emit zero hints; the field is omitted (not set to `[]`) to keep the wire small.
- Hints are *opt-in per call site* — the same tool may emit hints on some inputs and not others. Tools deciding to emit hints follow the rule: hint only when the next action is non-obvious from `data` alone. Don't restate what the response already shows.
- **Soft cap:** ≤ 3 hints per response. Hints contribute to context consumption (see ADR-0013 risk on `meta.warnings` growth — same reasoning). If a tool finds more than 3, it picks the highest-severity 3 and may emit `meta.warnings: ["additional hints suppressed"]`. A hard cap is not enforced server-side; the soft cap is a code-review norm, lint-checkable later if it drifts.
- **Severity gate:** when `OMNIFOCUS_LOG_LEVEL=warn` or higher, only `severity: "warn"` hints are emitted. Default level keeps both. This is the operator's escape valve when a verbose tool floods context.

Rationale for the closed `kind` discriminator: agents (and humans reviewing logs) route hints by category. An open-ended string is harder to learn and impossible to lint. Adding a new kind is a minor-version bump per ADR-0011 (additive to a closed set is additive to the contract).

### 3. `humanReadableSummary` is a write-side `meta` field, opt-in for reads

Echo-back lives on `meta`, not on `data`:

```typescript
interface ResponseMeta {
  /* unchanged from ADR-0013 */
  correlationId: string;
  durationMs: number;
  cacheHit: boolean;
  transport: "jxa" | "omnijs" | "cache" | "memory";
  ofVersion: string;
  syncPending?: boolean;
  warnings?: string[];

  /* new in v1.x */
  humanReadableSummary?: string;  // server-generated one-liner; English; ≤ 140 chars
}
```

Placement and policy:

- **On `meta`, not on `data`:** the summary is *observability* about what happened, not *content*. Putting it on `data` would change every write tool's typed payload shape — that's both more invasive and conflates "what the system did" with "what the data says."
- **Mandatory on every write tool** (`task_create`, `task_update`, `task_complete`, `task_delete`, `project_create`, …). If a write tool ships without a summary, the contract is broken; lint-checkable. Examples:
  - `task_create` → `"Created task 'Buy milk' in project 'Errands' with due tomorrow."`
  - `task_complete` → `"Completed task 'Buy milk'."`
  - `task_batch_update` (3 items) → `"Updated 3 tasks: deferred 2 to next week, retagged 1 as @waiting."`
- **Opt-in for reads.** Read tools (`task_get`, `task_list`, `search_query`, …) may emit a summary when the read result is summarisable in a useful one-liner (e.g. `task_list` → `"Found 12 available tasks across 3 projects; 4 due this week."`). Most reads should *not* emit one — the agent's own summary is usually better-shaped to the user's question. Default: omit.
- **English, single-language, no i18n:** the field is stable and English-only until a future ADR introduces a localization strategy. The shape (`string`) can later become `string | { lang: string; text: string }[]` at a major version, but we won't paint ourselves into that corner now: consumers MUST treat the field as opaque, displayable, and possibly absent.
- **Length:** ≤ 140 chars (one tweet's worth). Long enough to summarise a batch operation; short enough that the agent can repeat it inline without crowding the user's transcript.
- **Determinism:** the summary is *generated*, not user-input — but it must be deterministic (same inputs → same string). Tools generate it from the response payload via plain string templating; no LLM calls server-side.

### 4. Backward compatibility — additive, no breaking change

Every dimension is additive to the v1 contract per ADR-0011:

- **`hints[]`** — new optional field on `ok`. v1 consumers that ignore unknown fields keep working unchanged. Consumers that schema-validate against a closed envelope shape break, but ADR-0013 explicitly opted *out* of closed-shape validation by making `meta.warnings`, `pagination`, etc. optional from day one. Same precedent applies.
- **`clarification` kind** — new top-level variant. v1 consumers route on `error ?? data` (the two existing branches). A `clarification` envelope has neither `data` nor `error` set, so a strict consumer falls through to its default branch — undefined behaviour, but not a crash. Tools that emit `clarification` MUST do so only on inputs where it's knowable that the agent expects clarification semantics; until v1.x adoption is widespread, tools default to `error` with `code: "OF_AMBIGUOUS_INPUT"` for the same condition. The `clarification` kind is opt-in per tool, not retroactively applied to existing error paths.
- **`humanReadableSummary`** — new optional `meta` field. v1 consumers ignoring unknown `meta` fields keep working. Consumers that pin `ResponseMeta` to a closed shape break — same caveat as `hints`.

The "no breaking change" guarantee: a v1.0 consumer continues to receive parseable, semantically-correct responses for every tool that doesn't opt into the new behaviours. Tools that *do* opt in produce responses that v1.0 consumers can still parse — they'll miss the hints, the summary, and any `clarification` envelopes (treating the latter as "no result, no error" which is consistent with the absence of those fields).

The bar for triggering a major bump: removing a field, renaming a field, narrowing a field's type, or making a previously-optional field mandatory. None of those happen here.

### Examples

**`ok` with hints:**

```json
{
  "data": { "id": "hPQ4RuKp9fW", "name": "Buy milk", "completed": false },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 8,
    "cacheHit": true,
    "transport": "cache",
    "ofVersion": "4.5.2"
  },
  "hints": [
    {
      "kind": "next-natural-step",
      "reason": "Task is currently in the inbox; routing it to a project usually follows.",
      "suggestedTool": "task_move",
      "suggestedArgs": { "id": "hPQ4RuKp9fW" }
    }
  ]
}
```

**`clarification` envelope:**

```json
{
  "clarification": {
    "code": "OF_PROJECT_AMBIGUOUS",
    "message": "Multiple projects match the name 'Errands'.",
    "questions": [
      {
        "field": "projectId",
        "prompt": "Which 'Errands' project did you mean?",
        "candidates": [
          { "value": "g7QmZRuKp9", "label": "Personal › Errands", "reason": "Active, 12 tasks" },
          { "value": "p3LnXRuKp9", "label": "Work › Errands (archived)", "reason": "Archived 2024-11-03" }
        ],
        "allowFreeform": false
      }
    ],
    "partial": { "name": "Buy milk", "due": "2026-04-27T17:00:00-05:00" }
  },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 3,
    "cacheHit": false,
    "transport": "memory",
    "ofVersion": "4.5.2"
  }
}
```

**Write with `humanReadableSummary`:**

```json
{
  "data": { "id": "hPQ4RuKp9fW", "name": "Buy milk", "project": { "id": "g7QmZRuKp9", "name": "Errands" } },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 47,
    "cacheHit": false,
    "transport": "jxa",
    "ofVersion": "4.5.2",
    "humanReadableSummary": "Created task 'Buy milk' in project 'Errands'."
  }
}
```

## Options Considered

| Option | Pros | Cons |
| --- | --- | --- |
| **Extend the envelope (chosen)** — new kind, optional `hints[]`, optional `meta.humanReadableSummary` | Single migration; consumers learn one shape; observability uniform across all NL-excellence dimensions; additive (no major version) | Three new optional fields lock in shape and naming; a regret is a major version |
| Keep envelope frozen + put NL-excellence in a sidecar resource (`omnifocus://nl-hints`) | Zero envelope churn; opt-in per agent | Loses correlation between hint and the call that produced it (agent must join by `correlationId`); doubles round-trips for hint-aware agents; clarification can't be a sidecar by definition (it's mid-call) |
| Bake hints into tool descriptions instead of responses | Static; no envelope change; cacheable client-side | Hints become inputs the agent reasons over once at tool-discovery time, not adaptive to the current call's data; defeats the purpose ("the next action depends on what just happened") |
| Agent-side memoization without server hints | Zero server change; agents already build context | Requires every agent to re-derive what the server already knows (e.g. that a task is in the inbox and usually wants routing next); duplicates work, drifts across agent vendors |
| `clarification-needed` as `error` sub-variant (`error.kind: "needs-clarification"`) | Minimum contract churn; existing error-handlers catch it | Conflates failure with negotiation; skews error-rate metrics; forces every consumer to peek at `code` to decide UX; ages badly as more clarification flavours arrive |

## Consequences

**Positive**

- One ADR governs three of five NL-excellence children — the migration story is "envelope grows three additive fields in v1.x" instead of three separate negotiations.
- `clarification-needed` makes ambiguous-input recovery first-class. Today a tool either guesses (silent wrong outcome) or errors with `OF_AMBIGUOUS_INPUT` (forces the agent to re-prompt without slot-filling state). Neither composes.
- `hints[]` lets the server share knowledge it already has — what tool usually follows, what's likely to conflict — without the agent having to re-discover it on every conversation.
- `humanReadableSummary` removes a class of agent error: reconstructing what just happened from `data` and getting the verb wrong (e.g. "marked X complete" when the actual change was a defer). The server is the authoritative narrator of its own writes.
- Observability stays uniform: every kind carries `meta.correlationId`, `meta.durationMs`, etc. New shapes don't break existing dashboards.

**Negative**

- Three new optional fields enlarge the contract surface. Future regrets cost a major version per ADR-0011.
- Tool authors now have a third response shape to consider (`clarification`). Without lint guards, drift is possible — a tool that *should* clarify will silently keep guessing.
- Echo-back summaries are English-only until a future i18n ADR. Non-English deployments display them verbatim or strip them; both are acceptable but neither is great.
- `hints[]` adoption is a per-tool effort. The contract permits zero hints; the philosophy expects them where useful. Risk of "shipped the field, never populated it" is real.

**Risks**

- **Risk:** consumers schema-validate against a closed envelope shape and break on `clarification` or unknown `meta` fields. *Mitigation:* DESIGN.md §12 already documents the envelope as "fields can be added"; the new shape extends the same pattern. Release notes for the first envelope-touching child call out the addition explicitly.
- **Risk:** hints flood context. *Mitigation:* soft cap of 3 per response; severity gate on log level; lint guard for tools emitting > 3 hints in tests (deferred to the implementation ticket, not this ADR).
- **Risk:** `clarification` kind drifts toward an "everything ambiguous" catch-all, eroding the distinction from `error`. *Mitigation:* a small clarification taxonomy (`OF_PROJECT_AMBIGUOUS`, `OF_TAG_AMBIGUOUS`, `OF_DUE_AMBIGUOUS`, …) defined at the implementation ticket; new codes added deliberately, not as a free-form string.
- **Risk:** echo-back summaries diverge from the actual change because the templating is wrong. *Mitigation:* every write tool's unit-test fixture asserts the summary against the response payload; lint-enforceable via `unit_tests.md`.
- **Risk:** `humanReadableSummary` becomes load-bearing for the agent (the agent quotes it directly to the user), which in turn makes its wording a contract of sorts. *Mitigation:* document explicitly in DESIGN.md §12 that the summary is *opaque to consumers* — they may display it but MUST NOT parse it for state. State lives in `data`.

## References

- `docs/adr/0008-ids-branded-opaque-strings.md` — branded ID types; `Hint.suggestedArgs` may carry IDs and inherits the same opacity contract
- `docs/adr/0011-versioning-and-stability.md` — stability rules; this ADR's three additions are minor-version-compatible
- `docs/adr/0013-tool-response-envelope.md` — uniform envelope this ADR extends
- `DESIGN.md` §12 — envelope shape; gets a forward-pointer to this ADR once accepted
- `agent_systems.md` — "rich responses" and "actionable errors"; clarification + hints + summary are three concrete instances
- [Issue #491](https://github.com/torsday/omnifocus-mcp/issues/491) — NL-excellence epic; this ADR gates three of its children
- [Issue #490](https://github.com/torsday/omnifocus-mcp/issues/490) — this ADR's tracking ticket
