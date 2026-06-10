/**
 * `task_defer_smart` MCP tool — intent-bearing defer-date grammar (per #479).
 *
 * Wraps `task_update` with a high-level intent ("next work morning",
 * "skip weekends", "in 3 business days") so agents stop landing tasks
 * on weekends or 11pm. The grammar is encoded in `DeferIntent` (see
 * `src/domain/dateGrammar.ts`); resolution is pure and synchronous so
 * tests inject `now` deterministically.
 *
 * Output includes `resolvedDeferDate` and a human-readable `reason`,
 * letting the agent surface "deferred to Tue 28 Apr 09:00 (next work
 * morning)" verbatim to the user.
 *
 * @see docs/adr/0007-dates-iso8601-with-offset.md
 * @see src/domain/dateGrammar.ts — pure resolver
 * @see src/tools/task/batchDeferSmart.ts — batch variant
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import {
  type DeferIntent,
  readDeferHoursFromEnv,
  resolveDeferIntent,
} from "../../domain/dateGrammar.js";
import { TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, type ToolEnvelope, toolResponse } from "../../envelope/index.js";
import { assertNotModifiedSince } from "../../server/assertNotModifiedSince.js";
import { dryRunGuard } from "../../server/dryRunGuard.js";
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_DEFER_SMART_DESCRIPTION =
  "Defer a task to a date computed from a high-level intent (e.g. 'next work morning', " +
  "'skip weekends', 'in 3 business days'), instead of guessing an ISO date that may " +
  "land on a weekend or off-hours. Variants: next-work-day, next-weekday, " +
  "in-business-days, after-event (gated on calendar bridge), next-month-start, " +
  "explicit-with-skip-weekends. Morning/afternoon defaults are configurable via " +
  "OMNIFOCUS_MORNING_HOUR / OMNIFOCUS_AFTERNOON_HOUR env (default 09:00 / 14:00). " +
  "Do NOT use this for unconditional ISO-date defers — prefer task_update with deferDate. " +
  "Returns { taskId, resolvedDeferDate, reason } so the agent can echo the resolved " +
  "date verbatim. " +
  "Side effects: writes the resolved deferDate via task_update; supports dry_run, " +
  "idempotency_key, and expectedModifiedAt for safety. Triggers a sync. " +
  "Example: task_defer_smart({ taskId: '...', intent: { kind: 'next-work-day' } })";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const timeOfDay = z.enum(["morning", "afternoon"]);

const deferIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("next-work-day"), at: timeOfDay.optional() }),
  z.object({
    kind: z.literal("next-weekday"),
    weekday: z.number().int().min(0).max(6),
    at: timeOfDay.optional(),
  }),
  z.object({ kind: z.literal("in-business-days"), days: z.number().int().positive() }),
  z.object({ kind: z.literal("after-event"), eventId: z.string().min(1) }),
  z.object({ kind: z.literal("next-month-start") }),
  z.object({
    kind: z.literal("explicit-with-skip-weekends"),
    date: z.string().min(1),
  }),
]);

export const taskDeferSmartInputSchema = z.object({
  taskId: TaskId.schema.describe("ID of the task to defer."),
  intent: deferIntentSchema.describe(
    "High-level defer intent. Discriminated union on `kind` — see tool description for variants.",
  ),
  expectedModifiedAt: z
    .string()
    .optional()
    .describe(
      "Optimistic-concurrency guard: ISO-8601 timestamp from a recent task_get. " +
        "If the task's current modifiedAt differs, the call fails with OF_CONFLICT and no update is performed. Omit to skip the check.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "When true, validates input and resolves the intent but does NOT write to OmniFocus. " +
        "Returns the resolved date + reason in the response with meta.dryRun = true.",
    ),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key for retry-safe defers. Identical subsequent calls within the TTL window " +
        "replay the original envelope with meta.idempotentReplay = true instead of re-applying.",
    ),
});

export type TaskDeferSmartInput = z.infer<typeof taskDeferSmartInputSchema>;

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface TaskDeferSmartData {
  taskId: string;
  resolvedDeferDate: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskDeferSmartContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  idempotencyStore?: IdempotencyStore;
  /** Inject `now` for tests; defaults to wall clock. */
  now?: () => Date;
  /** Inject morning/afternoon hours for tests; defaults to env. */
  hours?: { morningHour: number; afternoonHour: number };
}

export async function handleTaskDeferSmart(
  input: TaskDeferSmartInput,
  ctx: TaskDeferSmartContext,
): Promise<ToolEnvelope<TaskDeferSmartData>> {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;
  const now = ctx.now ? ctx.now() : new Date();
  const hours = ctx.hours ?? readDeferHoursFromEnv();

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    // Optimistic-concurrency guard — same placement as task_update /
    // task_delete: pre-fetch, then ConflictError on a stale guard before
    // any write (a no-op when expectedModifiedAt is omitted).
    const task = await ctx.adapter.getTask(input.taskId);
    assertNotModifiedSince(input.expectedModifiedAt, task.modifiedAt, `task:${input.taskId}`);

    const resolved = resolveDeferIntent(input.intent as DeferIntent, {
      now,
      morningHour: hours.morningHour,
      afternoonHour: hours.afternoonHour,
    });

    const preview = (): ToolEnvelope<TaskDeferSmartData> =>
      ok(
        {
          taskId: input.taskId,
          resolvedDeferDate: resolved.resolvedDeferDate,
          reason: resolved.reason,
        },
        ctx.makeMeta({ syncPending: false }),
      );

    const live = async (): Promise<ToolEnvelope<TaskDeferSmartData>> => {
      await ctx.adapter.updateTask(input.taskId, { deferDate: resolved.resolvedDeferDate });
      if (ctx.cache !== undefined) {
        invalidateTaskMutation(ctx.cache, {
          taskId: input.taskId,
          projectId: task.projectId,
          parentId: task.parentId,
        });
      }
      return ok(
        {
          taskId: input.taskId,
          resolvedDeferDate: resolved.resolvedDeferDate,
          reason: resolved.reason,
        },
        ctx.makeMeta({ syncPending: true }),
      );
    };

    return dryRunGuard(input.dry_run, preview, live);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskDeferSmartTool(server: McpServer, ctx: TaskDeferSmartContext) {
  return server.registerTool(
    "task_defer_smart",
    {
      description: TASK_DEFER_SMART_DESCRIPTION,
      inputSchema: taskDeferSmartInputSchema.shape,
    },
    async (args: TaskDeferSmartInput) => {
      const envelope = await handleTaskDeferSmart(args, ctx);
      return toolResponse(envelope);
    },
  );
}
