/**
 * Hint type and helpers for the `hints[]` array on `ok` responses.
 *
 * Per ADR-0015, every `ToolSuccess` envelope may carry an optional `hints[]`
 * array — server-suggested follow-ups that let tools share domain knowledge
 * with the agent without making the advice mandatory.
 *
 * **Emission policy:**
 * - Hints are opt-in per tool; tools that have nothing useful to say omit
 *   the field entirely (not `[]`).
 * - Hints are opt-in per call site — the same tool may hint on some inputs
 *   and not others.
 * - Cap: ≤ 3 hints per response. `capHints` enforces this and picks
 *   highest-severity entries when the list exceeds the cap.
 * - Severity gate: when `OMNIFOCUS_HINT_LEVEL=warn`, only `severity: "warn"`
 *   hints are emitted. See `filterHintsBySeverity`.
 *
 * @see docs/adr/0015-nl-excellence-response-envelope.md — shape decision
 * @see src/envelope/index.ts — ToolSuccess.hints field
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Closed discriminator for hint categories.
 * New kinds are a minor-version addition per ADR-0011.
 */
export type HintKind =
  /** A follow-up read would enrich the picture beyond what the response already shows. */
  | "missing-detail"
  /** A likely-next mutation would conflict with current state. */
  | "would-conflict"
  /** A tool that commonly follows this one; the agent may auto-route. */
  | "next-natural-step"
  /** A better-fitting tool exists for what the agent likely wants next. */
  | "consider-alternative"
  /** The agent is operating on a cached or stale view; refresh recommended. */
  | "stale-data";

/**
 * A single hint on an `ok` response.
 *
 * Agents are not required to act on hints; ignoring them has zero side effects.
 * When `suggestedTool` is present, the agent may pre-populate a follow-up call
 * with `suggestedArgs` to reduce round-trips.
 */
