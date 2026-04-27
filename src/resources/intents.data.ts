/**
 * Curated intent → tool-sequence mappings for `omnifocus://intents`.
 *
 * Eighty registered tools is too many for an agent to plan over confidently
 * when the user says "process my inbox" or "what's on my plate today." Eight
 * verbs is the right cardinality for human-style intent. This file is the
 * bridge.
 *
 * **The agent is not constrained by this file.** It can call any tool
 * directly. The point is to make the obvious paths obvious — so the agent's
 * first move on common intents is right.
 *
 * Curation discipline:
 * - Every intent has at least one alias and a one-sentence description in
 *   the user's voice ("when I say X, you should…")
 * - Reject entries that read like a tool's own description
 * - Every `kind: "tool"` step's `name` MUST be a registered tool — see
 *   intents.test.ts for the lint
 * - Forward-looking entries (referencing tools / prompts / resources not yet
 *   landed) are NOT included. Add them when the implementing ticket closes.
 *
 * @see #495 — initial implementation
 * @see #491 — NL-excellence epic
 * @see DESIGN.md "NL excellence layer — intents"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One step in an intent's recommended sequence. The agent fills any
 * `{placeholder}` values in `args` from user input or prior turns.
 */
export type IntentStep =
  | { kind: "tool"; name: string; args?: Record<string, unknown> }
  | { kind: "prompt"; name: string }
  | { kind: "resource"; uri: string };

/** Top-level intent category — one of eight verbs. */
export type IntentCategory =
  | "capture"
  | "plan"
  | "review"
  | "triage"
  | "retrospect"
  | "share"
  | "audit"
  | "automate";

/** A single curated intent: phrase + sequence. */
export interface Intent {
  /** Canonical user phrase ("when I say X…"). */
  phrase: string;
  /** Other ways the user might phrase the same intent. At least one alias. */
  aliases: string[];
  /** One sentence in the user's voice describing what the agent should do. */
  description: string;
  /** Ordered sequence the agent should run on this intent. */
  sequence: IntentStep[];
  /** Top-level category — used for grouping in the resource payload. */
  category: IntentCategory;
}

// ---------------------------------------------------------------------------
// Curated initial set
// ---------------------------------------------------------------------------

/**
 * The initial intent table.
 *
 * Order is significant for human readability — entries are grouped by
 * category in the same order as `IntentCategory`'s union members. Within a
 * category, entries are ordered by expected user frequency.
 *
 * Entries that depend on tools / prompts / resources not yet landed are
 * commented out below the live set, with the gating issue number — uncomment
 * (or replace with a `landed: false` flag) when the ticket closes.
 */
