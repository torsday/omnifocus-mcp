# GitHub Project — recommended views

> The GitHub Projects v2 public GraphQL API does not expose view-creation mutations, so **views must be set up in the web UI** once. This document walks through creating the five recommended views for the `omnifocus-mcp v1` project board. Total time: ~3 minutes.

**Project URL:** [github.com/users/torsday/projects/4](https://github.com/users/torsday/projects/4)

The repo's bootstrap already created:

- Six custom fields: **Status**, **Phase**, **Priority**, **Size**, **Risk** (+ GitHub's built-in Labels, Milestone, Repository)
- **Status** option set expanded to: `Ready` · `Todo` · `In Progress` · `In Review` · `Blocked` · `Done`
- 91 issues populated with Phase / Priority / Size / Risk field values derived from labels
- 25 unblocked issues flipped to `Status = Ready`; the other 66 default to `Todo`

Once the views below are laid out, the board becomes a live picture of what's ready now, what's moving, and what's stuck. See [`dependency-graph.md`](./dependency-graph.md) for the shape behind those 25 Ready items.

All that remains is laying out the views below.

---

## View 1 — Kanban (by Status)

**Purpose:** day-to-day execution board. Drag issues across status columns.

1. Click the **+** next to the current view tab
2. Name it `🗂️ Kanban`
3. Layout: **Board**
4. Group by: **Status**
5. Visible fields (click "Fields" → toggle): `Title`, `Labels`, `Priority`, `Size`, `Phase`, `Risk`, `Milestone`
6. Sort by: `Priority` ascending, then `Phase` ascending (so P0 M0 items bubble to the top of the `Ready` column)
7. Save view

Six status columns appear: `Ready` (pick from here) → `Todo` (queued behind dependencies) → `In Progress` → `In Review` → `Blocked` → `Done`. The `Ready` column should start with ~25 items; drag into `In Progress` as you pick them up.

---

## View 2 — Roadmap (by Phase)

**Purpose:** see the whole v1 release plan at a glance. Each phase is a column.

1. Click **+** for a new view
2. Name it `🗺️ Roadmap by Phase`
3. Layout: **Board**
4. Group by: **Phase**
5. Visible fields: `Title`, `Priority`, `Size`, `Status`, `Risk`
6. Sort by: `Priority` ascending
7. Save

Phase columns appear in order: M0 → M1 → M2 → M3 → M4 → M5.

---

## View 3 — Priority Focus (table)

**Purpose:** quick "what should I pick up next" query.

1. Click **+** for a new view
2. Name it `🎯 By Priority`
3. Layout: **Table**
4. Group by: **Priority**
5. Filter: `-status:Done` (hide completed)
6. Visible fields: `Title`, `Phase`, `Size`, `Risk`, `Status`, `Labels`, `Milestone`
7. Sort by: `Phase` ascending, then `Size` ascending
8. Save

The P0 group at the top lists every critical item across all phases.

---

## View 4 — Risk Register (filtered table)

**Purpose:** surface risk-bearing work that needs extra review / test-first / phased rollout.

1. Click **+** for a new view
2. Name it `⚠️ Risk Register`
3. Layout: **Table**
4. Filter: `risk:High,Medium`
5. Group by: **Risk**
6. Visible fields: `Title`, `Phase`, `Priority`, `Size`, `Status`, `Labels`
7. Sort by: `Priority` ascending
8. Save

At v1 launch, expect ~3–5 High-risk items (raw-script escape hatch, hard-delete operations) and ~15–20 Medium-risk items.

---

## View 5 — Domain map (table grouped by label)

**Purpose:** see the work organized by OmniFocus domain (task, project, tag, perspective, etc.) — useful when onboarding a contributor to one area.

1. Click **+** for a new view
2. Name it `🔖 By Domain`
3. Layout: **Table**
4. Group by: **Labels** (GitHub groups by the first matching label alphabetically; domain labels all start with `domain:` so they group together)
5. Filter: `label:"domain: task","domain: project","domain: tag","domain: folder","domain: perspective","domain: forecast","domain: review","domain: search","domain: note","domain: attachment","domain: repetition","domain: batch","domain: export","domain: sync","domain: transport","domain: observability","domain: security","domain: lifecycle","domain: config","domain: resources"`
6. Visible fields: `Title`, `Phase`, `Priority`, `Size`, `Status`
7. Save

---

## Optional additions

- **Spikes only** — filter `type:spike`, group by `Phase`. Tracks research work separately.
- **M0 only — detail table** — filter `phase:"M0 foundation"`, table layout, all fields visible. For the foundation-phase sprint.
- **Weekly check-in** — filter `-status:Done`, sort by `Priority` then created date, visible: Title / Status / Phase / last-updated. For a quick Monday scan.

---

## Why these views

- **Kanban** is the execution interface — one per-status column, drag to progress.
- **Roadmap** shows the arc of the release; good for stakeholder review.
- **Priority Focus** answers "what next?" when capacity opens up.
- **Risk Register** surfaces the failure-likelihood-weighted backlog — test-first candidates, review-required items, phased-rollout candidates.
- **Domain map** is the onboarding aid — a new contributor joins the "attachments" or "observability" work stream and sees exactly their slice.

Together they cover four planning questions (what's next? what's at risk? what's this phase? what's in this domain?) and one execution question (what's in progress?).

## Default sort for every view

Unless a view has a specific reason otherwise, the default sort order is:

1. **Priority** ascending (P0 · critical → P3 · low)
2. **Phase** ascending (M0 → M5)
3. **Size** ascending (XS → XL)

Apply this to the default "View 1" as well — click the sort icon (↕) in the Title column, then add secondary sorts via `+ Sort by`. That bubbles every XS-sized P0 M0 item to the top wherever you look.
