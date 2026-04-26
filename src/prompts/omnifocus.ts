/**
 * OmniFocus MCP prompt templates — four workflow guides for daily-review,
 * weekly-review, capture-meeting, and project-planning.
 *
 * Prompts are registered via `prompts/list` and returned as MCP message arrays
 * when the client calls `prompts/get`. Each returns a single `user`-role
 * message that instructs the agent to use the relevant OmniFocus tools and
 * resources in a structured workflow.
 *
 * Prompts do NOT execute tool calls themselves — they are templates. The LLM
 * reads the message and invokes the referenced tools autonomously.
 *
 * @see DESIGN.md §28 — MCP prompts spec (issue #132)
 * @see src/resources/omnifocus.ts — data resources referenced by daily/weekly prompts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Prompt names (exported for snapshot tests)
// ---------------------------------------------------------------------------

export const DAILY_REVIEW_PROMPT = "daily-review";
export const WEEKLY_REVIEW_PROMPT = "weekly-review";
export const CAPTURE_MEETING_PROMPT = "capture-meeting";
export const PROJECT_PLANNING_PROMPT = "project-planning";

// ---------------------------------------------------------------------------
// Message builders (pure functions — testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Build the `daily-review` message.
 *
 * Instructs the agent to load the snapshot + overdue + forecast resources,
 * then triage each group: clear overdue, plan due-today, decide on flagged.
 */
export function buildDailyReviewMessage(): string {
  return `You are running a daily OmniFocus review. Follow these steps in order:

1. **Load context** — read these three resources:
   - \`omnifocus://snapshot\`      (5-count orientation: inbox, overdue, due-today, flagged, review-due)
   - \`omnifocus://overdue\`       (tasks whose due date has passed, sorted oldest-first)
   - \`omnifocus://forecast/today\` (tasks due or deferred to today, plus flagged)

2. **Clear overdue** — for every task in \`overdue\`:
   - If it should be done today, leave it (it will appear in forecast/today too).
   - If it can be rescheduled, call \`task_update\` with a new \`dueDate\`.
   - If it should be dropped, call \`task_drop\` with a reason note.

3. **Plan due-today** — for every task in \`forecast/today.dueToday\`:
   - Confirm it is still relevant. If the due date should change, call \`task_update\`.
   - If it is already done, call \`task_complete\`.

4. **Decide on flagged** — for every task in \`forecast/today.flagged\`:
   - If it is genuinely today's priority, leave the flag.
   - If it should not be today, call \`task_update\` to remove the flag (\`flagged: false\`).

5. **Inbox zero** — if \`snapshot.inboxCount > 0\`, load \`omnifocus://inbox\` and process each
   task: assign to a project (\`task_update\` with \`projectId\`), add tags, or complete it.

6. **Report** — summarise what you did: counts of rescheduled, dropped, completed, and
   inbox-cleared tasks. Mention any items you left for the user to decide.`;
}

/**
 * Build the `weekly-review` message.
 *
 * Instructs the agent to walk through each project due for review and call
 * `project_mark_reviewed` after processing it.
 */
export function buildWeeklyReviewMessage(): string {
  return `You are running a weekly OmniFocus review. Follow these steps in order:

1. **Load review queue** — read \`omnifocus://review-due\` (projects whose review date has
   arrived, sorted by nextReviewDate ascending). If the list is empty, report "No projects
   due for review — you are up to date." and stop.

2. **For each project** in the review queue:
   a. Load the project's tasks: \`omnifocus://project/{id}\`.
   b. Check for stale tasks (no dueDate, no deferDate, untouched for > 2 weeks):
      flag them with a note or drop them if clearly irrelevant.
   c. Check whether the project is still active. If complete or abandoned, call
      \`project_complete\` or \`project_drop\`.
   d. If the project is healthy, call \`project_mark_reviewed\` to advance its
      next-review date.

3. **Capture new commitments** — if any stray tasks surfaced during review that belong to
   a project, call \`task_update\` to assign them.

4. **Report** — summarise: how many projects reviewed, how many marked complete/dropped,
   how many tasks rescheduled or cleaned up.`;
}

/**
 * Build the `capture-meeting` message for the given inputs.
 *
 * @param notes     Raw meeting notes to extract action items from.
 * @param projectId Optional target project. Defaults to inbox if omitted.
 */
