/**
 * Unit tests for OmniFocus MCP prompt templates.
 *
 * Tests:
 * - All four prompts are registered with the correct name
 * - Each prompt callback returns a well-formed GetPromptResult (messages array)
 * - Message builders produce expected content (snapshot tests)
 * - Parameterised prompts interpolate inputs correctly
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import {
  buildCaptureMeetingMessage,
  buildDailyReviewMessage,
  buildInboxTriageMessage,
  buildPerspectiveAuthorMessage,
  buildProjectPlanningMessage,
  buildWeeklyReviewMessage,
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  INBOX_TRIAGE_PROMPT,
  PERSPECTIVE_AUTHOR_PROMPT,
  PROJECT_PLANNING_PROMPT,
  registerOmniFocusPrompts,
  WEEKLY_REVIEW_PROMPT,
} from "./omnifocus.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type CapturedPrompt = {
  name: string;
  config: { description: string; argsSchema: Record<string, unknown> };
  callback: (args: Record<string, string>) => Promise<unknown>;
};

function makeHarness() {
  const registered: CapturedPrompt[] = [];
  const server = {
    registerPrompt: vi.fn(
      (
        name: string,
        config: { description: string; argsSchema: Record<string, unknown> },
        callback: (args: Record<string, string>) => Promise<unknown>,
      ) => {
        registered.push({ name, config, callback });
      },
    ),
  } as unknown as McpServer;

  registerOmniFocusPrompts(server);

  function find(name: string): CapturedPrompt {
    const p = registered.find((r) => r.name === name);
    if (!p) throw new Error(`Prompt not registered: ${name}`);
    return p;
  }

  return { server, registered, find };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerOmniFocusPrompts — registration", () => {
  // Per-name assertions cover the surface; we don't pin the count number
  // because that turns every prompt-adding PR into a coordination point
  // (per #512's pattern for resources).
  it("registers a non-empty set of prompts", () => {
    const { registered } = makeHarness();
    expect(registered.length).toBeGreaterThan(0);
  });

  it("registers every expected prompt by name", () => {
    const { registered } = makeHarness();
    const names = registered.map((r) => r.name);
    expect(names).toContain(DAILY_REVIEW_PROMPT);
    expect(names).toContain(WEEKLY_REVIEW_PROMPT);
    expect(names).toContain(CAPTURE_MEETING_PROMPT);
    expect(names).toContain(PROJECT_PLANNING_PROMPT);
    expect(names).toContain(INBOX_TRIAGE_PROMPT);
    expect(names).toContain(PERSPECTIVE_AUTHOR_PROMPT);
  });

  it("every prompt has a non-empty description", () => {
    const { registered } = makeHarness();
    for (const p of registered) {
      expect(p.config.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// daily-review
// ---------------------------------------------------------------------------

describe("daily-review prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(DAILY_REVIEW_PROMPT).callback({})) as {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content.type).toBe("text");
  });

  it("message references snapshot, overdue, and forecast resources", async () => {
    const text = buildDailyReviewMessage();
    expect(text).toContain("omnifocus://snapshot");
    expect(text).toContain("omnifocus://overdue");
    expect(text).toContain("omnifocus://forecast/today");
  });

  it("message text matches snapshot", () => {
    expect(buildDailyReviewMessage()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// weekly-review
// ---------------------------------------------------------------------------

describe("weekly-review prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(WEEKLY_REVIEW_PROMPT).callback({})) as {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
  });

  it("message references review-due resource and project_mark_reviewed tool", () => {
    const text = buildWeeklyReviewMessage();
    expect(text).toContain("omnifocus://review-due");
    expect(text).toContain("project_mark_reviewed");
  });

  it("message text matches snapshot", () => {
    expect(buildWeeklyReviewMessage()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// capture-meeting
// ---------------------------------------------------------------------------

describe("capture-meeting prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(CAPTURE_MEETING_PROMPT).callback({
      notes: "Alice will write the spec. Bob will review by Friday.",
    })) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
  });

  it("embeds the notes verbatim in the message", async () => {
    const notes = "Alice will write the spec. Bob will review by Friday.";
    const text = buildCaptureMeetingMessage(notes);
    expect(text).toContain(notes);
  });

  it("targets inbox when projectId is omitted", () => {
    const text = buildCaptureMeetingMessage("some notes");
    expect(text).toContain("inbox");
  });

  it("interpolates projectId when provided", () => {
    const text = buildCaptureMeetingMessage("some notes", "proj_abc123");
    expect(text).toContain("proj_abc123");
  });

  it("message with no projectId matches snapshot", () => {
    expect(buildCaptureMeetingMessage("Alice will write the spec.")).toMatchSnapshot();
  });

  it("message with projectId matches snapshot", () => {
    expect(
      buildCaptureMeetingMessage("Alice will write the spec.", "proj_abc123"),
    ).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// project-planning
// ---------------------------------------------------------------------------

describe("project-planning prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(PROJECT_PLANNING_PROMPT).callback({
      name: "Website Redesign",
      brief: "Redesign the company website to improve conversion.",
    })) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
  });

  it("embeds name and brief in the message", () => {
    const text = buildProjectPlanningMessage(
      "Website Redesign",
      "Redesign the company website to improve conversion.",
    );
    expect(text).toContain("Website Redesign");
    expect(text).toContain("Redesign the company website");
  });

  it("shows top-level when folderId is omitted", () => {
    const text = buildProjectPlanningMessage("My Project", "Brief here");
    expect(text).toContain("top-level");
  });

  it("interpolates folderId when provided", () => {
    const text = buildProjectPlanningMessage("My Project", "Brief here", "folder_xyz");
    expect(text).toContain("folder_xyz");
  });

  it("message without folderId matches snapshot", () => {
    expect(
      buildProjectPlanningMessage(
        "Website Redesign",
        "Redesign the company website to improve conversion.",
      ),
    ).toMatchSnapshot();
  });

  it("message with folderId matches snapshot", () => {
    expect(
      buildProjectPlanningMessage(
        "Website Redesign",
        "Redesign the company website to improve conversion.",
        "folder_xyz",
      ),
    ).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// inbox-triage
// ---------------------------------------------------------------------------

describe("inbox-triage prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(INBOX_TRIAGE_PROMPT).callback({})) as {
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content.type).toBe("text");
  });

  it("message references the inbox resource and the batch-assign tool", () => {
    const text = buildInboxTriageMessage();
    expect(text).toContain("omnifocus://inbox");
    expect(text).toContain("task_batch_assign");
  });

  it("message instructs the agent NOT to auto-confirm", () => {
    const text = buildInboxTriageMessage();
    // Anti-auto-confirm is the load-bearing UX guarantee.
    expect(text.toLowerCase()).toContain("do not");
    expect(text.toLowerCase()).toContain("confirm");
  });

  it("message text matches snapshot", () => {
    expect(buildInboxTriageMessage()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// perspective-author
// ---------------------------------------------------------------------------

describe("perspective-author prompt", () => {
  it("returns a messages array with one user message", async () => {
    const { find } = makeHarness();
    const result = (await find(PERSPECTIVE_AUTHOR_PROMPT).callback({
      description: "everything I could do at home, on a phone, with under 15 minutes",
    })) as { messages: Array<{ role: string; content: { type: string; text: string } }> };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content.type).toBe("text");
  });

  it("embeds the user's description verbatim in the message", () => {
    const description = "everything I could do at home, on a phone, with under 15 minutes";
    const text = buildPerspectiveAuthorMessage(description);
    expect(text).toContain(description);
  });

  it("includes the proposed name when provided", () => {
    const text = buildPerspectiveAuthorMessage("flagged tasks", "Quick wins");
    expect(text).toContain("Quick wins");
  });

  it("references all three flow steps: dry-run, create, list", () => {
    const text = buildPerspectiveAuthorMessage("anything");
    expect(text).toContain("perspective_evaluate_dry_run");
    expect(text).toContain("perspective_create");
    expect(text).toContain("perspective_list");
  });

  it("documents the rule-tree atom vocabulary so the agent does not need web access", () => {
    const text = buildPerspectiveAuthorMessage("anything");
    // Spot-check a representative subset of atom keys from PerspectiveRuleAtom.
    expect(text).toContain("actionAvailability");
    expect(text).toContain("actionStatus");
    expect(text).toContain("actionHasAnyOfTags");
    expect(text).toContain("actionHasNoProject");
    expect(text).toContain("actionWithinFocus");
  });

  it("instructs the agent to ask exactly ONE disambiguating question if ambiguous", () => {
    const text = buildPerspectiveAuthorMessage("nearby tasks");
    expect(text.toLowerCase()).toContain("one disambiguating question");
    // The "do not guess" guarantee is the load-bearing UX signal.
    expect(text.toLowerCase()).toContain("do not guess");
  });

  it("instructs the agent NOT to skip the dry-run preview", () => {
    const text = buildPerspectiveAuthorMessage("anything");
    expect(text.toLowerCase()).toMatch(/do not skip the preview/);
  });

  it("flags Pro requirement and OF_FEATURE_REQUIRES_PRO error code", () => {
    const text = buildPerspectiveAuthorMessage("anything");
    expect(text).toContain("OmniFocus Pro");
    expect(text).toContain("OF_FEATURE_REQUIRES_PRO");
  });

  it("message text (no name) matches snapshot", () => {
    expect(
      buildPerspectiveAuthorMessage(
        "everything I could do at home, on a phone, with under 15 minutes",
      ),
    ).toMatchSnapshot();
  });

  it("message text (with name) matches snapshot", () => {
    expect(buildPerspectiveAuthorMessage("flagged + available", "Quick wins")).toMatchSnapshot();
  });
});
