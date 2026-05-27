/**
 * Workflow registry — single source of truth for which fixture
 * workflows the latency bench measures (#941).
 *
 * Reuses the token-cost workflow definitions directly. The same
 * canonical user journeys (inbox triage, weekly review, project
 * planning, end-of-day review) get measured for both wire bytes
 * (token-cost, hermetic) and wall-clock (latency, real JXA).
 *
 * `largePagination` is intentionally **excluded** here: it asserts
 * exact page-count invariants against its own 120-task seed; running
 * it against a real OmniFocus database (with whatever the user has)
 * would either fail the invariant or pollute their data. File a
 * follow-up if pagination latency turns out to be a separate concern
 * worth its own fixture.
 */

import type { Bench, BenchToolContext } from "../token-cost/runBench.js";
import { runEndOfDayReview } from "../token-cost/workflows/endOfDayReview.js";
import { runInboxTriage } from "../token-cost/workflows/inboxTriage.js";
import { runProjectPlanning } from "../token-cost/workflows/projectPlanning.js";
import { runWeeklyReview } from "../token-cost/workflows/weeklyReview.js";

export type WorkflowRunner = (ctx: BenchToolContext) => Promise<Bench>;

/** Tuple form so callers iterate in a stable, declaration order. */
export const WORKFLOWS: ReadonlyArray<readonly [string, WorkflowRunner]> = [
  ["inbox-triage", runInboxTriage],
  ["weekly-review", runWeeklyReview],
  ["project-planning", runProjectPlanning],
  ["end-of-day-review", runEndOfDayReview],
] as const;

/** Lookup helper used by the worker (`--workflow <name>`). */
export function lookupWorkflow(name: string): WorkflowRunner | undefined {
  return WORKFLOWS.find(([id]) => id === name)?.[1];
}

/** Names only — used by the parent CLI when planning which workers to spawn. */
export function workflowNames(): readonly string[] {
  return WORKFLOWS.map(([id]) => id);
}