export function buildCaptureMeetingMessage(notes: string, projectId?: string): string {
  const destination = projectId
    ? `the project with ID \`${projectId}\``
    : "the OmniFocus inbox (no `projectId`)";

  return `You are capturing action items from meeting notes. Follow these steps:

1. **Read the notes** below carefully.

2. **Extract every action item** — anything that someone committed to do, any follow-up
   question that needs answering, any decision that needs making. Be thorough; it is better
   to capture too many than too few.

3. **For each action item**, call \`task_create\` with:
   - \`name\`: a clear, specific task title (imperative, ≤ 80 chars).
   - \`projectId\`: assign to ${destination}.
   - \`note\`: the verbatim sentence from the notes that generated this task.
   - \`dueDate\`: if a specific date or deadline was mentioned.
   - If \`task_batch_create\` is available, use it instead to create all tasks in one call.

4. **Confirm** by listing the tasks you created (name + project).

---
### Meeting notes

${notes}`;
}

/**
 * Build the `project-planning` message for the given inputs.
 *
 * @param name      Project name.
 * @param brief     One-paragraph description of the project's goal.
 * @param folderId  Optional folder to place the project in.
 */
export function buildProjectPlanningMessage(
  name: string,
  brief: string,
  folderId?: string,
): string {
  const folderLine = folderId
    ? `   - \`folderId\`: \`${folderId}\``
    : "   - No folder (top-level project)";

  return `You are setting up a new OmniFocus project. Follow these steps:

1. **Create the project** — call \`project_create\` with:
   - \`name\`: \`${name}\`
${folderLine}
   - \`note\`: the brief below, verbatim, as the project note.

2. **Decompose the brief into subtasks** — read the brief carefully and derive a set of
   concrete, actionable tasks that together achieve the project goal. Aim for 5–15 tasks.
   Each task should be completable in ≤ 1 day. Use dependency order where it matters.

3. **Create the tasks** — for each derived task, call \`task_create\` with:
   - \`name\`: clear imperative title.
   - \`projectId\`: the ID returned by \`project_create\` in step 1.
   - \`note\`: any relevant detail or acceptance criterion.
   - \`dueDate\` / \`deferDate\`: only if meaningfully implied by the brief.
   - If \`task_batch_create\` is available, use it to create all tasks in one call.

4. **Confirm** — list the project name and all created task names.

---
### Project brief

${brief}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all four OmniFocus workflow prompts with the given McpServer.
 *
 * Prompts are pure templates — they return \`messages\` arrays and have no
 * side effects on the OmniFocus database.
 */
export function registerOmniFocusPrompts(server: McpServer): void {
  // ── daily-review ──────────────────────────────────────────────────────────
  server.registerPrompt(
    DAILY_REVIEW_PROMPT,
    {
      description:
        "Run a daily OmniFocus triage: load snapshot + overdue + forecast/today, " +
        "reschedule or drop overdue tasks, confirm due-today tasks, unflag low-priority flagged tasks, " +
        "and process the inbox. No parameters required.",
      argsSchema: {},
    },
    async () => ({
      messages: [{ role: "user", content: { type: "text", text: buildDailyReviewMessage() } }],
    }),
  );

  // ── weekly-review ─────────────────────────────────────────────────────────
  server.registerPrompt(
    WEEKLY_REVIEW_PROMPT,
    {
      description:
        "Run a weekly OmniFocus review: walk every project due for review, " +
        "check its tasks, mark it reviewed or complete/drop it, and clean up stale tasks. " +
        "No parameters required.",
      argsSchema: {},
    },
    async () => ({
      messages: [{ role: "user", content: { type: "text", text: buildWeeklyReviewMessage() } }],
    }),
  );

  // ── capture-meeting ───────────────────────────────────────────────────────
  server.registerPrompt(
    CAPTURE_MEETING_PROMPT,
    {
      description:
        "Extract action items from meeting notes and create OmniFocus tasks. " +
        "Pass raw notes as `notes`; optionally target a project with `projectId`. " +
        "Tasks land in the inbox when projectId is omitted.",
      argsSchema: {
        notes: z.string().min(1).describe("Raw meeting notes to extract action items from."),
        projectId: z
          .string()
          .optional()
          .describe("Persistent OmniFocus project ID to assign tasks to. Omit to use the inbox."),
      },
    },
    async ({ notes, projectId }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: buildCaptureMeetingMessage(notes, projectId) },
        },
      ],
    }),
  );

  // ── project-planning ─────────────────────────────────────────────────────
  server.registerPrompt(
    PROJECT_PLANNING_PROMPT,
    {
      description:
        "Create a new OmniFocus project and populate it with tasks derived from a brief. " +
        "Pass `name` and `brief`; optionally place it in a folder with `folderId`.",
      argsSchema: {
        name: z.string().min(1).describe("Name of the new project."),
        brief: z
          .string()
          .min(1)
          .describe("One-paragraph description of the project goal. Used to derive subtasks."),
        folderId: z
          .string()
          .optional()
          .describe("Persistent OmniFocus folder ID to place the project in. Omit for top-level."),
      },
    },
    async ({ name, brief, folderId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: buildProjectPlanningMessage(name, brief, folderId),
          },
        },
      ],
    }),
  );
}
