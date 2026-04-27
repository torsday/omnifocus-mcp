/**
 * Unit tests + lint for the intents resource.
 *
 * The lint tests are load-bearing: they prevent intents.data.ts from
 * referencing unregistered tools, prompts, or resources. A drifted entry
 * silently fails an agent's first move on a common intent.
 */

import { describe, expect, it } from "vitest";

import {
  CAPTURE_MEETING_PROMPT,
  DAILY_REVIEW_PROMPT,
  PROJECT_PLANNING_PROMPT,
  WEEKLY_REVIEW_PROMPT,
} from "../prompts/omnifocus.js";
import { ALL_TOOL_DESCRIPTIONS } from "../tools/allDescriptions.js";

import { INTENTS, type Intent, type IntentCategory } from "./intents.data.js";
import { buildIntentsPayload, INTENTS_URI } from "./intents.js";

// ---------------------------------------------------------------------------
// Known surfaces — anything an intent step may reference
// ---------------------------------------------------------------------------

const REGISTERED_PROMPTS = new Set<string>([
  DAILY_REVIEW_PROMPT,
  WEEKLY_REVIEW_PROMPT,
  CAPTURE_MEETING_PROMPT,
  PROJECT_PLANNING_PROMPT,
]);

/**
 * Concrete URIs and URI templates registered by the server. Templates use
 * RFC-6570 syntax (`{var}`, `{?query}`); for matching we accept either the
 * exact string or a template prefix.
 */
const REGISTERED_RESOURCE_URIS = new Set<string>([
  "omnifocus://snapshot",
  "omnifocus://inbox",
  "omnifocus://forecast/today",
  "omnifocus://overdue",
  "omnifocus://flagged",
  "omnifocus://review-due",
  "omnifocus://capabilities",
  "omnifocus://taxonomy-audit",
  "omnifocus://intents",
  "omnifocus://tasks/inbox",
]);

/** URI templates — accept any URI whose prefix matches the part before `{`. */
const REGISTERED_RESOURCE_TEMPLATES: readonly string[] = [
  "omnifocus://project/",
  "omnifocus://tag/",
  "omnifocus://perspective/",
  "omnifocus://tasks/project/",
  "omnifocus://tasks/tag/",
  "omnifocus://burndown/",
  "omnifocus://recent-activity",
  "omnifocus://retrospective",
  "omnifocus://velocity",
];

const VALID_CATEGORIES: ReadonlySet<IntentCategory> = new Set([
  "capture",
  "plan",
  "review",
  "triage",
  "retrospect",
  "share",
  "audit",
  "automate",
]);

function resourceUriIsRegistered(uri: string): boolean {
  if (REGISTERED_RESOURCE_URIS.has(uri)) return true;
  // Strip query-template suffix (e.g. "{?weeks}") for prefix matching.
  const base = uri.split("{")[0];
  return REGISTERED_RESOURCE_TEMPLATES.some((prefix) => base?.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Lint — every step references something real
// ---------------------------------------------------------------------------

describe("INTENTS — lint", () => {
  it("every kind:tool step references a registered tool", () => {
    const unknown: Array<{ phrase: string; toolName: string }> = [];
    for (const intent of INTENTS) {
      for (const step of intent.sequence) {
        if (step.kind === "tool" && !(step.name in ALL_TOOL_DESCRIPTIONS)) {
          unknown.push({ phrase: intent.phrase, toolName: step.name });
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every kind:prompt step references a registered prompt", () => {
    const unknown: Array<{ phrase: string; promptName: string }> = [];
    for (const intent of INTENTS) {
      for (const step of intent.sequence) {
        if (step.kind === "prompt" && !REGISTERED_PROMPTS.has(step.name)) {
          unknown.push({ phrase: intent.phrase, promptName: step.name });
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every kind:resource step references a registered resource URI or template", () => {
    const unknown: Array<{ phrase: string; uri: string }> = [];
    for (const intent of INTENTS) {
      for (const step of intent.sequence) {
        if (step.kind === "resource" && !resourceUriIsRegistered(step.uri)) {
          unknown.push({ phrase: intent.phrase, uri: step.uri });
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every intent has a non-empty phrase, at least one alias, and a description", () => {
    const violations: Array<{ phrase: string; reason: string }> = [];
    for (const intent of INTENTS) {
      if (!intent.phrase.trim()) violations.push({ phrase: intent.phrase, reason: "empty phrase" });
      if (intent.aliases.length === 0)
        violations.push({ phrase: intent.phrase, reason: "no aliases" });
      if (!intent.description.trim())
        violations.push({ phrase: intent.phrase, reason: "empty description" });
      if (intent.sequence.length === 0)
        violations.push({ phrase: intent.phrase, reason: "empty sequence" });
    }
    expect(violations).toEqual([]);
  });

  it("every intent's category is one of the eight verbs", () => {
    const violations: Array<{ phrase: string; category: string }> = [];
    for (const intent of INTENTS) {
      if (!VALID_CATEGORIES.has(intent.category))
        violations.push({ phrase: intent.phrase, category: intent.category });
    }
    expect(violations).toEqual([]);
  });

  it("intent phrases are unique", () => {
    const counts = new Map<string, number>();
    for (const intent of INTENTS) {
      counts.set(intent.phrase, (counts.get(intent.phrase) ?? 0) + 1);
    }
    const dupes = Array.from(counts.entries()).filter(([, n]) => n > 1);
    expect(dupes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

describe("buildIntentsPayload", () => {
  it("returns the curated INTENTS array verbatim", () => {
    const fixedNow = new Date("2026-04-26T12:00:00.000Z");
    const payload = buildIntentsPayload(fixedNow);
    expect(payload.intents).toBe(INTENTS);
  });

  it("count matches intents.length", () => {
    const payload = buildIntentsPayload();
    expect(payload.count).toBe(INTENTS.length);
  });

  it("generatedAt is the injected timestamp in ISO-8601", () => {
    const fixedNow = new Date("2026-04-26T12:00:00.000Z");
    const payload = buildIntentsPayload(fixedNow);
    expect(payload.generatedAt).toBe("2026-04-26T12:00:00.000Z");
  });

  it("returned payload is JSON-serializable", () => {
    const payload = buildIntentsPayload();
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// URI constant
// ---------------------------------------------------------------------------

describe("INTENTS_URI", () => {
  it("is the canonical intents URI", () => {
    expect(INTENTS_URI).toBe("omnifocus://intents");
  });
});

// ---------------------------------------------------------------------------
// Coverage spread — every category has at least one intent
// ---------------------------------------------------------------------------

describe("INTENTS — coverage spread", () => {
  it("every category has at least one intent", () => {
    const seen = new Set<IntentCategory>(INTENTS.map((i) => i.category));
    const missing: IntentCategory[] = [];
    for (const cat of VALID_CATEGORIES) {
      if (!seen.has(cat)) missing.push(cat);
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Type sanity — exported Intent shape is what we documented
// ---------------------------------------------------------------------------

describe("Intent shape", () => {
  it("compiles when all required fields are present", () => {
    const sample: Intent = {
      phrase: "test",
      aliases: ["t"],
      description: "test description",
      sequence: [{ kind: "tool", name: "task_create" }],
      category: "capture",
    };
    expect(sample.phrase).toBe("test");
  });
});
