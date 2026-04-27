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
  buildProjectPlanningMessage,
  buildWeeklyReviewMessage,
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  INBOX_TRIAGE_PROMPT,
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
