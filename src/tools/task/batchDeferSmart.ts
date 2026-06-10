/**
 * `task_batch_defer_smart` — batch variant of `task_defer_smart` (per #479).
 *
 * Resolves an intent per task, then applies the resolved defer date through
 * the adapter. Each entry is independent — one resolution failure (e.g.
 * a malformed weekday) does not abort sibling tasks; the result envelope
 * carries per-task `success` / `error` rows so the agent can fix the bad
 * input without re-submitting the whole batch.
 *
 * @see src/tools/task/deferSmart.ts — single-task tool
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
import {
  idempotencyStore as defaultIdempotencyStore,
  type IdempotencyStore,
  withIdempotencyKey,
} from "../../server/idempotencyStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_BATCH_DEFER_SMART_DESCRIPTION =
  "Batch variant of task_defer_smart: accepts an array of { taskId, intent } and " +
  "resolves each intent independently. Same intent grammar as task_defer_smart. " +
  "Do NOT use this for a single task — prefer task_defer_smart for one entry. " +
  "Returns { results: [{ taskId, ok: true, resolvedDeferDate, reason } | { taskId, " +
  "ok: false, error }] } — per-entry failures surface inline so one malformed entry " +
  "does not abort the others. " +
  "Side effects: writes the resolved deferDate to each successful task; dry_run " +
  "skips writes. Triggers a sync when any entry succeeds. " +
  "Example: task_batch_defer_smart({ entries: [{ taskId: '...', intent: { kind: 'next-work-day' } }] })";

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

export const taskBatchDeferSmartInputSchema = z.object({
  entries: z
    .array(z.object({ taskId: TaskId.schema, intent: deferIntentSchema }))
    .min(1)
    .describe(
      "Array of { taskId, intent } pairs. Per-entry failures surface in the results array; " +
        "one bad entry does not abort siblings.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "When true, resolves every intent but does NOT write to OmniFocus. " +
        "Useful for previewing the batch's resolved dates before committing.",
    ),
  idempotency_key: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Idempotency key. Identical subsequent calls within the TTL window replay the original " +
        "results envelope with meta.idempotentReplay = true.",
    ),
});

export type TaskBatchDeferSmartInput = z.infer<typeof taskBatchDeferSmartInputSchema>;

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export type DeferResultRow =
  | { taskId: string; ok: true; resolvedDeferDate: string; reason: string }
  | { taskId: string; ok: false; error: string };

export interface TaskBatchDeferSmartData {
  results: DeferResultRow[];
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskBatchDeferSmartContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
  idempotencyStore?: IdempotencyStore;
  now?: () => Date;
  hours?: { morningHour: number; afternoonHour: number };
}

export async function handleTaskBatchDeferSmart(
  input: TaskBatchDeferSmartInput,
  ctx: TaskBatchDeferSmartContext,
): Promise<ToolEnvelope<TaskBatchDeferSmartData>> {
  const store = ctx.idempotencyStore ?? defaultIdempotencyStore;
  const now = ctx.now ? ctx.now() : new Date();
  const hours = ctx.hours ?? readDeferHoursFromEnv();

  return withIdempotencyKey(store, input.idempotency_key, async () => {
    const results: DeferResultRow[] = [];

    for (const entry of input.entries) {
      try {
        const resolved = resolveDeferIntent(entry.intent as DeferIntent, {
          now,
          morningHour: hours.morningHour,
          afternoonHour: hours.afternoonHour,
        });

        if (!input.dry_run) {
          await ctx.adapter.updateTask(entry.taskId, { deferDate: resolved.resolvedDeferDate });
          if (ctx.cache !== undefined) {
            const task = await ctx.adapter.getTask(entry.taskId);
            invalidateTaskMutation(ctx.cache, {
              taskId: entry.taskId,
              projectId: task.projectId,
              parentId: task.parentId,
            });
          }
        }

        results.push({
          taskId: entry.taskId,
          ok: true,
          resolvedDeferDate: resolved.resolvedDeferDate,
          reason: resolved.reason,
        });
      } catch (err) {
        results.push({
          taskId: entry.taskId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const metaPartial: Partial<ResponseMeta> = { syncPending: !input.dry_run };
    if (input.dry_run) metaPartial.dryRun = true;
    return ok({ results }, ctx.makeMeta(metaPartial));
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskBatchDeferSmartTool(
  server: McpServer,
  ctx: TaskBatchDeferSmartContext,
) {
  return server.registerTool(
    "task_batch_defer_smart",
    {
      description: TASK_BATCH_DEFER_SMART_DESCRIPTION,
      inputSchema: taskBatchDeferSmartInputSchema.shape,
    },
    async (args: TaskBatchDeferSmartInput) => {
      const envelope = await handleTaskBatchDeferSmart(args, ctx);
      return toolResponse(envelope);
    },
  );
}
