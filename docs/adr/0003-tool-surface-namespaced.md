# ADR-0003: Tool surface — many narrow tools with `<noun>_<verb>` namespacing

**Date:** 2026-04-19
**Status:** Accepted

---

## Context

MCP tools are the API the LLM agent sees. Two dimensions of decision: (1) **granularity** — few broad tools vs many narrow ones — and (2) **naming** — flat, hierarchical, or namespaced.

Empirically, modern agent models handle wide tool surfaces well if descriptions are clear and names are predictable. The failure mode of "few broad tools" is complex nested schemas the agent has to interpret; the failure mode of "many narrow tools" is name-space pollution where near-duplicates confuse the agent.

Full OmniFocus coverage implies a sizeable verb-per-noun surface. We must choose a shape before writing any tool handlers; retrofitting the shape later means renaming every tool (which is a breaking change to anyone using the MCP).

## Decision

We will expose **one MCP tool per operation**, naming them **`<noun>_<verb>`** in snake_case, using **consistent verbs across nouns**.

Examples:

- `task_list`, `task_get`, `task_create`, `task_update`, `task_complete`, `task_drop`, `task_move`
- `project_list`, `project_get`, `project_create`, `project_update`, `project_mark_reviewed`
- `tag_list`, `tag_get`, `tag_create`, `tag_update`, `tag_delete`, `tag_move`
- …

Every tool's description follows the `agent_systems.md` standard: _what it does, when to use it (and when not), what it returns, side effects_.

## Options Considered

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Few, powerful tools (`omnifocus_query`, `omnifocus_mutate`) with wide schemas | Small tool count; discoverable | Agent must interpret complex nested schemas; tool descriptions become essays; error disambiguation poor; harder for the agent to know which features exist |
| **Many narrow tools, `<noun>_<verb>` naming** | Predictable names; agent can pick tools by pattern; each tool has a tight schema and error model; descriptions stay short | More handler boilerplate (mitigated by one-file-per-tool pattern); more entries in the tool list |
| Dotted names (`task.list`, `project.create`) | Matches some MCP conventions | snake_case is more common across MCP ecosystem; dots confuse some tooling |
| Split across multiple MCP servers (read/write or per-noun) | Privilege separation | User configures multiple servers; more ops surface; premature for a single-user tool |

## Consequences

**Positive**

- Agents can pattern-match names (`task_*`) to discover available operations without reading all descriptions
- Tool schemas stay small and clear; errors are specific to the operation
- Each tool handler file is small (target < 30 lines of pure delegation), making code review and tests cheap
- If tool count becomes unwieldy in future, the naming is already structured for splitting into multiple MCP servers — a mechanical refactor

**Negative**

- More files in `src/tools/<noun>/`; handler layer has more surface
- Tool registry must be maintained; mitigated by convention — one tool per file, auto-registered from `src/tools/**` at server startup
- Descriptions are now load-bearing documentation — if any tool's description is weak, the agent picks wrong

**Risks**

- **Agent confusion from near-duplicates** (e.g. `task_drop` vs `task_delete` — OF distinguishes these but some agents may not). Mitigated by explicit "when not to use" text in each description and by disambiguation tests: a fresh Claude must correctly pick between similar tools on representative prompts.
- **Breaking rename later** if the namespacing proves wrong. Mitigated by committing early and treating tool names as API stability surface; changes go through ADR.

## References

- `DESIGN.md` §4 — tool surface options
- `SPEC.md` — functional requirements that define the ~65 operations
- `~/src/github.com/torsday/llm_prompts/agent_systems.md` — tool description standard, atomic/composable/idempotent principles
