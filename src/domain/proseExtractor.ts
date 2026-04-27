/**
 * Mechanical extractor: prose → candidate-task list with line-number provenance.
 *
 * The point is the *split*, not the judgment. The tool extracts candidate
 * lines (numbered list items, bullets, sentences with imperative-verb
 * prefixes from a small allowlist); the agent decides which to keep, what
 * to title, what to tag. Source-line numbering lets the agent surface
 * "from line 14 of your note: …" when presenting proposals.
 *
 * No NLP library, no model calls. Tested via fixture corpus —
 * proseExtractor.test.ts.
 *
 * @see #481 — initial implementation
 * @see src/tools/task/extractFromNote.ts — tool wiring
 */

// ---------------------------------------------------------------------------
// Imperative-verb allowlist
// ---------------------------------------------------------------------------

/**
 * Verbs that anchor an extracted candidate task when they appear at the
 * start of a sentence or clause. Small on purpose — it's better to miss a
 * candidate (the agent can re-extract from `unmappedLines`) than to flood
 * the output with sentences that aren't action items.
 *
 * Multi-word verbs are matched as phrases (`follow up`, `set up`).
 */
export const DEFAULT_IMPERATIVE_VERBS: readonly string[] = [
  "add",
  "build",
  "call",
  "check",
  "create",
  "draft",
  "email",
  "file",
  "finish",
  "fix",
  "follow up",
  "plan",
  "prepare",
  "research",
  "review",
  "schedule",
  "send",
  "set up",
  "start",
  "write",
];

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface ProposedTask {
  /** Candidate task name — the cleaned version of the extracted line. */
  name: string;
  /** 1-based source-line numbers the candidate was derived from. */
  sourceLines: number[];
}

export interface ExtractionResult {
  proposed: ProposedTask[];
  /** Lines that didn't match any extraction pattern, with their 1-based line numbers preserved as a "L{n}: " prefix. */
  unmappedLines: string[];
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

/** Numbered list: `1.` / `1)` / `(1)` */
const NUMBERED_RE = /^\s*(?:\(\d+\)|\d+[.)])\s+(.+)$/;

/** Bullet list: `-`, `*`, `•`, `–`, `—` */
const BULLET_RE = /^\s*(?:[-*•–—])\s+(.+)$/;

/**
 * Action-emoji prefix: ✅ ⏰ 📝 📌 ✏️ 📞 etc.
 *
 * Alternation rather than a character class so emoji that are technically
 * grapheme clusters (base codepoint + variation-selector) — e.g. ✏️, ⚡️,
 * ➡️ — match as whole units. A character class would only match the base
 * codepoint and leave the selector behind.
 */
const ACTION_EMOJI_RE = /^\s*(?:✅|⏰|📝|📌|✏️|📞|📧|📤|📩|🔔|🚨|⚡️|➡️|→)\s+(.+)$/u;

/** Strip trailing punctuation that doesn't belong in a task name. */
function trimName(s: string): string {
  return s.replace(/[\s.;,:]+$/, "").trim();
}

/** Build the imperative-verb regex from the allowlist. Case-insensitive, anchored. */
function buildImperativeRegex(verbs: readonly string[]): RegExp {
  const escaped = verbs.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Allow optional pleasantries / first-person at the start ("I should", "please", "we need to")
  // followed by a verb from the allowlist, then the rest of the sentence.
  return new RegExp(
    String.raw`^\s*(?:(?:i (?:should|will|need to|must)|please|we (?:need to|should))\s+)?(${escaped.join("|")})\b\s+(.+)$`,
    "i",
  );
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  /** Override the default imperative-verb allowlist. */
  verbs?: readonly string[];
}

/**
 * Extract candidate tasks from prose.
 *
 * Algorithm:
 *   - Split input on `\n`. Track 1-based line numbers.
 *   - For each line:
 *     * Skip blank lines.
 *     * Try numbered-list / bullet / action-emoji prefixes. Match → ProposedTask.
 *     * Try imperative-verb prefix. Match → ProposedTask.
 *     * Otherwise → push to `unmappedLines` with `L{n}: ` prefix.
 *   - Empty proposed name (after trim) demotes to unmapped.
 */
export function extractTasksFromProse(
  prose: string,
  options: ExtractOptions = {},
): ExtractionResult {
  const verbs = options.verbs ?? DEFAULT_IMPERATIVE_VERBS;
  const imperativeRe = buildImperativeRegex(verbs);

  const proposed: ProposedTask[] = [];
  const unmappedLines: string[] = [];

  const lines = prose.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue; // skip blank lines silently

    const numberedMatch = NUMBERED_RE.exec(raw);
    const bulletMatch = !numberedMatch ? BULLET_RE.exec(raw) : null;
    const emojiMatch = !numberedMatch && !bulletMatch ? ACTION_EMOJI_RE.exec(raw) : null;
    const imperativeMatch =
      !numberedMatch && !bulletMatch && !emojiMatch ? imperativeRe.exec(raw) : null;

    let body: string | null = null;
    if (numberedMatch) body = numberedMatch[1] ?? null;
    else if (bulletMatch) body = bulletMatch[1] ?? null;
    else if (emojiMatch) body = emojiMatch[1] ?? null;
    else if (imperativeMatch) {
      // Imperative match: reconstruct from the verb + remainder so the verb
      // stays in the task name.
      const verb = imperativeMatch[1] ?? "";
      const rest = imperativeMatch[2] ?? "";
      body = verb && rest ? `${verb} ${rest}` : null;
    }

    if (body === null) {
      unmappedLines.push(`L${lineNum}: ${raw.trim()}`);
      continue;
    }

    const name = trimName(body);
    if (!name) {
      unmappedLines.push(`L${lineNum}: ${raw.trim()}`);
      continue;
    }

    proposed.push({ name, sourceLines: [lineNum] });
  }

  return { proposed, unmappedLines };
}
