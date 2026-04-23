---
description: Pick the highest-priority ready issue, implement it end-to-end, keep the GitHub project board honest, and create follow-up issues when scope reveals.
---

Looking at this project — read the board, pick the next best issue, implement it end-to-end, and leave the tracker in a cleaner state than you found it. No direction needed; apply engineering judgment and the standards in `CLAUDE.md` and [`~/src/github.com/torsday/llm_prompts/`](https://github.com/torsday/llm_prompts).

This prompt is the autonomous-session loop for `omnifocus-mcp`. The canonical `ship-next.md` lives at `~/.claude/skills/ship-next/SKILL.md`; this is the project-specific specialization — the backlog, dependencies, and work order are **entirely in GitHub Issues + Project #4** (no local tracking), and the load-bearing decisions are in `docs/adr/`.

`/next` and `/ship-next` are interchangeable in this repo — both resolve to this file. The sibling `.claude/commands/ship-next.md` points here.

---

## Board vocabulary (project `torsday/projects/4`)

Status column (forward order):

| Column        | Option ID   | Meaning                                                                      |
|---------------|-------------|------------------------------------------------------------------------------|
| **Backlog**   | `1e5b9208`  | Raw / untriaged. Default landing for new issues without a specific column.   |
| **Up Next**   | `19ebdd2c`  | Triaged, well-specified, **ordered**. This loop picks from the top.          |
| **In Progress** | `381a1e62` | Being worked right now.                                                      |
| **In Review** | `04079029`  | PR open; waiting on merge.                                                   |
| **On Hold**   | `8baabea1`  | Deferred by choice or external block. **Must have a reason comment.**        |
| **Done**      | `c2f7c066`  | Merged or explicitly declined.                                               |

Forward flow: `Backlog → Up Next → In Progress → In Review → Done`. `On Hold` is a side-track reachable from any non-terminal column.

**Board IDs** (reused in every mutation below):
- Project: `PVT_kwHOAARNgc4BVGvQ`
- Status field: `PVTSSF_lAHOAARNgc4BVGvQzhQkx-E`

### Status-transition helper (use every time)

Every `updateProjectV2ItemFieldValue` call for Status goes through this shape — pre-check, flip, verify. Inline mutations are error-prone; this is the canonical form.

```bash
# flip_status $ITEM_ID $TARGET_OPTION_ID $TARGET_NAME $ISSUE_NUMBER
flip_status() {
  local item_id="$1" target_option="$2" target_name="$3" issue_n="$4"
  local current verified
  current=$(gh api graphql -f query="query { node(id: \"$item_id\") {
    ... on ProjectV2Item { fieldValues(first: 20) { nodes {
      ... on ProjectV2ItemFieldSingleSelectValue {
        field { ... on ProjectV2SingleSelectField { id } } optionId
      } } } } } }" \
    --jq ".data.node.fieldValues.nodes[] | select(.field.id==\"PVTSSF_lAHOAARNgc4BVGvQzhQkx-E\") | .optionId")

  if [ "$current" = "$target_option" ]; then
    echo "#$issue_n already $target_name — skipping"
    return 0
  fi

  gh api graphql -f query="mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: \"PVT_kwHOAARNgc4BVGvQ\"
      itemId: \"$item_id\"
      fieldId: \"PVTSSF_lAHOAARNgc4BVGvQzhQkx-E\"
      value: { singleSelectOptionId: \"$target_option\" }
    }) { projectV2Item { id } }
  }" > /dev/null

  verified=$(gh api graphql -f query="query { node(id: \"$item_id\") {
    ... on ProjectV2Item { fieldValues(first: 20) { nodes {
      ... on ProjectV2ItemFieldSingleSelectValue {
        field { ... on ProjectV2SingleSelectField { id } } optionId
      } } } } } }" \
    --jq ".data.node.fieldValues.nodes[] | select(.field.id==\"PVTSSF_lAHOAARNgc4BVGvQzhQkx-E\") | .optionId")

  if [ "$verified" != "$target_option" ]; then
    echo "FATAL: #$issue_n flip to $target_name did not persist (got: $verified)" >&2
    return 1
  fi
  echo "status: #$issue_n → $target_name"
}
```

**Label ↔ Status invariant.** The `status: in-progress` label and the `In Progress` column move together:
- Flipping **→ In Progress**: add the label (and post a start comment).
- Flipping **out of In Progress** (to In Review / Done / On Hold): remove the label.
- Flipping **→ Done**: first verify the issue is `CLOSED`; if not, don't flip — the label/status lie is worse than the stuck card.

Subsequent sections reference this helper rather than inlining the mutation.

---

## Protocol

### 0. Drift self-heal (run every cycle, before Discovery)

Interrupted previous cycles can leave the tracker inconsistent. Repair drift first so Discovery sees clean state. Both checks are idempotent.

**a. Stale `status: in-progress` labels on CLOSED issues:**
```bash
for n in $(gh issue list --state closed --label "status: in-progress" --json number --jq '.[].number'); do
  gh issue edit "$n" --remove-label "status: in-progress"
done
```

**b. CLOSED issues whose project Status is not `Done`:**
```bash
gh api graphql -f query='query { user(login: "torsday") { projectV2(number: 4) { items(first: 100) { nodes { id content { ... on Issue { number state } } fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { field { ... on ProjectV2SingleSelectField { name } } name } } } } } } } }' \
  --jq '[.data.user.projectV2.items.nodes[] | {itemId: .id, n: .content.number, state: .content.state, status: ([.fieldValues.nodes[]? | select(.field.name=="Status") | .name][0])} | select(.state=="CLOSED" and .status!="Done")]'
```
For each item returned, call `flip_status "$ITEM_ID" "c2f7c066" "Done" "$N"`.

**c. `In Review` items whose linked PR has merged or closed** — forgotten close-out. Flip each to `Done` via the helper and strip `status: in-progress` if present.

**d. Items in `In Progress` with no commit activity in 3+ days and no open PR** — stale WIP. Surface in the drift report; don't auto-revert (may be legitimately paused). Suggest moving to `On Hold` with a reason comment.

Report drift repaired in one line (e.g. `Drift self-heal: flipped #9 #10 to Done, cleared 3 stale labels, 1 stale WIP noted`). If none, stay silent.

---

### 1. Discovery (read broadly; stop when you have a confident picture)

Start from the tracker. Everything else is context for the chosen work.

1. **Up Next issues:** `gh issue list --state open --label "P0 · critical" --limit 30` — then P1, then P2. Sorted by priority, pagination-aware.
2. **Project board state:** `gh project item-list 4 --owner torsday --format json` — look at the `Status = Up Next` column (this is the ordered queue; pick from the top), Phase field, Risk field.
3. **Recent activity:** `git log --oneline -10` + `gh issue list --state closed --limit 10` — what's already done and what patterns did it set.
4. **Stale `In Progress`:** `gh issue list --state open --label "status: in-progress" --limit 10` — anything I should resume instead of starting new.
5. **Open PRs:** `gh pr list --state open` — any of mine need continuing, reviewing, or rebasing.
6. **Spec + design cross-check:** if the issue references a SPEC/DESIGN section, read it (not the whole file — the cited section).
7. **Use a subagent when the read is wide.** "Use a subagent to summarize the current state of the cache layer" keeps my context clean.

Cross-reference as you read. An `In Progress` item with no commits in 3 days is a different signal than a clean `Ready` queue.

---

### 2. Prioritization

**Filter by model first.** This command is meant to run unattended (often inside a `/loop`), so silently skip model-mismatched candidates instead of pausing — the operator may not be present to answer. Every open issue in this project is labeled `model: opus` or `model: sonnet`. Identify your current model from the system prompt:

- `claude-opus-*` → **opus**; only issues with `model: opus` are eligible
- `claude-sonnet-*` → **sonnet**; only issues with `model: sonnet` are eligible

Drop every candidate whose model label doesn't match. If every candidate is filtered out, stop and report:

> No model-compatible work in `Up Next`. Items: `#N (model: X), …`. Switch models or re-label. See CLAUDE.md "Model split" for the rationale.

**Then pick** from the **top of the `Up Next` column** (kanban-style — the column is ordered by `/groom`). Within the column, prefer the top item unless it's model-mismatched or genuinely unclear in scope; then skip to the next. If the column is empty, fall back to the highest-priority item with `status: ready` label that isn't yet on the board.

(For explicitly-invoked commands where interactive confirmation is better — `/adr`, `/spec`, `/tasking`, `/debug`, `/security-review` — see their own front-matter for the pause-with-AskUserQuestion pattern.)

#### Tier 1 — Something is broken

- Failing CI on `main`
- Security findings (raw-script path accidentally enabled by default, stdout bytes leaking, PII in `info` logs)
- Integration tests red against live OF
- An issue marked `status: blocked` that's actually unblocked (board drift)

#### Tier 2 — Something could fail silently

- A shipped tool without integration tests (coverage gap on the critical path)
- External (OF) calls without timeouts
- Error taxonomy drift — a throw that uses a `code` not in `DESIGN.md §6.7`
- Response envelope violations — a tool returning a raw payload without `meta`

#### Tier 3 — Something is getting worse

- Issues blocking ≥ 3 other issues that are languishing
- High-churn code becoming brittle (check `git log --stat` on files touched > 5× in recent commits)
- Measured SLO miss in benchmarks (once #94 lands)

#### Tier 4 — Planned work (the default path through the backlog)

- The top item in the `Up Next` column (`/groom` keeps it ordered by priority → phase → unblocks-count → size)
- Work through M0 → M1 → M2 → M3 → M4 → M5 in order; within a milestone, follow the dependency graph

If nothing rises above Tier 4: **that is the normal state of this project.** Do Tier 4 work confidently. The board exists so you don't have to manufacture urgency.

If the right approach for the top candidate is **genuinely unclear** (not just "there are tradeoffs"): don't guess. Do a time-boxed spike first, or surface it in the report as a decision point and pick the next item.

---

### 3. Decision

Before any code, state:

> **Tier:** [1–4]
> **Issue:** #N — <title>
> **Plan:** what will be done, in one to three sentences
> **Evidence:** what in discovery pointed here
> **Effect:** what this fixes, enables, or unblocks
> **Passed over:** the next 1–2 candidates and a one-line reason they ranked lower
> **Scope edges:** what's explicitly out of scope for this session

**Immediately mark the issue in-progress — label, start comment, and board flip, in that order, before a single line of code:**

```bash
# 1. Add the label (tracks the column — see "Label ↔ Status invariant")
gh issue edit <N> --add-label "status: in-progress"

# 2. Resolve the project item ID (reuse $ITEM_ID throughout the cycle)
ITEM_ID=$(gh api graphql -f query='query { user(login: "torsday") { projectV2(number: 4) { items(first: 100) { nodes { id content { ... on Issue { number } } } } } } }' \
  --jq ".data.user.projectV2.items.nodes[] | select(.content.number == <N>) | .id")

# 3. Post a start comment so the issue timeline shows activity
gh issue comment <N> --body "🚧 Work started — branch \`<branch>\`."

# 4. Flip Status → In Progress via the helper (pre-check + mutate + verify)
flip_status "$ITEM_ID" "381a1e62" "In Progress" "<N>"
```

---

### 4. Execution

Apply the standards in the matrix below. Do not re-specify them — just follow them.

| Work type                                    | Standards to apply                                                |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Any code written or changed                  | `coding.md` throughout — SOLID, pure functions, typed errors      |
| MCP tool handler, adapter, schema            | `agent_systems.md` — atomic / composable / rich / actionable     |
| Architecture design or evaluation            | `systems_design.md`; record load-bearing decisions via `adr.md`  |
| New feature from spec                        | `tasking.md` to sequence, then implement                         |
| Spike (time-boxed research)                  | Produce a note under `docs/spikes/<YYYY-MM-topic>.md`; ADR if it changes direction |
| Pull request ready for review                | `review_pr.md` checklist applied to your own diff first          |
| Staged changes ready to commit               | `commit.md` — Conventional Commits, one concern per commit       |
| Unit tests                                   | `unit_tests.md` — Goldilocks, against `InMemoryAdapter`          |
| Integration tests                            | `integration_tests.md` — gated on `OMNIFOCUS_INTEGRATION=1`      |
| Bug                                          | `debug.md` protocol — reproduce first                            |
| Security-adjacent change                     | `security_review.md`                                              |
| Performance-adjacent change                  | `optimize.md` — measure before and after                         |
| Observability gap                            | `observability.md`                                                |
| Dependency update                            | `dependency_update.md`                                            |
| CI/CD change                                 | `ci_cd.md`                                                        |
| Release preparation                          | `release_notes.md`                                                |
| Documentation change                         | `refactor_docs.md`                                                |

#### Branch + commit + PR loop

1. **Branch:** `git checkout -b <phase>/<issue-number>-<kebab-title>`
   - Example: `m0/1-jxa-spike`, `m1/36-task-list`
2. **Implement:** follow `coding.md`. Every new service method has docblock, typed errors, Goldilocks tests.
3. **Test:** `pnpm typecheck && pnpm lint && pnpm test`. If adapter-touching, also `OMNIFOCUS_INTEGRATION=1 pnpm test:integration`.
4. **Self-review via `review_pr.md`:** run the review on your own diff before asking humans. Catches more issues cheaply.
5. **Commit:** `commit.md` — atomic, Conventional Commits, `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. One concern per commit; split if the diff has multiple.
6. **Push + open PR:** `gh pr create` with the template from `.github/PULL_REQUEST_TEMPLATE.md`. Reference `Closes #N`. Then immediately, in this order:
   ```bash
   # a. Flip Status: In Progress → In Review
   flip_status "$ITEM_ID" "04079029" "In Review" "<N>"
   # b. Strip the in-progress label (the column has moved; the label follows)
   gh issue edit <N> --remove-label "status: in-progress"
   ```
7. **Merge when green.** `gh pr merge --squash`. Don't skip hooks (`--no-verify` is never the answer).
8. **Close-out checklist — run every step, in order. Do not skip even if you think the previous cycle covered it.**

   ```bash
   # a. Refresh PR state, then verify the issue auto-closed from "Closes #N"
   gh pr view <PR> --json state,merged,mergedAt --jq '{state, merged, mergedAt}'
   gh issue view <N> --json state --jq '.state'   # must print "CLOSED"

   # b. Flip project Status: In Review → Done (helper verifies persistence)
   flip_status "$ITEM_ID" "c2f7c066" "Done" "<N>"

   # c. Remove the in-progress label if it's still attached, then re-verify
   gh issue edit <N> --remove-label "status: in-progress" 2>/dev/null || true
   gh issue view <N> --json labels --jq '.labels[].name' | grep -q "^status: in-progress$" \
     && { echo "FATAL: status: in-progress label still attached on #<N>" >&2; exit 1; } \
     || echo "label: #<N> cleared"

   # d. Find dependents — handled in Tracker maintenance (§5) below
   gh issue list --state open --search "\"Blocked by: #<N>\"" --json number
   ```

   If any step a–c fails, stop and surface — do not continue to tracker maintenance with a half-closed issue. Drift on the board is worse than a skipped cycle.

If the work is larger than one session, complete one coherent slice. Leave the system in a **runnable, green-tests** state. Do not leave half-migrated seams or in-flight schema changes.

---

### 5. Tracker maintenance (don't skip this — this is how the board stays honest)

After the issue closes, before ending the session:

1. **Find dependents** — search open issues for `Blocked by: #<closed-number>`:

   ```bash
   gh issue list --state open --search "\"Blocked by: #<N>\"" --json number,title
   ```

2. **For each dependent:**
   - Check if it now has zero remaining open blockers
   - Resolve its `ITEM_ID` (see §3 step 2 pattern), then: `flip_status "$ITEM_ID" "19ebdd2c" "Up Next" "<M>"`
   - Add a comment if you moved it: `unblocked by closing #<N>`

3. **Update CHANGELOG.md** under `[Unreleased]` for anything user-visible (new tool, new env var, new error code, behavior change).

4. **Project board hygiene** — if any issue has drifted (In Progress for days with no commits → suggest `On Hold`; `On Hold` with a blocker that's now closed → back to `Up Next`): fix it.

---

### 6. Create new GitHub issues when (and only when) warranted

**Create a new issue if:**

- You discovered missing work not covered by any existing issue (check via `gh issue list --search "<keyword>"`)
- Scope creep on the current issue — spin off the extra as a separate issue rather than growing the current one
- You hit a bug unrelated to the current work — file it with repro steps; don't sidetrack the current session
- A spike is genuinely needed to unblock the current work — create it as `type: spike`, time-boxed, and pause the current work until the spike resolves
- An architectural decision surfaces that wasn't in ADRs — create a `type: spike` or a `needs-design` issue so it gets an ADR before code

**Do NOT create a new issue for:**

- Work trivially covered by the current issue or an existing one
- Vague "improve this" thoughts without concrete acceptance criteria
- Opinions without observable implications
- Things explicitly cut in `SPEC.md`'s "Out of Scope" section — reopening a cut is an ADR conversation, not an issue

**When creating, follow `tracker.md` issue-quality standards:**

```markdown
## Context
<Why this work exists + link to DESIGN §N / ADR-NNNN / SPEC section>

## Acceptance Criteria
- [ ] <Observable, testable outcome>
- [ ] All code follows `coding.md` standards

## Technical Notes
<Files, patterns, constraints>

## Dependencies
- Blocked by: #N
- Blocks: #M
```

Then `gh issue create` with:

- Title — verb-first imperative
- Labels — `type: X`, `PN · ...`, `size: X`, `phase: MX ...`, `domain: X`, optionally `risk: X`
- Milestone — matches phase
- Add to project #4 via `gh project item-add`
- Populate Phase / Priority / Size / Risk field values via GraphQL mutation (see `scripts/populate-project.sh` for the pattern)
- Set Status = `Up Next` if no blockers and the issue is triaged/well-specified; else `Backlog`

---

### 7. Report

End the session with a short, structured report. No trailing summary paragraphs.

**What was done**

> One paragraph: the change, its intent, and why it was the right next thing.
> Link the PR and the issue it closed.

**Board changes**

- Flipped: #N In Progress → In Review → Done
- Closed: #N, #M
- Unblocked (`Backlog` → `Up Next`): #X, #Y
- On Hold (if any): #Q — <one-line reason>
- Created: #Z (reason: …)

**Queue**

Top 3 items in `Up Next` after this cycle (what the next `/next` invocation will see at the top of the column):

| #   | Tier | Issue                                         | Rationale                                            |
| --- | ---- | --------------------------------------------- | ---------------------------------------------------- |
| 1   | T4   | #N <title>                                    | Top of `Up Next` post-close                          |
| 2   | T4   | #N <title>                                    | Parallelizable with #1                               |
| 3   | T2   | #N <title>                                    | Silent-failure risk if left until later in the phase |

Invoke `/next` again to execute the next item.

---

## Guardrails

- **Never commit, stage, or push without working within the Ready → In Progress → PR → Merge loop above.** Per user's standing rule, no unsolicited commits. In session, commits happen within the loop above; ad-hoc commits require explicit user direction.
- **Never merge to `main` without green CI.** Squash-merge via `--auto` waits for CI; use it.
- **Never skip hooks** (`--no-verify`). A hook failure means there's a real problem.
- **Never close an issue without verifying acceptance criteria are met.** If AC is ambiguous, clarify in a comment before closing.
- **Never delete a GitHub issue.** Close it (with a reason comment) or convert to a follow-up.
- **If stuck for more than 30 minutes** on a specific design decision, file it as a `needs-design` issue, write an ADR draft, and move to the next item.
- **If CI fails in a way you can't fix in ≤ 3 attempts**, revert the branch, file a bug issue with repro steps, and move on.

---

## Cadence expectation

One invocation of `/next` = one issue closed (or one spike note produced, or one blocked-dependent chain resolved). Not "all of M0 in one shot." Do one coherent thing well, report, and wait for the next invocation.

If an issue is too large for one session, close with a partial commit that leaves the system green + runnable, then file a follow-up issue for the remainder. Do not merge half-migrations.
