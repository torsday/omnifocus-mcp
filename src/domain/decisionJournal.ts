/**
 * Decision-journal metadata: agent memory of user judgment, attached to a
 * task or project via a fenced YAML block in its note (per #485).
 *
 * When an agent-driven scan flags a stalled project as an anomaly and the
 * user replies "yes I know, that's deliberate," the decision needs to live
 * somewhere durable. Without it, the next scan re-flags the same thing and
 * the agent looks dumb. This module is the typed lens over a `decision-journal`
 * fence in the note that records the kind of judgment, the reason, and an
 * optional auto-expiry — so future scans honor the decision until it's
 * either explicitly cleared or the expiry passes.
 *
 * @see src/domain/noteFences.ts — generic fence helper this builds on
 * @see src/domain/waitingOn.ts — sibling fence consumer (#482)
 * @see src/tools/decision/record.ts — decision_record tool
 * @see src/tools/decision/clear.ts — decision_clear tool
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

/** The fence tag used inside task / project notes. Stable wire format. */
export const DECISION_JOURNAL_FENCE = "decision-journal";

/**
 * The typed kinds of decision an agent can record. The set is closed at
 * write time (Zod enum) but extensible in subsequent versions — adding a new
 * kind is an additive schema change, not a breaking one.
 */
export type DecisionKind =
  | "stall-is-intentional"
  | "deferred-by-choice"
  | "blocked-on-external"
  | "awaiting-decision"
  | "acknowledged-zombie";

export const DECISION_KINDS: readonly DecisionKind[] = [
  "stall-is-intentional",
  "deferred-by-choice",
  "blocked-on-external",
  "awaiting-decision",
  "acknowledged-zombie",
] as const;

/** Decision-journal entry parsed from a task or project note. */
export interface Decision {
  /** Discriminator for downstream consumers (e.g. project_health). */
  kind: DecisionKind;
  /** Human-readable explanation of the decision. Required. */
  reason: string;
  /** ISO-8601-with-offset; when the decision was recorded. Set on write. */
  recordedAt: string;
  /**
   * Optional ISO-8601-with-offset auto-expiry. When `until` is in the past,
   * the decision is "expired" — `parseDecision` still returns the entry, but
   * `isDecisionActive` returns false. Consumers should use `isDecisionActive`
   * to decide whether to honor the decision.
   */
  until?: string;
}

export const decisionSchema: z.ZodType<Decision> = z.object({
  kind: z.enum(DECISION_KINDS).describe("The kind of judgment recorded."),
  reason: z.string().min(1).describe("Human-readable reason for the decision."),
  recordedAt: isoDateString().describe("When the decision was recorded (ISO-8601 with offset)."),
  until: isoDateString()
    .optional()
    .describe(
      "Optional auto-expiry. When set and in the past, the decision is treated as expired " +
        "and downstream consumers re-surface the target.",
    ),
}) as z.ZodType<Decision>;

/**
 * Parse a `Decision` from a task or project note, or return undefined when
 * no fence is present or the fence content is malformed.
 *
 * Malformed fences degrade silently — the user might have edited the note
 * by hand. Tools that consume the parsed value should treat `undefined` as
 * "no decision recorded."
 */
export function parseDecision(note: string | null): Decision | undefined {
  const match = findFence(note, DECISION_JOURNAL_FENCE);
  if (match === undefined) return undefined;
  const fields = parseFenceBody(match.body);
  const candidate: Record<string, unknown> = {};
  if (typeof fields.kind === "string" && fields.kind.length > 0) candidate.kind = fields.kind;
  if (typeof fields.reason === "string" && fields.reason.length > 0) {
    candidate.reason = fields.reason;
  }
  if (typeof fields.recordedAt === "string" && fields.recordedAt.length > 0) {
    candidate.recordedAt = fields.recordedAt;
  }
  if (typeof fields.until === "string" && fields.until.length > 0) candidate.until = fields.until;
  const parsed = decisionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Returns true when the decision should be honored at `now`:
 *
 * - `until` is unset → always active (the user did not bound it).
 * - `until` is in the future → active.
 * - `until` is in the past → expired, the next scan should re-surface the target.
 *
 * Project-health (slice 2 of #485) is the primary consumer.
 */
export function isDecisionActive(decision: Decision, now: Date = new Date()): boolean {
  if (decision.until === undefined) return true;
  return new Date(decision.until).getTime() > now.getTime();
}

/**
 * Write or replace the `decision-journal` fence in a note, returning the new
 * note body. Field order in the fence is stable: kind, reason, recordedAt, until.
 */
export function writeDecision(note: string | null, entry: Decision): string {
  const body = serializeFenceBody({
    kind: entry.kind,
    reason: entry.reason,
    recordedAt: entry.recordedAt,
    until: entry.until,
  });
  return upsertFence(note, DECISION_JOURNAL_FENCE, body);
}

/**
 * Strip the `decision-journal` fence from a note. Returns null when the
 * resulting note would be empty (so a clear-only operation leaves the note
 * cleared rather than holding an empty string).
 */
export function clearDecision(note: string | null): string | null {
  return removeNoteFence(note, DECISION_JOURNAL_FENCE);
}