export interface Hint {
  /** Closed category discriminator — agents switch on this. */
  kind: HintKind;
  /** Human-readable one-sentence explanation. Agent may quote. */
  reason: string;
  /** Canonical tool name the agent could invoke as a follow-up. */
  suggestedTool?: string;
  /** Partial args for `suggestedTool`; the agent fills in the rest. */
  suggestedArgs?: Record<string, unknown>;
  /**
   * Advisory importance. Defaults to `"info"`.
   * `"warn"` means ignoring is risky but not blocking.
   */
  severity?: "info" | "warn";
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Build a `missing-detail` hint. */
export function missingDetailHint(
  reason: string,
  opts: Pick<Hint, "suggestedTool" | "suggestedArgs" | "severity"> = {},
): Hint {
  return { kind: "missing-detail", reason, ...opts };
}

/** Build a `would-conflict` hint. */
export function wouldConflictHint(
  reason: string,
  opts: Pick<Hint, "suggestedTool" | "suggestedArgs" | "severity"> = {},
): Hint {
  return { kind: "would-conflict", reason, ...opts };
}

/** Build a `next-natural-step` hint. */
export function nextNaturalStepHint(
  reason: string,
  opts: Pick<Hint, "suggestedTool" | "suggestedArgs" | "severity"> = {},
): Hint {
  return { kind: "next-natural-step", reason, ...opts };
}

/** Build a `consider-alternative` hint. */
export function considerAlternativeHint(
  reason: string,
  opts: Pick<Hint, "suggestedTool" | "suggestedArgs" | "severity"> = {},
): Hint {
  return { kind: "consider-alternative", reason, ...opts };
}

/** Build a `stale-data` hint. */
export function staleDataHint(
  reason: string,
  opts: Pick<Hint, "suggestedTool" | "suggestedArgs" | "severity"> = {},
): Hint {
  return { kind: "stale-data", reason, ...opts };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Soft cap: keep at most `max` hints, preferring `"warn"` severity over `"info"`. */
export function capHints(hints: Hint[], max = 3): Hint[] {
  if (hints.length <= max) return hints;
  // Warn-severity hints are higher priority; stable sort by severity
  const sorted = [...hints].sort((a, b) => {
    const aW = (a.severity ?? "info") === "warn" ? 0 : 1;
    const bW = (b.severity ?? "info") === "warn" ? 0 : 1;
    return aW - bW;
  });
  return sorted.slice(0, max);
}

/**
 * When `OMNIFOCUS_HINT_LEVEL=warn`, strip `"info"` hints so the array
 * only surfaces actionable warnings. Default (any other value / unset):
 * return all hints unchanged.
 */
export function filterHintsBySeverity(hints: Hint[]): Hint[] {
  if (process.env.OMNIFOCUS_HINT_LEVEL === "warn") {
    return hints.filter((h) => (h.severity ?? "info") === "warn");
  }
  return hints;
}

/**
 * Convenience: apply both the severity gate and the soft cap.
 * Call this at every hint-emitting tool site before passing to `ok()`.
 */
export function finaliseHints(hints: Hint[], max = 3): Hint[] | undefined {
  const filtered = filterHintsBySeverity(hints);
  const capped = capHints(filtered, max);
  return capped.length > 0 ? capped : undefined;
}

// ---------------------------------------------------------------------------
// Per-tool hint detectors (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Regex for recurring-event cues in a task name.
 * Matches: "daily", "weekly", "monthly", "every day/week/month/Tuesday/…"
 */
const REPETITION_CUE_RE =
  /\b(daily|weekly|monthly|every\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend))\b/i;

/**
 * Return a `next-natural-step` hint toward `task_set_repetition` if the task
 * name contains a recurrence cue.
 */
export function repeatHintForName(taskId: string, name: string): Hint | undefined {
  if (!REPETITION_CUE_RE.test(name)) return undefined;
  return nextNaturalStepHint(
    "Task name contains a recurrence cue — setting a repetition rule keeps it rescheduled automatically.",
    { suggestedTool: "task_set_repetition", suggestedArgs: { id: taskId }, severity: "info" },
  );
}

/**
 * Return a `missing-detail` hint if a due date was set but no time estimate.
 */
export function estimateHintForDue(
  taskId: string,
  dueDate: string | undefined,
  estimatedMinutes: number | undefined,
): Hint | undefined {
  if (dueDate === undefined || estimatedMinutes !== undefined) return undefined;
  return missingDetailHint(
    "Task has a due date but no time estimate — an estimate helps schedule the task accurately.",
    { suggestedTool: "task_update", suggestedArgs: { id: taskId }, severity: "info" },
  );
}

/**
 * Return a `consider-alternative` hint if the inbox now contains `count`
 * unrouted tasks (>= the `threshold`, default 5).
 */
export function inboxGrowthHint(count: number, threshold = 5): Hint | undefined {
  if (count < threshold) return undefined;
  return considerAlternativeHint(
    `Inbox now has ${count} unrouted tasks — consider triaging to keep your inbox clear.`,
    { suggestedTool: "task_list", suggestedArgs: { inbox: true }, severity: "info" },
  );
}

/**
 * Return a `next-natural-step` hint toward `review_set_interval` if the
 * project was created without a review interval.
 */
export function reviewIntervalHint(
  projectId: string,
  reviewIntervalDays: number | undefined,
): Hint | undefined {
  if (reviewIntervalDays !== undefined) return undefined;
  return nextNaturalStepHint(
    "Project has no review interval — setting one ensures it surfaces in regular review.",
    {
      suggestedTool: "project_update",
      suggestedArgs: { id: projectId, reviewIntervalDays: 7 },
      severity: "info",
    },
  );
}

/**
 * Return a `next-natural-step` hint if the project just hit zero remaining
 * (non-completed, non-dropped) tasks after a completion.
 */
export function projectEmptyHint(projectId: string, projectName: string): Hint {
  return nextNaturalStepHint(
    `Project '${projectName}' now has no remaining tasks — consider completing or reviewing the project.`,
    {
      suggestedTool: "project_complete",
      suggestedArgs: { id: projectId },
      severity: "info",
    },
  );
}
