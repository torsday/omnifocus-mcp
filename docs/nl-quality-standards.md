# NL-quality standards

**Status:** Foundation. Per-tool audit, lint enforcement, and integration tests
land in follow-ups (see [#489](https://github.com/torsday/omnifocus-mcp/issues/489)).

This rubric is the floor every MCP tool in this server must meet. It exists
because *natural-language quality at the agent ↔ MCP boundary isn't automatic*:
the agent generates prose, we receive structured input validated against Zod,
and the surface-side levers below decide whether the agent's first translation
of "due tomorrow at 9 in EST" lands a task or a 400.

The five levers are independent and additive — a tool can score well on three
and still fail an agent's first attempt because of the other two. Score every
new tool against all five before opening a PR; new tools that fall short of
the floor block merge.

> **What this is not.** This rubric is downstream of [ADR-0013] (envelope
> shape) and [ADR-0015] (NL-excellence — `hints`, `clarification`,
> `humanReadableSummary`). Those decide what shape the response takes; this
> rubric decides whether each individual tool description, schema, and error
> message is something an agent can act on without a round-trip.

[ADR-0013]: ./adr/0013-tool-response-envelope.md
[ADR-0015]: ./adr/0015-nl-excellence-response-envelope.md

---

## The five levers

| # | Lever | What it controls |
|---|---|---|
| 1 | Schema descriptions | Whether the agent knows what each field means without a fetch |
| 2 | Worked examples | Whether the agent's first attempt is closer to a working call |
| 3 | Forgiving aliases | Whether common natural-language phrasings parse |
| 4 | Round-trip readability | Whether the agent can describe the response in one sentence |
| 5 | Fail-with-help errors | Whether a 400 tells the agent how to fix the call |

Each lever has a rule, an existing pattern in this codebase, and a way to
verify. The rule is the bar; the pattern shows what passes; the verification
is how a follow-up audit (or future lint) catches drift.

---

## 1 · Schema descriptions

Every Zod input field carries a `.describe(...)` string. The agent reads these
as part of the tool's input schema; a field with no `.describe(...)` shows up
as a typed slot with no semantic hint, and the agent has to guess from the
field name.

**Rule.** Every field in `inputSchema.shape` has `.describe(...)`. The string
is one sentence (under ~120 chars), explains what the field controls, and
points at how to obtain it when relevant.

**Pattern in this codebase.** [`src/tools/task/get.ts:31`][get-ts] —

```typescript
export const taskGetInputSchema = z.object({
  id: TaskId.schema.describe(
    "Persistent ID of the task to fetch. Get from task_list or task_get_many.",
  ),
  includeSubtasks: z
    .boolean()
    .optional()
    .describe("Include direct subtasks in the response. Default true."),
});
```

The `id` description tells the agent both *what* the field is and *where to
look* for a valid value. `includeSubtasks` notes the default — the agent
doesn't have to guess whether to send `true` to opt in or out.

**Anti-pattern.** A bare `z.string()` with no `.describe()`, or a description
that just restates the field name (`name: z.string().describe("name")`).

**Verification.** A future lint job (tracked in the follow-up issue for
`scripts/verify-nl-quality.sh`) walks every tool's input schema AST and fails
CI on any field lacking `.describe(...)`. Until that lands, the audit
follow-up scores each tool by hand.

[get-ts]: ../src/tools/task/get.ts

---

## 2 · Worked examples in tool descriptions

The four-section description shape ([DESIGN.md §6.8][design-68], enforced by
[`descriptionShape.ts`][shape-ts]) is the structural floor. The NL-quality
extension on top of it is: include 1–2 worked examples in the description
itself, so the agent's first attempt at composing arguments has a concrete
template to follow.

**Rule.** A tool description, after the four required sections (what / when
not / returns / side effects), includes at least one `Example:` line showing
a representative call.

**Pattern.** Compose the example into the description constant directly:

```typescript
export const TASK_LIST_DESCRIPTION =
  "List OmniFocus tasks under a flat-paginated cursor. " +
  "Use to walk a project, a tag, or the inbox. " +
  "Do NOT use to fetch a single known task — prefer task_get. " +
  "Returns up to limit tasks plus an opaque pagination cursor. " +
  "Read-only; safe to retry. " +
  'Example: { "filter": { "projectId": "p123" }, "limit": 50 }';
```

A worked example pinned to the description costs one line and saves a wrong
first attempt. Examples should pick representative shapes — for tools with
several modes (e.g. by-project vs. by-tag vs. inbox), include a short example
per mode.

**Anti-pattern.** Listing every option in the description as if it were a
manpage. The example should be a *call you'd actually make*, not an
exhaustive flag listing.

**Verification.** A follow-up lint check enforces "every `*_DESCRIPTION`
constant contains the substring `Example:`". The audit follow-up grades
existing descriptions and adds examples where missing.

[design-68]: ../DESIGN.md#68-tool-description-standard
[shape-ts]: ../src/tools/descriptionShape.ts

---

## 3 · Forgiving aliases at the boundary

Schemas should accept the common natural-language phrasings an agent or user
will produce, where the mapping is unambiguous and stable. This is the
"normalize at the door" pattern: the canonical internal value is one thing,
but the schema accepts a small, documented set of aliases and rewrites them
before validation.

**Rule.** When a field has a small, stable set of canonical values (priority
levels, statuses, frequencies) AND there is an obvious natural-language
phrasing (`"high"` → `"P1"`, `"weekly"` → fixed-frequency 1-week schedule),
the schema accepts the alias.

**Pattern.** Use a Zod `preprocess` or `transform` step that normalizes
before the constraint check:

```typescript
const priorityAlias = z
  .union([z.enum(["P0", "P1", "P2", "P3"]), z.string()])
  .transform((v, ctx) => {
    const map: Record<string, "P0" | "P1" | "P2" | "P3"> = {
      P0: "P0",
      P1: "P1",
      P2: "P2",
      P3: "P3",
      critical: "P0",
      high: "P1",
      medium: "P2",
      low: "P3",
    };
    const normal = map[v.toLowerCase?.() ?? v];
    if (!normal) {
      ctx.addIssue({ code: "custom", message: "unknown priority alias" });
      return z.NEVER;
    }
    return normal;
  });
```

Document the accepted aliases in the field's `.describe(...)` so the agent
sees them in the schema. *Never* invent aliases that aren't unambiguous —
"due tuesday" is ambiguous (next tuesday? this tuesday?), so it stays a
type-error rather than a silent misinterpretation.

**Anti-pattern.** Accepting `"urgent"` as a stand-in for `"P0"` without
documenting it; or accepting fuzzy date phrasings the agent might mean
either of two things by.

**Verification.** Aliases are tested as part of each tool's unit suite. The
audit follow-up identifies fields that should accept aliases but currently
don't.

---

## 4 · Round-trip readability

The response envelope ([ADR-0013][adr-0013]) decides the *shape*; this lever
decides whether what comes back is *describable in one sentence*. An agent
that has to compose a task summary from `data` gets it right more often when
IDs come paired with names, dates carry timezones, and numeric fields have
units in the schema description.

**Rule.** Every entity in `data.*` carries enough context that an agent can
restate the response without a follow-up read:

- IDs travel with the corresponding name (e.g. `{ id, name }` for projects,
  tags, folders inside a Task response, not bare `projectId`).
- Dates are ISO-8601 with offset ([ADR-0007]). Never bare local time.
- Counts and durations name their unit in the field description (`"durationMs"`,
  `"itemCount"`).
- Empty results are an empty array, never `null` or `undefined` (`tags: []`,
  not omitted).

**Pattern.** [ADR-0015]'s `humanReadableSummary` is the explicit form of this
rule for write tools — every write returns a server-generated one-liner. For
read tools, the rule applies to the data shape itself.

**Anti-pattern.** Returning `{ projectId: "p123" }` without the project name;
returning `{ due: "2026-04-27T15:00:00" }` without an offset; returning
`{ count: 50 }` without a unit.

**Verification.** Spot-checked in the per-tool audit; no automated lint
(shape decisions are too contextual). The mutation-response contract in
[CONTRIBUTING.md][contrib] already enforces "return the full updated entity"
for writes — this lever extends that principle to reads.

[adr-0013]: ./adr/0013-tool-response-envelope.md
[ADR-0007]: ./adr/0007-dates-iso8601-with-offset.md
[ADR-0015]: ./adr/0015-nl-excellence-response-envelope.md
[contrib]: ../CONTRIBUTING.md

---

## 5 · Fail-with-help error messages

Default Zod messages — `"Invalid input: expected int, received number"`,
`"Invalid option"` — are jargon. An agent reading them has to translate
"expected int" into "send a whole number, not 3.5" before it can fix the
call. The translation step is unreliable; some agents loop on the same wrong
input, others give up and surface the raw error to the user.

**Rule.** Every tool handler that validates input through Zod catches
`ZodError` at the boundary and rewrites it into the structured shape:

```typescript
{
  field: string;        // dotted path: "tags[0].name"
  sent: unknown;        // what the agent sent
  expected: string;     // one-sentence description of what was expected
  examples?: unknown[]; // 1+ valid examples the agent can copy
}
```

The rewritten failures live in `ValidationError.details.failures`. Agents
read this and patch their input without another round-trip; humans read it
and see exactly which field needs which value.

**Pattern.** Use [`zodToActionable`][zta-ts] at the tool-handler boundary:

```typescript
import { ZodError } from "zod";
import { ValidationError } from "../../errors/index.js";
import { zodToActionable } from "../../errors/zodToActionable.js";

export async function handleTaskCreate(rawInput: unknown, ctx: TaskCreateContext) {
  const parsed = taskCreateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Invalid task_create input", {
      details: { failures: zodToActionable(parsed.error, rawInput) },
    });
  }
  // ... happy path
}
```

The helper handles every Zod 4 issue code (`invalid_type`, `invalid_value`,
`invalid_format`, `too_small`, `too_big`, `unrecognized_keys`,
`invalid_union`, `not_multiple_of`, `custom`) and produces examples for
common string formats (datetime, email, UUID, …) automatically.

**Anti-pattern.** Throwing a bare `ValidationError("invalid input")` and
losing the per-field detail; or letting the raw `ZodError` propagate and
forcing the agent to parse Zod's own message format.

**Verification.** `zodToActionable` is unit-tested against every Zod 4 issue
code. A follow-up integration test ([#489][489] AC) seeds 5–10 deliberately-bad
inputs across diverse tools and asserts each error response carries the
structured `failures` array.

[zta-ts]: ../src/errors/zodToActionable.ts
[489]: https://github.com/torsday/omnifocus-mcp/issues/489

---

## Tool-quality checklist (use at PR review)

Apply this to every new tool and every tool you touch. A "no" on any line
is a blocker, not a nit:

- [ ] Description follows the four-section shape (DESIGN.md §6.8) — `checkDescriptionShape` passes
- [ ] Description ends with at least one `Example:` line of a representative call
- [ ] Every Zod input field has `.describe(...)` — one sentence, under ~120 chars
- [ ] Aliases accepted at the boundary for fields with stable canonical sets, documented in `.describe(...)`
- [ ] Response shape includes IDs paired with names, ISO-8601 dates with offset, units on counts/durations
- [ ] Handler catches `ZodError` and uses `zodToActionable` to populate `ValidationError.details.failures`
- [ ] Unit tests cover one happy path, one validation failure, one boundary error rewriting

The non-NL invariants from CONTRIBUTING.md ("typed errors only", "no user
content in metadata", "response envelope") still apply. This rubric is
strictly additive.

---

## Why these five and not others

The levers are picked because each one fails *silently* — an agent gets a
worse-than-necessary first attempt and you don't notice unless you measure
the per-tool first-call success rate. Things that fail loudly (wrong tool
called, missing required field, transport error) don't need a rubric; the
agent surfaces those immediately. The levers above are the silent failure
modes specific to NL-driven tool use.

What's *not* on the list and why:

- **Number of tools** — discussed extensively in [DESIGN.md §6.8.1][design-681];
  not an NL-quality concern, separately governed.
- **Streaming / progress reporting** — orthogonal; ADR scope, not lever.
- **Tool composition / orchestration** — emergent from individual tool
  quality plus the agent's reasoning; the levers above are inputs to that.

[design-681]: ../DESIGN.md#681-tool-count-policy-478
