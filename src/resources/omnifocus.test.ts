/**
 * Unit tests for `registerOmniFocusResources`.
 *
 * Verifies:
 * - All nine resources are registered with the correct name and URI/template
 * - Each handler returns valid `application/json` contents
 * - Snapshot counts are accurate
 * - Inbox filtering (no projectId + no parentId)
 * - Overdue is sorted by dueDate ascending
 * - Review-due is sorted by nextReviewDate ascending
 * - Dynamic resources extract the {id} variable from the URI
 *
 * Uses `InMemoryAdapter` seeded with predictable fixtures. No mocks beyond
 * the McpServer stub — service instances are real.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { ProjectId, TagId } from "../domain/ids.js";
import { ForecastService } from "../services/forecastService.js";
import { PerspectiveService } from "../services/perspectiveService.js";
import { ProjectService } from "../services/projectService.js";
import { ReviewService } from "../services/reviewService.js";
import {
  FLAGGED_URI,
  FORECAST_TODAY_URI,
  INBOX_URI,
  OVERDUE_URI,
  PERSPECTIVE_URI_TEMPLATE,
  PROJECT_URI_TEMPLATE,
  REVIEW_DUE_URI,
  registerOmniFocusResources,
  SNAPSHOT_URI,
  TAG_URI_TEMPLATE,
} from "./omnifocus.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type CapturedResource = {
  name: string;
  uriOrTemplate: unknown;
  config: { mimeType: string; description: string };
  callback: (uri: URL, variables?: Record<string, string>) => Promise<unknown>;
};

function makeHarness() {
  const adapter = new InMemoryAdapter();
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
  const projectService = new ProjectService({ adapter, cache });
  const reviewService = new ReviewService({ adapter });
  const forecastService = new ForecastService({ adapter });
  const perspectiveService = new PerspectiveService({ adapter });

  const registered: CapturedResource[] = [];
  const server = {
    registerResource: vi.fn(
      (
        name: string,
        uriOrTemplate: unknown,
        config: { mimeType: string; description: string },
        callback: (uri: URL, variables?: Record<string, string>) => Promise<unknown>,
      ) => {
        registered.push({ name, uriOrTemplate, config, callback });
      },
    ),
  } as unknown as McpServer;

  registerOmniFocusResources(server, {
    adapter,
    projectService,
    reviewService,
    forecastService,
    perspectiveService,
  });

  function find(name: string): CapturedResource {
    const r = registered.find((x) => x.name === name);
    if (!r) throw new Error(`Resource "${name}" was not registered`);
    return r;
  }

  async function read(name: string, uriStr?: string, vars?: Record<string, string>) {
    const r = find(name);
    // For template resources, uriStr must be provided (or we build one from vars).
    const resolvedUri =
      uriStr ??
      (typeof r.uriOrTemplate === "string"
        ? r.uriOrTemplate
        : vars
          ? Object.entries(vars).reduce(
              (tpl, [k, v]) => tpl.replace(`{${k}}`, v),
              (r.uriOrTemplate as { uriTemplate: { toString(): string } }).uriTemplate.toString(),
            )
          : SNAPSHOT_URI); // fallback; should never reach here
    const uri = new URL(resolvedUri);
    const raw = await r.callback(uri, vars);
    const result = raw as { contents: Array<{ uri: string; mimeType: string; text: string }> };
    const first = result.contents[0];
    if (!first) throw new Error("No contents returned");
    return JSON.parse(first.text) as unknown;
  }

  return { adapter, server, registered, find, read };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------

describe("registerOmniFocusResources — registration", () => {
  // Sanity floor only — exact count is the wrong invariant. Per #512, hard-
  // coding the count made this assertion a coordination point: every
  // resource-adding PR conflicted with every other one. We test that the
  // expected resources are registered, not that the total equals N.
  it("registers a non-empty set of resources", () => {
    const { registered } = makeHarness();
    expect(registered.length).toBeGreaterThan(0);
  });

  // Per-resource named assertions cover the surface that the count assertion
  // implicitly covered. Adding a resource adds a single it() block here, not
  // a numeric edit — orthogonal to other PRs that add resources.
  it("registers every resource that registerOmniFocusResources is responsible for", () => {
    const { registered } = makeHarness();
    const names = registered.map((r) => r.name);
    // Every name registered by `registerOmniFocusResources`. Templates and
    // static URIs both surface here. `omnifocus-capabilities` is registered
    // by a separate function and is not in this set.
    const expected = [
      "omnifocus-snapshot",
      "omnifocus-inbox",
      "omnifocus-forecast-today",
      "omnifocus-overdue",
      "omnifocus-flagged",
      "omnifocus-review-due",
      "omnifocus-project",
      "omnifocus-tag",
      "omnifocus-perspective",
      "omnifocus-tasks-inbox",
      "omnifocus-tasks-by-project",
      "omnifocus-tasks-by-tag",
      "omnifocus-recent-activity",
      "omnifocus-retrospective",
      "omnifocus-taxonomy-audit",
      "omnifocus-velocity",
      "omnifocus-burndown",
      "omnifocus-intents",
    ];
    for (const name of expected) {
      expect(names, `expected ${name} to be registered`).toContain(name);
    }
  });

  it("registers omnifocus-snapshot with the correct URI", () => {
    const { find } = makeHarness();
    const r = find("omnifocus-snapshot");
    expect(r.uriOrTemplate).toBe(SNAPSHOT_URI);
    expect(r.config.mimeType).toBe("application/json");
  });

  it("registers omnifocus-inbox with the correct URI", () => {
    const { find } = makeHarness();
    expect(find("omnifocus-inbox").uriOrTemplate).toBe(INBOX_URI);
  });

  it("registers omnifocus-forecast-today with the correct URI", () => {
    const { find } = makeHarness();
    expect(find("omnifocus-forecast-today").uriOrTemplate).toBe(FORECAST_TODAY_URI);
  });

  it("registers omnifocus-overdue with the correct URI", () => {
    const { find } = makeHarness();
    expect(find("omnifocus-overdue").uriOrTemplate).toBe(OVERDUE_URI);
  });

  it("registers omnifocus-flagged with the correct URI", () => {
    const { find } = makeHarness();
    expect(find("omnifocus-flagged").uriOrTemplate).toBe(FLAGGED_URI);
  });

  it("registers omnifocus-review-due with the correct URI", () => {
    const { find } = makeHarness();
    expect(find("omnifocus-review-due").uriOrTemplate).toBe(REVIEW_DUE_URI);
  });

  it("registers omnifocus-project as a ResourceTemplate", () => {
    const { find } = makeHarness();
    const r = find("omnifocus-project");
    expect(typeof r.uriOrTemplate).toBe("object"); // ResourceTemplate instance
  });

  it("registers omnifocus-tag as a ResourceTemplate", () => {
    const { find } = makeHarness();
    expect(typeof find("omnifocus-tag").uriOrTemplate).toBe("object");
  });

  it("registers omnifocus-perspective as a ResourceTemplate", () => {
    const { find } = makeHarness();
    expect(typeof find("omnifocus-perspective").uriOrTemplate).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

describe("omnifocus://snapshot", () => {
  it("returns all five counts as 0 on an empty adapter", async () => {
    const { read } = makeHarness();
    const data = (await read("omnifocus-snapshot")) as Record<string, unknown>;
    expect(data.inboxCount).toBe(0);
    expect(data.overdueCount).toBe(0);
    expect(data.dueTodayCount).toBe(0);
    expect(data.flaggedCount).toBe(0);
    expect(data.reviewDueCount).toBe(0);
  });

  it("includes syncStatus with lastSyncAt and inFlight", async () => {
    const { read } = makeHarness();
    const data = (await read("omnifocus-snapshot")) as Record<string, unknown>;
    expect(data.syncStatus).toMatchObject({
      lastSyncAt: null,
      inFlight: false,
    });
  });

  it("syncStatus.lastSyncAt updates after a sync", async () => {
    const { adapter, read } = makeHarness();
    await adapter.syncTrigger();
    const data = (await read("omnifocus-snapshot")) as Record<string, unknown>;
    const ss = data.syncStatus as { lastSyncAt: string | null; inFlight: boolean };
    expect(ss.lastSyncAt).not.toBeNull();
    expect(typeof ss.lastSyncAt).toBe("string");
  });

  it("counts inbox tasks (no project, no parent)", async () => {
    const { adapter, read } = makeHarness();
    await adapter.createTask({ name: "Inbox A" });
    await adapter.createTask({ name: "Inbox B" });
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "Project task", projectId: projId as ProjectId });

    const data = (await read("omnifocus-snapshot")) as Record<string, number>;
    expect(data.inboxCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// inbox
// ---------------------------------------------------------------------------

describe("omnifocus://inbox", () => {
  it("returns an empty array when no inbox tasks exist", async () => {
    const { read } = makeHarness();
    const tasks = (await read("omnifocus-inbox")) as unknown[];
    expect(tasks).toEqual([]);
  });

  it("returns only tasks with no projectId and no parentId", async () => {
    const { adapter, read } = makeHarness();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "Inbox task" });
    await adapter.createTask({ name: "Project task", projectId: projId as ProjectId });

    const tasks = (await read("omnifocus-inbox")) as Array<{ name: string }>;
    expect(tasks.map((t) => t.name)).toEqual(["Inbox task"]);
  });

  it("excludes completed tasks", async () => {
    const { adapter, read } = makeHarness();
    const id = await adapter.createTask({ name: "Done" });
    await adapter.completeTask(id);
    await adapter.createTask({ name: "Active" });

    const tasks = (await read("omnifocus-inbox")) as Array<{ name: string }>;
    expect(tasks.map((t) => t.name)).toEqual(["Active"]);
  });
});

// ---------------------------------------------------------------------------
// forecast/today
// ---------------------------------------------------------------------------

describe("omnifocus://forecast/today", () => {
  it("returns the four forecast categories", async () => {
    const { read } = makeHarness();
    const data = (await read("omnifocus-forecast-today")) as Record<string, unknown[]>;
    expect(Array.isArray(data.overdue)).toBe(true);
    expect(Array.isArray(data.dueToday)).toBe(true);
    expect(Array.isArray(data.deferredToday)).toBe(true);
    expect(Array.isArray(data.flagged)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// overdue
// ---------------------------------------------------------------------------

describe("omnifocus://overdue", () => {
  it("returns an empty array when no overdue tasks exist", async () => {
    const { read } = makeHarness();
    const tasks = (await read("omnifocus-overdue")) as unknown[];
    expect(tasks).toEqual([]);
  });

  it("sorts overdue tasks by dueDate ascending", async () => {
    const { adapter, read } = makeHarness();
    await adapter.createTask({ name: "Late B", dueDate: "2020-06-01T00:00:00Z" });
    await adapter.createTask({ name: "Late A", dueDate: "2020-01-01T00:00:00Z" });

    const tasks = (await read("omnifocus-overdue")) as Array<{ name: string }>;
    expect(tasks.map((t) => t.name)).toEqual(["Late A", "Late B"]);
  });
});

// ---------------------------------------------------------------------------
// flagged
// ---------------------------------------------------------------------------

describe("omnifocus://flagged", () => {
  it("returns an empty array when no flagged tasks exist", async () => {
    const { read } = makeHarness();
    expect((await read("omnifocus-flagged")) as unknown[]).toEqual([]);
  });

  it("returns only flagged incomplete tasks", async () => {
    const { adapter, read } = makeHarness();
    await adapter.createTask({ name: "Flagged", flagged: true });
    await adapter.createTask({ name: "Plain" });

    const tasks = (await read("omnifocus-flagged")) as Array<{ name: string }>;
    expect(tasks.map((t) => t.name)).toEqual(["Flagged"]);
  });
});

// ---------------------------------------------------------------------------
// review-due
// ---------------------------------------------------------------------------

describe("omnifocus://review-due", () => {
  it("returns an empty array when no projects are due for review", async () => {
    const { read } = makeHarness();
    expect((await read("omnifocus-review-due")) as unknown[]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// project/{id}
// ---------------------------------------------------------------------------

describe("omnifocus://project/{id}", () => {
  it("returns project and its tasks", async () => {
    const { adapter, read } = makeHarness();
    const projId = await adapter.createProject({ name: "My Project" });
    await adapter.createTask({ name: "Task 1", projectId: projId as ProjectId });
    await adapter.createTask({ name: "Task 2", projectId: projId as ProjectId });

    const data = (await read("omnifocus-project", undefined, { id: projId })) as {
      project: { name: string };
      tasks: Array<{ name: string }>;
    };
    expect(data.project.name).toBe("My Project");
    expect(data.tasks.map((t) => t.name)).toContain("Task 1");
    expect(data.tasks.map((t) => t.name)).toContain("Task 2");
  });

  it("returns empty tasks array for a project with no tasks", async () => {
    const { adapter, read } = makeHarness();
    const projId = await adapter.createProject({ name: "Empty" });

    const data = (await read("omnifocus-project", undefined, { id: projId })) as {
      tasks: unknown[];
    };
    expect(data.tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tag/{id}
// ---------------------------------------------------------------------------

describe("omnifocus://tag/{id}", () => {
  it("returns tag and its tasks", async () => {
    const { adapter, read } = makeHarness();
    const tagId = await adapter.createTag({ name: "Work" });
    await adapter.createTask({ name: "Work task", tagIds: [tagId as TagId] });
    await adapter.createTask({ name: "Other task" });

    const data = (await read("omnifocus-tag", undefined, { id: tagId })) as {
      tag: { name: string };
      tasks: Array<{ name: string }>;
    };
    expect(data.tag.name).toBe("Work");
    expect(data.tasks.map((t) => t.name)).toEqual(["Work task"]);
  });
});

// ---------------------------------------------------------------------------
// perspective/{id}
// ---------------------------------------------------------------------------

describe("omnifocus://perspective/{id}", () => {
  it("returns perspectiveId and tasks array", async () => {
    const { read } = makeHarness();
    const data = (await read("omnifocus-perspective", undefined, { id: "flagged" })) as {
      perspectiveId: string;
      tasks: unknown[];
    };
    expect(data.perspectiveId).toBe("flagged");
    expect(Array.isArray(data.tasks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// URI template constants
// ---------------------------------------------------------------------------

describe("URI template constants", () => {
  it("PROJECT_URI_TEMPLATE has the correct pattern", () => {
    expect(PROJECT_URI_TEMPLATE).toBe("omnifocus://project/{id}");
  });
  it("TAG_URI_TEMPLATE has the correct pattern", () => {
    expect(TAG_URI_TEMPLATE).toBe("omnifocus://tag/{id}");
  });
  it("PERSPECTIVE_URI_TEMPLATE has the correct pattern", () => {
    expect(PERSPECTIVE_URI_TEMPLATE).toBe("omnifocus://perspective/{id}");
  });
});
