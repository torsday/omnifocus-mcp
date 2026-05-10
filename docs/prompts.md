# Prompts

`omnifocus-mcp` ships four **MCP prompt templates** — structured workflows you can invoke by name from any MCP client that surfaces `prompts/list` (most clients with a prompt picker UI). See [`docs/examples.md`](./examples.md) for tool-level interaction examples and [`docs/tools.md`](./tools.md) for the full tool reference.

## `daily-review` — triage your day

Loads your snapshot, overdue tasks, and today's forecast; reschedules or drops overdue items; confirms due-today tasks; processes the inbox. No parameters needed.

```
Use the daily-review prompt
```

## `weekly-review` — walk your projects

Loads every project whose review date has arrived; checks each one for stale tasks; marks it reviewed or completes/drops it. No parameters needed.

```
Use the weekly-review prompt
```

## `capture-meeting` — extract action items

Takes raw meeting notes and creates OmniFocus tasks for every commitment, follow-up, and decision point. Pass the notes as text and optionally a project ID.

```
Use the capture-meeting prompt with notes="Sync with Alice: she'll send the report by Thursday.
Bob to review the contract. Need to schedule follow-up call."
```

Results in two inbox tasks: "Send report to [person]" and "Review contract" with the source sentences as notes.

## `project-planning` — decompose a brief

Creates a new project and populates it with a set of concrete, ordered, one-day tasks derived from a free-text brief.

```
Use the project-planning prompt with name="Q3 Marketing Site" brief="Redesign the marketing
site landing page and pricing page. New brand colors, updated copy, responsive mobile layout.
Launch by end of July."
```

Results in a new OmniFocus project with 8–12 tasks covering design, copy, development, and review phases, ready to schedule and assign.
