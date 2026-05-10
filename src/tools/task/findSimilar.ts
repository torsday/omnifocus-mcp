/**
 * `task_find_similar` MCP tool — lexical-similarity nearest-neighbours.
 *
 * Agents capturing tasks from prose are good at *adding* and bad at
 * *recognizing duplicates*. "Call dentist" and "schedule dental cleaning"
 * are the same task to a human; without help, an agent treats them as
 * distinct and clutter accumulates. This tool returns the top-K candidates
 * by lexical signal so the agent has a concrete set to reason over before
 * deciding whether to create a new task.
 *
 * No embeddings, no model calls — the LLM is the judge, the tool produces
 * candidates. ADR conversation if a future version revisits.
 *
 * @see #469 — initial implementation
 * @see src/domain/textSimilarity.ts — pure scorer
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OmniFocusAdapter, TaskFilter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId, TagId } from "../../domain/ids.js";
import { NAME_MAX_CHARS } from "../../domain/inputLimits.js";
import type { Task } from "../../domain/task.js";
import { score } from "../../domain/textSimilarity.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_FIND_SIMILAR_DESCRIPTION =
  "Lexical nearest-neighbour search for de-duplicating tasks. Pass a candidate name " +
  "(and optional note) and receive the top-K most-similar existing tasks ranked by a " +
  "deterministic [0, 1] lexical-signal score (Jaccard token-overlap + prefix bonus + " +
  "exact-name boost). Title-dominant: a perfect title match outranks a perfect note " +
  "match. Use BEFORE task_create when you suspect a duplicate; the agent inspects the " +
  "candidates and decides whether to create new, link to existing, or merge. " +
  "Excludes completed and dropped tasks by default; opt-in via includeCompleted: true. " +
  "Optional scope { projectId } or { tagId } narrows the candidate set. " +
  "Returns { candidates: [{ taskId, name, score, project, tags }] } sorted by score descending — " +
  "project is { id, name } | null and tags is [{ id, name }, ...]. Names are paired alongside ids via a single getProjectsMany + single getTagsMany batch (no N+1) so the agent can describe each candidate without a follow-up read. " +
  "An empty result is { candidates: [] }, not an error. " +
  "Do NOT use this tool for general full-text search — call task_search for that. " +
  "Prefer this helper when the question is 'is this task already in the system?'. " +
  "No model calls; no side effects. Read-only. " +
  'Example: task_find_similar({ name: "Call dentist" }) ' +
  'Example: task_find_similar({ name: "Write report", scope: { projectId: "prj123" }, topK: 5 })';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const scopeSchema = z
  .object({
    projectId: ProjectId.schema.optional(),
    tagId: TagId.schema.optional(),
  })
  .refine((s) => !(s.projectId !== undefined && s.tagId !== undefined), {
    message: "Supply at most one of projectId or tagId",
  });

export const taskFindSimilarInputSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_CHARS, "max 1 KB").describe("The candidate task name to compare against existing tasks."),
  note: z
    .string()
    .optional()
    .describe(
      "Optional note text. When both the candidate and an existing task have a note, " +
        "note overlap contributes to the score as a tiebreaker.",
    ),
  scope: scopeSchema
    .optional()
    .describe(
      "Narrow the candidate set to one project or one tag. Mutually exclusive — " +
        "supply at most one. Omit to search all open tasks.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Top-K candidates to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
  includeCompleted: z
    .boolean()
    .default(false)
    .describe("When true, include completed and dropped tasks. Default false (open tasks only)."),
});

export type TaskFindSimilarInput = z.infer<typeof taskFindSimilarInputSchema>;

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface SimilarTaskCandidate {
  taskId: string;
  name: string;
  score: number;
  /** Containing project paired with its display name; null for inbox tasks or when the project has been deleted. */
  project: { id: string; name: string } | null;
  /** Tag ids paired with their display names; empty when the task has no tags. Orphan tags (deleted between read and lookup) are dropped. */
  tags: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskFindSimilarContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests. Builds the candidate set
 * via `adapter.listTasks` (with the scope filter), scores each against the
 * reference, sorts descending, and returns top-K with score > 0.
 *
 * Tasks with score 0 are filtered out — they share no signal with the
 * reference and would just be noise in the result.
 */
export async function handleTaskFindSimilar(
  input: TaskFindSimilarInput,
  ctx: TaskFindSimilarContext,
) {
  const filter: TaskFilter = input.includeCompleted ? {} : { completed: false };
  if (input.scope?.projectId !== undefined) filter.projectId = input.scope.projectId;
  if (input.scope?.tagId !== undefined) filter.tagId = input.scope.tagId;

  const tasks = await ctx.adapter.listTasks(filter);

  const reference = { name: input.name, ...(input.note !== undefined && { note: input.note }) };

  // Score, filter zero-signal tasks, sort, slice — but keep the *task*
  // shape until after we've batch-resolved id → name maps. That way the
  // batch only fetches names for tasks that survived the cut.
  const top = tasks
    .map((task: Task) => ({ task, s: score(reference, { name: task.name, note: task.note }) }))
    .filter((row) => row.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, input.limit);

  // Collect distinct ids across the trimmed candidate set.
  const projectIdSet = new Set<ProjectId>();
  const tagIdSet = new Set<TagId>();
  for (const { task } of top) {
    if (task.projectId !== null) projectIdSet.add(task.projectId);
    for (const tagId of task.tagIds) tagIdSet.add(tagId);
  }

  // One round trip per kind, regardless of how many candidates need names.
  const projectIds = [...projectIdSet];
  const tagIds = [...tagIdSet];
  const [projects, tags] = await Promise.all([
    projectIds.length > 0 ? ctx.adapter.getProjectsMany(projectIds) : Promise.resolve([]),
    tagIds.length > 0 ? ctx.adapter.getTagsMany(tagIds) : Promise.resolve([]),
  ]);

  // Build id → name maps. `null` slots in *Many results indicate the
  // record was deleted between the listTasks call and the lookup; drop
  // those orphans rather than fail the whole search.
  const projectNames = new Map<string, string>();
  projectIds.forEach((id, i) => {
    const p = projects[i];
    if (p !== null && p !== undefined) projectNames.set(String(id), p.name);
  });
  const tagNames = new Map<string, string>();
  tagIds.forEach((id, i) => {
    const t = tags[i];
    if (t !== null && t !== undefined) tagNames.set(String(id), t.name);
  });

  const scored: SimilarTaskCandidate[] = top.map(({ task, s }) => {
    const projectIdStr = task.projectId === null ? null : String(task.projectId);
    const projectName = projectIdStr === null ? null : (projectNames.get(projectIdStr) ?? null);
    return {
      taskId: String(task.id),
      name: task.name,
      score: s,
      project:
        projectIdStr === null
          ? null
          : projectName === null
            ? null // project orphaned — surface as null rather than emit a half-paired record
            : { id: projectIdStr, name: projectName },
      tags: task.tagIds
        .map((tagId) => {
          const idStr = String(tagId);
          const name = tagNames.get(idStr);
          return name === undefined ? null : { id: idStr, name };
        })
        .filter((t): t is { id: string; name: string } => t !== null),
    };
  });

  return ok({ candidates: scored }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskFindSimilarTool(server: McpServer, ctx: TaskFindSimilarContext) {
  return server.registerTool(
    "task_find_similar",
    {
      description: TASK_FIND_SIMILAR_DESCRIPTION,
      inputSchema: taskFindSimilarInputSchema.shape,
    },
    async (args: TaskFindSimilarInput) => {
      const envelope = await handleTaskFindSimilar(args, ctx);
      return toolResponse(envelope);
    },
  );
}
