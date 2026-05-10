<!-- Originally DESIGN.md §§28–31 (split per #805) -->

# MCP resources, prompts, templates, and fenced metadata

## MCP resources

MCP resources are a distinct primitive from tools: read-only, enumerable via `resources/list`, addressable via URI. We use them for the small set of "standing contexts" an agent might want to subscribe to without invoking a tool.

### Surface

| URI                            | Content                                                                                       | Cache TTL |
| ------------------------------ | --------------------------------------------------------------------------------------------- | --------- |
| `omnifocus://snapshot`         | Aggregate orientation: `{ inboxCount, overdueCount, dueTodayCount, flaggedCount, reviewDueCount }` — the agent reads this first to decide what to work on | 30s LRU |
| `omnifocus://inbox`            | Inbox tasks as `Task[]`                                                                       | 30s LRU  |
| `omnifocus://forecast/today`   | Today's forecast grouped by `overdue / dueToday / deferredToday / flagged`                    | 30s LRU  |
| `omnifocus://overdue`          | All overdue tasks as `Task[]`, sorted by `dueDate` ascending                                  | 30s LRU  |
| `omnifocus://flagged`          | All flagged available tasks as `Task[]`                                                       | 30s LRU  |
| `omnifocus://review-due`       | Projects with `nextReviewDate ≤ today`, sorted by `nextReviewDate` ascending                  | 30s LRU  |
| `omnifocus://project/{id}`     | Single project with full task tree                                                            | 30s LRU  |
| `omnifocus://tag/{id}`         | Single tag with its tasks                                                                     | 30s LRU  |
| `omnifocus://perspective/{id}` | Perspective evaluation result (built-in or custom)                                            | 30s LRU  |
| `omnifocus://intents`          | Curated routing table mapping human-style user phrases to canonical tool/prompt/resource sequences (NL excellence layer — see below) | 24h |
| `omnifocus://stats`            | Server-side aggregate counts: tasks, projects, inbox, tags, sync — for "how is my system doing?" queries without listing every record client-side | 60s |
| `omnifocus://project-health{?staleDays}` | Triage list of active projects flagged by ≥1 health-warning condition with granular signals — list-form sibling of `stats.projects.stalled_count` | 60s |

### Semantics

- **MIME type:** `application/json` for all resources
- **Content shape:** the same `data` payload the equivalent tool would return (minus the envelope — MCP resources have their own wrapper)
- **Caching:** same LRU read cache as tools; invalidated on any mutation touching the scope
- **Subscription:** not supported in v1; clients must re-read. `resources/subscribe` is deferred until MCP clients broadly use it and a concrete use case appears.
- **Stability:** resource URIs are part of the public contract (ADR-0011). Adding URIs is minor; removing or renaming is major.
- **Enumeration:** `resources/list` returns the set, including dynamic URIs (e.g. a `omnifocus://project/{id}` entry per project). For 500+ projects, the list is paginated the same way tool list responses are.

Resources and tools use the same service layer underneath — a `GET /projects/{id}` via resource and a `project_get({id})` via tool return equivalent data. The implementation split is in the MCP handler layer only.

### NL excellence layer — intents

Eighty registered tools is too many for an agent to plan over confidently when the user says "process my inbox" or "what's on my plate today." Eight verbs — capture, plan, review, triage, retrospect, share, audit, automate — is the right cardinality for human-style intent. The `omnifocus://intents` resource is the bridge.

Each intent carries a canonical user phrase, a list of aliases, a one-sentence description in the user's voice, and an ordered sequence of steps (tool calls, prompts, or resource reads). Steps may carry template `args` placeholders the agent fills from user input. The resource is content-curated, not derived: maintainers add entries to `src/resources/intents.data.ts` as new tools land. A unit-test lint asserts every referenced name resolves to a registered tool, prompt, or resource so drift can't ship.

The point isn't to constrain the agent — it can still call any tool directly. The point is to **make the obvious paths obvious**, so the agent's first move on common intents is right. Use as a fallback when uncertain which tool fits, not as a gatekeeper.

This resource also doubles as the discoverability surface: when a future agent asks "what can this server do?", reading `omnifocus://intents` gives a coherent answer organized by intent category, not by tool name. Part of the NL-excellence epic (#491).

### Stalled-project definition

`omnifocus://stats.projects.stalled_count` and `omnifocus://project-health` (#468) share a single definition. A project is **stalled** when ALL of:

1. `status === "active"` (and not completed or dropped)
2. ≥ **14 days** since the latest task activity in the project — `max(task.modifiedAt)` over the project's tasks, or the project's own `modifiedAt` if it has no tasks
3. No defer date in the future (a deferred-into-the-future project is deliberately paused, not stalled)

Single source of truth lives in `src/domain/health.ts → isProjectStalled`. Future resources or tools using "stalled" semantics MUST reuse that predicate; do not redefine.

### Domain-specific NL helpers

The agent does prose; the MCP shapes the target schema. For schemas where a misencoding is silently wrong — looks plausible, fires on the wrong cadence — we ship a deterministic helper rather than rely on the LLM to translate. **Not every schema deserves one.** The bar is: high-arity target structure where one wrong field changes behaviour without a parse error. Where the structure is shallow or the LLM's miss is loud, the agent does the translation directly.

The first member is `repetition_from_prose`: takes a phrase like *"every other Tuesday at 10am after I complete it"* and returns `{ kind: "ok", rule: RepetitionRule, normalizedDescription }` — or `{ kind: "ambiguous", interpretations[] }` when the prose admits multiple valid readings, or `{ kind: "error", reason, suggestion? }`. No model calls inside the tool. Pure regex/lexer/grammar pipeline.

Naming convention: `<domain>_from_prose`. Other candidates as their schemas land — perspective rule trees (#460), date phrases with timezone shorthand. Keep the family discoverable by the consistent suffix.

Pattern: agent receives prose → calls helper → presents `normalizedDescription` to user → on confirm, embeds the returned `rule` in the next write. The "ambiguous" return is not a failure — surfacing two valid readings of *"every other Tuesday"* (every-14-days vs first-and-third-weekday-of-month) is the feature. The agent picks one with the user, not by guessing.

### Clarification subsystem (ADR-0015)

When a tool cannot resolve ambiguity deterministically — the prose matches multiple interpretations, a name collides with an existing resource, or a mutation would affect sibling entities — it returns a **`clarification-needed`** envelope instead of guessing:

```
{
  kind: "clarification-needed",
  question: string,          // rendered verbatim to the user
  options?: ClarificationOption[],  // { index, label }[] — agent renders verbatim
  partial?: Record<string, unknown>, // already-unambiguous args (informational)
  replayToken: string,       // opaque, single-use, 5-min TTL
  meta: ResponseMeta
}
```

**Rule:** *prefer this shape over guessing whenever a deterministic disambiguation is impossible.* Tools without an ambiguity surface (pure reads by ID, `internal_status`, etc.) never emit this kind — it is opt-in per tool.

**Agent contract:**
1. Receive `clarification-needed` → render `question` and `options` to the user.
2. Agent **must not** silently auto-pick option 0 without user contact (lint guidance #489).
3. Call `clarify({ replayToken, choice })` with the user's chosen index.
4. Server replays the original tool with disambiguation applied; returns a normal `ok | error` envelope.

**Replay store:** In-memory only (`src/state/replayStore.ts`). Tokens expire after 5 minutes and are single-use (`consume()` deletes on first lookup). Survives within a server session; not persisted across restarts — agents must not cache tokens.

**Current emitting tools:**

| Tool | Ambiguity surface | Options offered |
|------|-------------------|-----------------|
| `repetition_from_prose` | Prose matches multiple repetition patterns | One entry per interpretation's `normalizedDescription` |
| `project_create` | Name collides with an existing active project | Use existing / Force-create |
| `task_complete` | Parent task has incomplete children | Complete with children / Complete parent only |

**Extensibility:** Any tool that would otherwise guess silently can add clarification-needed. Wire the tool's handler to `src/state/replayStore.ts`, register the callback, emit `clarificationNeeded(...)` from `src/envelope/index.ts`.

---

## MCP prompts

MCP prompts are parameterized, pre-built workflow templates surfaced to clients as slash commands or guided flows. Unlike tools (which perform one atomic operation) or resources (which expose static data), prompts compose multiple tools into a repeatable sequence — the MCP server defines the script, the agent executes the steps.

This is the largest gap in competing implementations. No current OmniFocus MCP ships prompts.

### Surface

| Name | Parameters | Workflow |
| ---- | ---------- | -------- |
| `daily-review` | _(none)_ | Reads `omnifocus://snapshot` + `omnifocus://overdue` + `omnifocus://forecast/today`; returns a structured triage prompt that asks the agent to process each group |
| `weekly-review` | _(none)_ | Iterates `omnifocus://review-due` project by project; for each, presents tasks and prompts the agent to mark reviewed, defer, or drop |
| `capture-meeting` | `notes: string`, `projectId?: ProjectId` | Instructs agent to parse `notes` for action items, then call `task_batch_create` with the results; falls back to inbox if `projectId` is omitted |
| `project-planning` | `name: string`, `brief: string`, `folderId?: FolderId` | Instructs agent to call `project_create` then `task_batch_create` to populate it with subtasks derived from the brief |

### Semantics

- **Prompt content is a message array**, not a tool call — the server returns the `messages` array that the MCP client injects into the LLM context.
- **Parameters are validated with zod**, same as tool inputs.
- **Prompts reference tools by name** in their message content; they do not invoke tools themselves — the LLM executes them.
- **Stability:** prompt names and required parameters are part of the public contract (ADR-0011). Adding optional parameters is minor; removing or renaming is major.
- **Enumeration:** `prompts/list` returns all prompts with their parameter schemas.

## Project templates — Templates folder convention

OmniFocus has no first-class template system. The convention this MCP server adopts (#472, #587):

- A folder named **`Templates`** at the library root holds one project per template. The name is configurable via `OMNIFOCUS_TEMPLATES_FOLDER_NAME`.
- Each template-project's name is the user-facing template name. Names must be unique within the Templates folder; `project_template_save` rejects duplicates with a typed `TemplateExists` error.
- The template-project's note carries a fenced YAML block at the top:

  ````markdown
  ```project-template
  name: Client onboarding
  parameters: client,startDate
  capturedAt: 2026-04-27T20:00:00Z
  ```

  Client onboarding:
      - Send welcome email @flagged
      - Schedule kickoff @due(2026-05-04)
  ````

  The fence captures display name, ordered parameter names (comma-separated, used by `_instantiate` for substitution), and an ISO-8601 capture timestamp. Below the fence sits the project's task tree rendered as TaskPaper via the existing export service.

- The Templates folder is created lazily on first save; first-time users see no extra clutter until they save.
- Projects stored under Templates that **lack** a parseable fence are silently skipped by `project_template_list` and treated as `TemplateNotFound` by `project_template_instantiate`. This lets users keep ordinary projects in the Templates folder without the listing surface treating them as broken templates.

### Instantiation

`project_template_instantiate` resolves a template by name, then:

1. **Validates parameters.** Every name recorded in the template's `parameters:` field must have a value in the input `parameters` map. Missing names surface together in one `MissingTemplateParameter` error so the agent can fix them in a single round-trip.
2. **Substitutes `{{name}}` placeholders.** Substitution is purely textual. Names are alphanumeric + underscore + hyphen; whitespace inside the braces is tolerated (`{{ client }}` works the same as `{{client}}`). **Unknown placeholders are left as-is** rather than dropped — visible failure beats silent data loss, and the user can spot them in the resulting project.
3. **Shifts `@due` and `@defer` dates relative to the supplied `dueDate`.** The anchor is the **earliest `@due(YYYY-MM-DD)`** in the template body; every other date shifts by the same delta. `@defer` dates participate in the shift even though they don't drive anchor selection. Templates without any `@due` to anchor on instantiate as-is when `dueDate` is supplied — there's nothing to shift, and erroring would be wrong since a `dueDate`-less template is a legitimate use case.
4. **Pre-creates the target project** with `name = templateName` (and optional `targetFolderId`), then hands the substituted body to `importTaskPaper(text, projectId)`. The importer ignores the `Project name:` heading at the top of the body when `targetProjectId` is supplied, so the new project's name is whatever was passed to `createProject`, not whatever appeared in the template.

### Properties

- **Discoverable in OmniFocus directly.** Users can see and edit their templates in the OF UI; the fence is plain markdown and edits round-trip through `project_template_list` cleanly.
- **No new persistence layer.** Templates live in the OF database the same way any project does — they sync via Omni Sync, restore from backups, and export with TaskPaper export.
- **Lossiness inherits from TaskPaper.** Repetition rules, custom completion criteria (parallel vs sequential), estimated minutes, and attachments do not round-trip through TaskPaper today; the export step emits warnings into the save response. Templates are meant for common patterns, not corner cases.

The template CRUD surface: `project_template_save`, `project_template_list`, `project_template_delete`, `project_template_instantiate`.

Cross-reference: the fence format used by this convention is documented under "Synthetic data on tasks and projects" below.

## Synthetic data on tasks and projects — fenced note metadata

Several agent-useful structured fields (waiting-on tracking, project templates, decision journals) need a place to live on a task or project that is not already part of the OmniFocus data model. The convention this MCP server uses is a markdown code-fenced block at the top of the item's note, holding `key: value` lines.

### Wire format

```
```<tag>
key1: value1
key2: value2
```

…rest of the user's note here…
```

`<tag>` is a short identifier that names the feature (e.g. `waiting-on`, `project-template`). The block always appears at the start of the note so tools that display only the first line of a note still see the user's prose, not metadata.

### Invariants

- **Round-trippable.** `upsertFence` / `removeFence` preserve the surrounding note exactly — blank lines, trailing whitespace, any other fences. Multiple features can annotate the same note independently.
- **Forgiving.** A malformed fence (unclosed, empty body, bad lines) parses to `undefined` rather than an error. Callers treat `undefined` as "feature not in use." The user might have hand-edited the note.
- **Visible.** Plain markdown; users can view and edit it in OmniFocus's note editor or in search results. No hidden database; no migration needed.

### Helper API (`src/domain/noteFences.ts`)

| Function | Purpose |
|---|---|
| `findFence(note, tag)` | Locate the first fence with the given tag. Returns `{ body, start, end }` or `undefined`. |
| `parseFenceBody(body)` | Parse `key: value` lines into a `Record<string, string>`. Blank lines and lines without a colon are skipped. Last write wins on duplicate keys. Single/double-quoted values are unquoted. |
| `serializeFenceBody(fields)` | Serialize a typed object back to `key: value` lines. `undefined` values are omitted. Output order matches key iteration order. |
| `upsertFence(note, tag, body)` | Replace an existing fence in-place, or prepend a new one separated by a blank line. |
| `removeFence(note, tag)` | Remove a fence; collapses the surrounding blank lines. Returns `null` when removal empties the note. |

### Current consumers

| Feature | Tag | File | Issue |
|---|---|---|---|
| Waiting-on tracking | `waiting-on` | `src/domain/waitingOn.ts` | #482 |
| Project templates | `project-template` | `src/domain/projectTemplates.ts` | #472 |
| Decision journal | `decision-journal` | `src/domain/decisionJournal.ts` | #485 |

New features that need structured per-item state should adopt this convention rather than inventing a new storage mechanism. See "Project templates — Templates folder convention" above for the project-templates use case as a reference implementation.

### Decision journal — agent memory of user judgment

When `project_health` (or any agent-driven scan) flags an anomaly and the user replies "that's deliberate," the agent records the judgment as a `decision-journal` fence on the target's note. Future scans honor the decision until it's cleared (`decision_clear`) or its `until` expiry passes.

The fence carries:

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `kind` | enum | yes | One of `stall-is-intentional`, `deferred-by-choice`, `blocked-on-external`, `awaiting-decision`, `acknowledged-zombie`. Closed at write time but extensible across releases. |
| `reason` | string | yes | Human-readable explanation surfaced when a future scan asks "why is this still here?" |
| `recordedAt` | ISO-8601 with offset | yes | Set automatically by `decision_record`. |
| `until` | ISO-8601 with offset | no | Auto-expiry. When in the past, `isDecisionActive` returns false and downstream consumers re-surface the target. |

Both targets — tasks and projects — accept decisions; `decision_record` discriminates on `targetKind`. The fence sits alongside other fences (e.g. `waiting-on`) in the same note without conflict; `noteFences` operations are tag-scoped.

Read-side integration surfaces a `decision` field on `task_get`, `task_get_many`, `project_get`, `project_get_many` whenever a fence is present. The `omnifocus://project-health` resource honors active decisions by partitioning flagged projects into a separate `acknowledged` array — auditable, not invisible. Expired decisions (`until` in the past) re-emerge in `projects` automatically; the fence stays as audit history.
