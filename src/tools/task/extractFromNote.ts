/**
 * `task_extract_from_note` MCP tool — turn prose into a triaged candidate-task list.
 *
 * The most common OF capture complaint: "I dumped a wall of text into a note
 * and now I have to break it apart task by task." This tool does the
 * mechanical split (numbered lists, bullets, imperative-verb sentences) and
 * leaves the judgment (which to keep, what to title, what to tag) to the
 * agent.
 *
 * Two-phase contract:
 *   1. `dryRun: true` (default) — read the source, return
 *      `{ proposed: ProposedTask[], unmappedLines: string[] }`. No writes.
 *   2. `dryRun: false` with `confirmation: ProposedTask[]` — create the
 *      confirmed tasks via `batchCreateTasks` semantics. The agent is
 *      expected to render `proposed` to the user, accept edits, and pass
 *      the (possibly edited) shape back as `confirmation`.
 *
 * Source can be a task's note, a project's note, or inline text — the
 * inline source enables the existing `capture-meeting` prompt to pipeline
 * into this tool without intermediate persistence.
 *
 * "atomic-ish per #475" in the original AC refers to a contract that #475
 * (inbox-triage prompt + task_batch_assign tool) hasn't shipped yet. v1
 * uses the existing `batchCreateTasks` best-effort semantics
 * (`BatchOutcome { succeeded, failed }`); revisit when #475 lands.
 *
 * @see #481 — initial implementation
 * @see src/domain/proseExtractor.ts — pure extractor
 * @see src/domain/batch.ts — BatchOutcome shape
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CreateTaskInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import { ProjectId, TaskId } from "../../domain/ids.js";
import { extractTasksFromProse } from "../../domain/proseExtractor.js";
import { summaryBatchCreate } from "../../domain/writeSummary.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_EXTRACT_FROM_NOTE_DESCRIPTION =
  "Mechanically split prose into a candidate-task list with source-line provenance. " +
  "Source can be a task's note (kind: 'task'), a project's note (kind: 'project'), or inline text " +
  "(kind: 'inline') — useful for piping a transcript through capture-meeting. " +
  "Two-phase contract: dryRun=true returns { proposed, unmappedLines }; dryRun=false with " +
  "confirmation: ProposedTask[] creates the (possibly-edited) tasks in targetProjectId via " +
  "batchCreateTasks semantics. Returns { phase: 'dryRun', proposed, unmappedLines } or " +
  "{ phase: 'created', outcome: BatchOutcome<TaskId> } accordingly. " +
  "Do NOT use this tool when you already have structured tasks — call task_batch_create " +
  "directly instead. Prefer this helper when the input is a wall-of-text note that needs splitting. " +
  "Side effects: dryRun=true is read-only; dryRun=false creates tasks in the target project. " +
  "Mutations do not sync automatically — call sync_trigger if cross-device visibility matters.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const proposedTaskSchema = z.object({
  name: z.string().min(1).describe("Task name."),
  note: z.string().optional().describe("Optional note body for the created task."),
  deferDate: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tag NAMES — resolved by the agent before passing here, since this tool does not look up tag IDs.",
    ),
  sourceLines: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      "1-based source line numbers from the original prose; preserved when surfacing proposals to the user.",
    ),
});

const sourceSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("task"),
      taskId: TaskId.schema.describe("Task whose note will be parsed."),
    }),
    z.object({
      kind: z.literal("project"),
      projectId: ProjectId.schema.describe("Project whose note will be parsed."),
    }),
    z.object({
      kind: z.literal("inline"),
      text: z.string().min(1).describe("Raw prose to parse — agent supplies directly."),
    }),
  ])
  .describe("Where to read prose from.");

// Inner object schema — exposes `.shape` for the MCP tool registration.
// The exported schema below applies the cross-field refinement; both share
// the same parsed type.
const taskExtractFromNoteInputBaseSchema = z.object({
  source: sourceSchema,
  targetProjectId: ProjectId.schema.describe(
    "Project that will receive created tasks on dryRun=false. Read-only on dryRun=true.",
  ),
  dryRun: z
    .boolean()
    .default(true)
    .describe("Default true — return proposals without creating. false requires confirmation[]."),
  confirmation: z
    .array(proposedTaskSchema)
    .optional()
    .describe(
      "Required when dryRun is false. The (possibly-edited) ProposedTask[] the agent has confirmed with the user.",
    ),
});

export const taskExtractFromNoteInputSchema = taskExtractFromNoteInputBaseSchema.refine(
  (v) => v.dryRun || v.confirmation !== undefined,
  {
    message: "confirmation[] is required when dryRun is false",
    path: ["confirmation"],
  },
);

export type TaskExtractFromNoteInput = z.infer<typeof taskExtractFromNoteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskExtractFromNoteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

/** Resolve the source's prose body. */
async function resolveSourceText(
  source: TaskExtractFromNoteInput["source"],
  adapter: OmniFocusAdapter,
): Promise<string> {
  if (source.kind === "inline") return source.text;
  if (source.kind === "task") {
    const task = await adapter.getTask(source.taskId);
    return task.note ?? "";
  }
  // project
  const project = await adapter.getProject(source.projectId);
  return project.note ?? "";
}

/** Pure handler — callable directly in unit tests. */
export async function handleTaskExtractFromNote(
  input: TaskExtractFromNoteInput,
  ctx: TaskExtractFromNoteContext,
) {
  const text = await resolveSourceText(input.source, ctx.adapter);
  const extracted = extractTasksFromProse(text);

  if (input.dryRun || !input.confirmation) {
    const meta = ctx.makeMeta();
    return ok(
      {
        phase: "dryRun" as const,
        proposed: extracted.proposed,
        unmappedLines: extracted.unmappedLines,
      },
      meta,
    );
  }

  // Write phase. Map confirmation[] to CreateTaskInput[]; tag NAMES come back
  // unresolved — the agent is expected to resolve to TagIds before calling.
  // We currently drop tag names rather than guess; the caller can include
  // tagIds via a separate task_update if needed.
  const adapterInputs: CreateTaskInput[] = input.confirmation.map((p) => ({
    name: p.name,
    projectId: input.targetProjectId,
    ...(p.note !== undefined && { note: p.note }),
    ...(p.deferDate !== undefined && { deferDate: p.deferDate }),
    ...(p.dueDate !== undefined && { dueDate: p.dueDate }),
  }));

  const outcome = await ctx.adapter.batchCreateTasks(adapterInputs);

  if (ctx.cache !== undefined && outcome.succeeded.length > 0) {
    invalidateTaskMutation(ctx.cache, { projectId: input.targetProjectId });
  }

  const meta = ctx.makeMeta({
    syncPending: outcome.succeeded.length > 0,
    humanReadableSummary: summaryBatchCreate(outcome.succeeded.length),
  });
  return ok(
    {
      phase: "created" as const,
      outcome,
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskExtractFromNoteTool(
  server: McpServer,
  ctx: TaskExtractFromNoteContext,
) {
  return server.registerTool(
    "task_extract_from_note",
    {
      description: TASK_EXTRACT_FROM_NOTE_DESCRIPTION,
      inputSchema: taskExtractFromNoteInputBaseSchema.shape,
    },
    async (args: TaskExtractFromNoteInput) => {
      const envelope = await handleTaskExtractFromNote(args, ctx);
      return toolResponse(envelope);
    },
  );
}