export const INTENTS: readonly Intent[] = [
  // ── capture ──────────────────────────────────────────────────────────────
  {
    phrase: "add a task",
    aliases: ["create a task", "new task", "remind me to", "todo"],
    description: "When I describe something I need to do, capture it as a task.",
    sequence: [{ kind: "tool", name: "task_create" }],
    category: "capture",
  },
  {
    phrase: "save this meeting",
    aliases: ["capture meeting notes", "log this meeting", "record this discussion"],
    description: "When I want to record a meeting and its action items, walk me through capture.",
    sequence: [{ kind: "prompt", name: "capture-meeting" }],
    category: "capture",
  },
  {
    phrase: "plan a project",
    aliases: ["scope a project", "set up a project", "plan out"],
    description: "When I want to scope a new project, walk me through structured planning.",
    sequence: [{ kind: "prompt", name: "project-planning" }],
    category: "capture",
  },

  // ── plan ─────────────────────────────────────────────────────────────────
  {
    phrase: "what's on my plate today",
    aliases: ["what do I have today", "today's tasks", "what's due today", "today's forecast"],
    description: "When I ask what's on my plate today, give me the forecast organized by category.",
    sequence: [
      { kind: "resource", uri: "omnifocus://snapshot" },
      { kind: "resource", uri: "omnifocus://forecast/today" },
    ],
    category: "plan",
  },
  {
    phrase: "pack today's deep work",
    aliases: ["plan a focused day", "fit work into the day", "schedule my day"],
    description: "When I want to fit my available work into a time budget, run forecast_pack.",
    sequence: [{ kind: "tool", name: "forecast_pack" }],
    category: "plan",
  },
  {
    phrase: "what's coming up",
    aliases: ["upcoming work", "next few days", "what's due soon"],
    description: "When I want the near-term outlook, pull the forecast for the next several days.",
    sequence: [{ kind: "tool", name: "forecast_get", args: { days: 7 } }],
    category: "plan",
  },

  // ── review ───────────────────────────────────────────────────────────────
  {
    phrase: "weekly review",
    aliases: ["GTD weekly review", "do my weekly", "weekly catch-up"],
    description: "When I want to do my weekly review, walk me through it section by section.",
    sequence: [{ kind: "prompt", name: "weekly-review" }],
    category: "review",
  },
  {
    phrase: "daily review",
    aliases: ["start my day", "daily catch-up", "morning review"],
    description:
      "When I want to orient at the start of the day, walk me through the daily check-in.",
    sequence: [{ kind: "prompt", name: "daily-review" }],
    category: "review",
  },
  {
    phrase: "what changed today",
    aliases: ["recent activity", "what's new", "what happened today"],
    description:
      "When I want a chronological view of recent task activity, pull the recent-activity resource.",
    sequence: [{ kind: "resource", uri: "omnifocus://recent-activity" }],
    category: "review",
  },
  {
    phrase: "what's overdue",
    aliases: ["am I behind", "show overdue", "missed deadlines"],
    description: "When I want to see what's slipped, pull the overdue list.",
    sequence: [{ kind: "resource", uri: "omnifocus://overdue" }],
    category: "review",
  },
  {
    phrase: "what needs review",
    aliases: ["projects due for review", "what to review", "review queue"],
    description:
      "When I want to catch projects that haven't been reviewed in a while, pull the review-due list.",
    sequence: [{ kind: "resource", uri: "omnifocus://review-due" }],
    category: "review",
  },

  // ── triage ───────────────────────────────────────────────────────────────
  {
    phrase: "process my inbox",
    aliases: ["clear my inbox", "triage inbox", "inbox zero"],
    description: "When I want to triage the inbox, pull the inbox tasks so I can route each one.",
    sequence: [{ kind: "resource", uri: "omnifocus://inbox" }],
    category: "triage",
  },
  {
    phrase: "what's flagged",
    aliases: ["my flagged work", "starred tasks", "priority queue"],
    description: "When I want my self-curated priority queue, pull the flagged tasks.",
    sequence: [{ kind: "resource", uri: "omnifocus://flagged" }],
    category: "triage",
  },

  // ── retrospect ───────────────────────────────────────────────────────────
  {
    phrase: "what did I close last week",
    aliases: ["what did I finish", "completed work", "closed last week"],
    description:
      "When I want to look back at finished work, pull the retrospective for the date range.",
    sequence: [{ kind: "resource", uri: "omnifocus://retrospective" }],
    category: "retrospect",
  },
  {
    phrase: "how am I tracking",
    aliases: ["my velocity", "completion rate", "throughput"],
    description: "When I want a macro-level signal on completion pace, pull the velocity resource.",
    sequence: [{ kind: "resource", uri: "omnifocus://velocity" }],
    category: "retrospect",
  },
  {
    phrase: "is this project on pace",
    aliases: ["project burndown", "project progress", "am I behind on"],
    description:
      "When I want to see whether one project is on pace toward its due date, pull burndown for that project.",
    sequence: [{ kind: "resource", uri: "omnifocus://burndown/{projectId}" }],
    category: "retrospect",
  },

  // ── share ────────────────────────────────────────────────────────────────
  {
    phrase: "export this project as text",
    aliases: ["copy project to clipboard", "project as taskpaper", "share this project"],
    description: "When I want a portable text view of a project, export it as TaskPaper.",
    sequence: [{ kind: "tool", name: "export_taskpaper" }],
    category: "share",
  },
  {
    phrase: "export as outline",
    aliases: ["project as opml", "outline export"],
    description: "When I want an outline-shaped export I can paste into another tool, use OPML.",
    sequence: [{ kind: "tool", name: "export_opml" }],
    category: "share",
  },

  // ── audit ────────────────────────────────────────────────────────────────
  {
    phrase: "find duplicates",
    aliases: ["taxonomy collisions", "duplicate tags", "duplicate projects"],
    description:
      "When I suspect taxonomy drift (same tag spelled two ways, etc.), pull the audit resource.",
    sequence: [{ kind: "resource", uri: "omnifocus://taxonomy-audit" }],
    category: "audit",
  },
  {
    phrase: "what's stalled",
    aliases: ["stalled projects", "projects without next actions", "blocked projects"],
    description: "When I want to find projects that look stuck, pull the project-health resource.",
    sequence: [{ kind: "tool", name: "project_list", args: { status: "active" } }],
    category: "audit",
  },

  // ── automate ─────────────────────────────────────────────────────────────
  {
    phrase: "run an OmniFocus plug-in",
    aliases: ["invoke automation", "trigger plugin"],
    description: "When I name an installed Omni Automation plug-in, invoke it by identifier.",
    sequence: [{ kind: "tool", name: "plugin_invoke" }],
    category: "automate",
  },

  // ── unlanded — uncomment as the gating ticket closes ─────────────────────
  // - "extract from this image" → task_extract_from_image (#486)
  // - "extract from this note" → task_extract_from_note (#481)
  // - "process my inbox (with prompt)" → task_list({inbox: true}) + prompt:inbox-triage (#475)
  // - "summarize this project for Slack" → project_to_markdown (Tier-2, when filed)
  // - "remind me when X completes" → webhook_register (#483)
  // - "how am I tracking" enriched with → omnifocus://retrospective?weeks=1 (#474 — landed; refine query when intent grammar lands)
  // - "what's stalled" → omnifocus://project-health (#468)
];
