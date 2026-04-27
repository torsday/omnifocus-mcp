/**
 * Waiting-on metadata: structured "waiting for whom on what" data attached to
 * a task via a fenced YAML block in its note.
 *
 * OmniFocus has no first-class task dependencies — users hack with a
 * `@waiting` tag and lose all the "whom / what / since when / follow up after"
 * context. This module is the typed lens over a fenced block in the note that
 * records that context so an agent can systematize follow-ups.
 *
 * @see src/domain/noteFences.ts — generic fence helper this builds on
 * @see src/tools/task/waitingOn.ts — task_set_waiting_on / task_clear_waiting_on
 * @see src/resources/waitingOn.ts — omnifocus://waiting-on aggregator
 */

import { z } from "zod";
import { isoDateString } from "./dates.js";
import {
  findFence,
  parseFenceBody,
  removeFence as removeNoteFence,
  serializeFenceBody,
  upsertFence,
} from "./noteFences.js";

/** The fence tag used inside task notes. Stable wire format. */
export const WAITING_ON_FENCE = "waiting-on";

/** Structured waiting-on entry parsed from a task note. */
export interface WaitingOn {
  /** Person, team, or system being waited on. Required. */
  whom: string;
  /** Optional short description of what is being waited on. */
  what?: string;
  /** ISO-8601-with-offset; when waiting started. Required. Defaults to now at write time. */
  since: string;
  /** ISO-8601-with-offset; nudge if still unresolved past this date. */
  followUpAfter?: string;
}

export const waitingOnSchema: z.ZodType<WaitingOn> = z.object({
  whom: z.string().min(1).describe("Person, team, or system being waited on."),
  what: z.string().min(1).optional().describe("Short description of what is being waited on."),
  since: isoDateString().describe("When the wait started (ISO-8601 with offset)."),
  followUpAfter: isoDateString()
    .optional()
    .describe("When the agent should nudge if still unresolved (ISO-8601 with offset)."),
}) as z.ZodType<WaitingOn>;

/**
 * Parse a `WaitingOn` entry from a task note, or return undefined when no
 * fence is present or the fence content is malformed.
 *
 * Malformed fences degrade silently: a user editing the note by hand should
 * see "the structured field is gone" rather than every read failing with an
 * error. The fence text itself remains in the note for the user to fix.
 */
export function parseWaitingOn(note: string | null): WaitingOn | undefined {
  const match = findFence(note, WAITING_ON_FENCE);
  if (match === undefined) return undefined;
  const fields = parseFenceBody(match.body);
  const candidate: Record<string, unknown> = {};
  if (typeof fields.whom === "string" && fields.whom.length > 0) candidate.whom = fields.whom;
  if (typeof fields.what === "string" && fields.what.length > 0) candidate.what = fields.what;
  if (typeof fields.since === "string" && fields.since.length > 0) candidate.since = fields.since;
  if (typeof fields.followUpAfter === "string" && fields.followUpAfter.length > 0) {
    candidate.followUpAfter = fields.followUpAfter;
  }
  const parsed = waitingOnSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Write or replace the `waiting-on` fence in a note, returning the new note
 * body. Field order in the fence is stable: whom, what, since, followUpAfter.
 */
export function writeWaitingOn(note: string | null, entry: WaitingOn): string {
  const body = serializeFenceBody({
    whom: entry.whom,
    what: entry.what,
    since: entry.since,
    followUpAfter: entry.followUpAfter,
  });
  return upsertFence(note, WAITING_ON_FENCE, body);
}

/**
 * Strip the `waiting-on` fence from a note. Returns null when the resulting
 * note would be empty (so a clear-only operation leaves the note cleared
 * rather than holding an empty string).
 */
export function clearWaitingOn(note: string | null): string | null {
  return removeNoteFence(note, WAITING_ON_FENCE);
}

/**
 * Compute days-overdue for a follow-up reference time:
 *
 * - `null` when `followUpAfter` is unset or in the future.
 * - Otherwise the integer number of whole days elapsed past `followUpAfter`,
 *   measured from `now` (defaults to the current time).
 *
 * Same-day follow-ups return 0; partial days truncate (no rounding up).
 */
export function daysOverdue(entry: WaitingOn, now: Date = new Date()): number | null {
  if (entry.followUpAfter === undefined) return null;
  const target = new Date(entry.followUpAfter).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = now.getTime() - target;
  if (diffMs < 0) return null;
  return Math.floor(diffMs / 86_400_000);
}
