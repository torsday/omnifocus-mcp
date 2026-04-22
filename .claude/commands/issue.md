---
description: Create a new GitHub issue with this project's labels, milestone, project board, and field values populated.
---

Create a GitHub issue for the work described in the user's request, wired into this project's tracker conventions end-to-end.

**Follow the canonical tracker issue-quality standard** from `~/src/github.com/torsday/llm_prompts/tracker.md` for title, body, and AC quality. Then apply the project-specific wiring below.

## Project-specific wiring

### Title

- Verb-first imperative, specific enough to scan
- Format matches the existing 94 issues: `<tool_name>` for new tools, `<verb> <subject>` for chores/docs

### Body — use this template verbatim

```markdown
## Context

<Why this work exists + one-sentence link to DESIGN.md §N / ADR-NNNN / SPEC section>

## Acceptance Criteria

- [ ] <Observable, testable outcome — not an implementation step>
- [ ] <One more>
- [ ] All code follows `coding.md` standards (typed errors, docblocks, Goldilocks tests)

## Technical Notes

<Files, patterns, constraints — 1–3 bullets; omit if genuinely empty>

## Dependencies

- Blocked by: #N (if any)
- Blocks: <describe; may omit>
```

### Labels — pick the full set

Every issue gets:

- **Type:** one of `type: feature`, `type: chore`, `type: spike`, `type: infra`, `type: docs`, `type: bug`, `type: test`
- **Priority:** one of `P0 · critical`, `P1 · high`, `P2 · medium`, `P3 · low`
- **Size:** one of `size: XS` (≤2h), `size: S` (½ day), `size: M` (1 day), `size: L` (2–3 days), `size: XL` (≥1 week — split instead)
- **Phase:** one of `phase: M0 foundation`, `phase: M1 core`, `phase: M2 metadata`, `phase: M3 advanced`, `phase: M4 long-tail`, `phase: M5 polish`
- **Domain:** one or more of `domain: task|project|tag|folder|perspective|forecast|review|search|note|attachment|repetition|batch|export|sync|transport|observability|security|lifecycle|config|resources`
- **Model:** exactly one of `model: opus` or `model: sonnet` — see "Model — pick which" below
- **Risk** (only if medium or high): `risk: high`, `risk: medium`

### Model — pick which

Every issue must carry exactly one of `model: opus` or `model: sonnet`. This lets `/next` and `/ship-next` filter the Ready queue by the active model so parallel loop threads (one Opus, one Sonnet) never collide on the same issue. See `CLAUDE.md` § "Model split" for the project-specific application of this heuristic.

| Label           | When                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model: opus`   | Sustained reasoning, judgment calls, ambiguous requirements, central design, ADRs, security-adjacent changes, error taxonomy, complex algorithms, large refactors, spikes, tool descriptions, SPI work |
| `model: sonnet` | Well-spec'd execution, CRUD, mapping layers, handler patterns following an established template, validation gates, mechanical tests, infra/CI scripts, docs, small bug fixes                        |

When in doubt, label `opus` — over-using opus is cheap; under-using it produces lower-quality work on hard problems. Re-label freely as you learn what's actually hard.

### Milestone

Match the phase:

- `phase: M0 foundation` → milestone `M0 Foundation`
- `phase: M1 core` → `M1 Core surface`
- `phase: M2 metadata` → `M2 Metadata`
- `phase: M3 advanced` → `M3 Advanced`
- `phase: M4 long-tail` → `M4 Long tail`
- `phase: M5 polish` → `M5 Polish`

### Commands — create + wire

```bash
# Create the issue. The label set MUST include exactly one model: label.
gh issue create \
  --title "<title>" \
  --label "<type,priority,size,phase,domain[,risk],model: opus|sonnet>" \
  --milestone "<milestone>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"

# Add to project #4 and capture the item ID
ITEM_ID=$(gh project item-add 4 --owner torsday --url <issue-url> --format json | jq -r '.id')

# Populate Phase / Priority / Size / Risk via GraphQL (field + option IDs live in scripts/populate-project.sh)
# See that script for the exact mutation pattern.
```

Use `scripts/populate-project.sh` as reference for field/option IDs. Alternatively, re-run that script after creation — it's idempotent for already-populated items.

### Status at creation time

- If the new issue has **no blockers** (Dependencies section is empty or only lists "Blocks: ..."), set `Status = Ready` in the project
- Otherwise `Status = Todo`

Update via the GraphQL mutation pattern in `scripts/set-ready-status.sh`.

### After creating

- Report the issue number + URL back to the user
- If the issue unblocks existing work, note it
- If this reveals a gap in the design or SPEC, file an ADR note or a follow-up `needs-design` issue

## When NOT to create

Refuse politely (and explain) if the work is:

- Already tracked in an existing open issue (search with `gh issue list --search "<keyword>"`)
- Explicitly in `SPEC.md`'s "Out of Scope" section — those need an ADR conversation first
- Vague "improve X" without concrete acceptance criteria
- Trivially a PR-scope cleanup better done in the next touch of the file
