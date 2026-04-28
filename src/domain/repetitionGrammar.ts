/**
 * Deterministic prose-to-RepetitionRule grammar.
 *
 * The repetition schema in OmniFocus is genuinely complex (every-other-week
 * vs. fortnightly, nth-weekday-of-month vs. specific-date, fixed vs.
 * completion-relative). An LLM doing the translation ad hoc gets the
 * corners wrong silently — the resulting OF rule looks plausible but fires
 * on the wrong cadence. This grammar replaces the silent miss with a
 * deterministic miss: prose either parses to one rule, parses to a small
 * set of valid interpretations (ambiguous), or fails with an actionable
 * suggestion.
 *
 * Hand-rolled regex/lexer pipeline — no NLP library, no model calls.
 * Tested against a corpus of 30+ fixtures (see repetitionGrammar.test.ts).
 *
 * @see #487 — initial implementation
 * @see src/domain/task.ts — RepetitionRule schema
 * @see DESIGN.md "Domain-specific NL helpers"
 */

import type { MonthlyAnchor, RepetitionRule, Weekday } from "./task.js";

// ---------------------------------------------------------------------------
// Result discriminated union
// ---------------------------------------------------------------------------

export interface RepetitionInterpretation {
  rule: RepetitionRule;
  description: string;
}

export type RepetitionParseResult =
  | { kind: "ok"; rule: RepetitionRule; normalizedDescription: string }
  | { kind: "ambiguous"; interpretations: RepetitionInterpretation[] }
  | {
      kind: "error";
      reason: "no-repetition-detected" | "unsupported-pattern";
      suggestion?: string;
    };

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const WEEKDAYS: ReadonlyArray<{ aliases: string[]; weekday: Weekday }> = [
  { aliases: ["sunday", "sundays", "sun"], weekday: "sunday" },
  { aliases: ["monday", "mondays", "mon"], weekday: "monday" },
  { aliases: ["tuesday", "tuesdays", "tue", "tues"], weekday: "tuesday" },
  { aliases: ["wednesday", "wednesdays", "wed"], weekday: "wednesday" },
  { aliases: ["thursday", "thursdays", "thu", "thurs"], weekday: "thursday" },
  { aliases: ["friday", "fridays", "fri"], weekday: "friday" },
  { aliases: ["saturday", "saturdays", "sat"], weekday: "saturday" },
];

const WEEKDAY_LOOKUP: ReadonlyMap<string, Weekday> = new Map(
  WEEKDAYS.flatMap(({ aliases, weekday }) => aliases.map((a) => [a, weekday] as const)),
);

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ["a", 1],
  ["an", 1],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
]);

type WeekdayPosition = 1 | 2 | 3 | 4 | "last";

const POSITION_WORDS: ReadonlyMap<string, WeekdayPosition> = new Map<string, WeekdayPosition>([
  ["first", 1],
  ["1st", 1],
  ["second", 2],
  ["2nd", 2],
  ["third", 3],
  ["3rd", 3],
  ["fourth", 4],
  ["4th", 4],
  ["last", "last"],
  ["final", "last"],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize input — lowercase, collapse whitespace, strip surrounding noise. */
function normalize(prose: string): string {
  return prose.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Parse an integer or English number word. Returns `null` if unparseable. */
function parseCount(token: string | undefined): number | null {
  if (!token) return null;
  const num = Number.parseInt(token, 10);
  if (Number.isFinite(num) && num >= 1) return num;
  const word = NUMBER_WORDS.get(token);
  return word !== undefined ? word : null;
}

/** Stable order for weekdays — Sunday first, matching OmniFocus internals. */
const WEEKDAY_ORDER: ReadonlyArray<Weekday> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function sortWeekdays(weekdays: readonly Weekday[]): Weekday[] {
  return [...weekdays].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
}

function describeWeekdays(weekdays: readonly Weekday[]): string {
  if (weekdays.length === 0) return "";
  if (weekdays.length === 7) return "every day";

  const sorted = sortWeekdays(weekdays);
  const weekdaysSet = new Set(sorted);
  const weekdaySet: ReadonlySet<Weekday> = new Set([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ]);
  if (weekdaysSet.size === 5 && [...weekdaySet].every((d) => weekdaysSet.has(d))) {
    return "every weekday";
  }
  if (weekdaysSet.size === 2 && weekdaysSet.has("saturday") && weekdaysSet.has("sunday")) {
    return "every weekend";
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const names = sorted.map(cap);
  if (names.length === 1) return `every ${names[0]}`;
  if (names.length === 2) return `every ${names[0]} and ${names[1]}`;
  return `every ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function describePosition(position: 1 | 2 | 3 | 4 | "last"): string {
  if (position === "last") return "last";
  return ["first", "second", "third", "fourth"][position - 1] ?? String(position);
}

function describeMethod(method: RepetitionRule["method"]): string {
  if (method === "start-again") return "after I complete it";
  if (method === "due-again") return "from the due date";
  return "";
}

/** Build a normalized description from a rule plus optional time/end advisories. */
function describeRule(rule: RepetitionRule, suffix: string): string {
  let core: string;
  if (rule.weekdays && rule.weekdays.length > 0) {
    core = describeWeekdays(rule.weekdays);
    if (rule.steps !== 1) core = `${core} every ${rule.steps} weeks`;
  } else if (rule.monthlyAnchor) {
    if ("day" in rule.monthlyAnchor) {
      core = `the ${rule.monthlyAnchor.day} of every month`;
    } else {
      const anchor = rule.monthlyAnchor;
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      core = `the ${describePosition(anchor.position)} ${cap(anchor.weekday)} of every month`;
    }
    if (rule.steps !== 1) core = `${core.replace("every month", `every ${rule.steps} months`)}`;
  } else {
    const unit = rule.steps === 1 ? rule.unit.replace(/s$/, "") : rule.unit;
    core = rule.steps === 1 ? `every ${unit}` : `every ${rule.steps} ${unit}`;
  }

  const methodSuffix = describeMethod(rule.method);
  const parts = [core, suffix, methodSuffix].filter((s) => s.length > 0);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

interface MethodMatch {
  method: RepetitionRule["method"];
  consumed: string;
}

/**
 * Detect "after I complete it" / "from completion" / "after completion"
 * patterns. Returns the method and the substring to strip from the input
 * before further parsing. Default method is `fixed`.
 */
function detectMethod(text: string): MethodMatch {
  const completionPatterns: ReadonlyArray<{ re: RegExp; method: RepetitionRule["method"] }> = [
    { re: /\bafter i complete (it|the task)?\b/, method: "start-again" },
    { re: /\bafter completion\b/, method: "start-again" },
    { re: /\bfrom completion\b/, method: "start-again" },
    { re: /\bonce completed\b/, method: "start-again" },
    { re: /\bfrom the due date\b/, method: "due-again" },
    { re: /\bfrom (its|the) due date\b/, method: "due-again" },
  ];
  for (const { re, method } of completionPatterns) {
    const match = text.match(re);
    if (match) return { method, consumed: match[0] };
  }
  return { method: "fixed", consumed: "" };
}

/** Detect "at HH(:MM)?(am|pm)?" — returns the prose substring for narration. */
function detectTimeOfDay(text: string): string {
  const match = text.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return "";
  const hour = match[1];
  const minute = match[2] ?? "00";
  const ampm = match[3] ?? "";
  return `at ${hour}:${minute}${ampm}`.replace(":00am", "am").replace(":00pm", "pm").trim();
}

/** Detect end conditions ("for N weeks", "until YYYY-MM-DD", "N times"). */
function detectEndCondition(text: string): string {
  const forMatch = text.match(
    /\bfor (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\b/,
  );
  if (forMatch) {
    const count = parseCount(forMatch[1]);
    const unit = forMatch[2];
    if (count !== null) return `for ${count} ${unit}${count === 1 ? "" : "s"}`;
  }
  const untilMatch = text.match(/\buntil (\d{4}-\d{2}-\d{2}|\w+ \d{1,2}(?:,? \d{4})?)\b/);
  if (untilMatch) return `until ${untilMatch[1]}`;
  const timesMatch = text.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+times\b/,
  );
  if (timesMatch) {
    const count = parseCount(timesMatch[1]);
    if (count !== null) return `${count} times`;
  }
  return "";
}

interface FrequencyMatch {
  rule: Pick<RepetitionRule, "unit" | "steps"> & {
    weekdays?: Weekday[];
    monthlyAnchor?: MonthlyAnchor;
  };
}

/**
 * Match a frequency clause. Returns `null` when no recognized frequency
 * appears. Caller adds method, time-of-day narration, etc.
 *
 * Patterns recognized (in order):
 *   - "every weekday" / "every weekend"
 *   - "every {weekday}[, {weekday}, ...] [and {weekday}]"
 *   - "every other {weekday}" (returns weekly with steps=2; ambiguity
 *     flagged by caller — see parseRepetitionFromProse)
 *   - "every {N} {unit}s" / "every {N|num-word} {unit}"
 *   - "the {position} {weekday} of (every|each) month"
 *   - "the {N} of (every|each) month"
 *   - "daily" / "weekly" / "monthly" / "yearly" / "annually"
 *   - "biweekly" / "fortnightly" / "bimonthly"
 */
function detectFrequency(text: string): FrequencyMatch | null {
  // Single-word frequencies
  if (/\bdaily\b/.test(text)) return { rule: { unit: "days", steps: 1 } };
  if (/\bweekly\b/.test(text)) return { rule: { unit: "weeks", steps: 1 } };
  if (/\bmonthly\b/.test(text)) return { rule: { unit: "months", steps: 1 } };
  if (/\b(yearly|annually)\b/.test(text)) return { rule: { unit: "years", steps: 1 } };
  if (/\b(biweekly|fortnightly)\b/.test(text)) return { rule: { unit: "weeks", steps: 2 } };
  if (/\bbimonthly\b/.test(text)) return { rule: { unit: "months", steps: 2 } };

  // "every weekday" / "every weekend"
  if (/\bevery weekday\b/.test(text)) {
    return {
      rule: {
        unit: "weeks",
        steps: 1,
        weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
    };
  }
  if (/\bevery weekend\b/.test(text)) {
    return { rule: { unit: "weeks", steps: 1, weekdays: ["saturday", "sunday"] } };
  }

  // "the {position} {weekday} of (every|each) month"
  const positionalMonth = text.match(
    /\bthe (first|second|third|fourth|last|final|1st|2nd|3rd|4th)\s+([a-z]+)\s+of (every|each)?\s*month\b/,
  );
  if (positionalMonth) {
    const position = POSITION_WORDS.get(positionalMonth[1] ?? "");
    const weekday = WEEKDAY_LOOKUP.get(positionalMonth[2] ?? "");
    if (position !== undefined && weekday !== undefined) {
      return {
        rule: {
          unit: "months",
          steps: 1,
          monthlyAnchor: { weekday, position },
        },
      };
    }
  }

  // "the {N} of (every|each) month" / "the {N}{st|nd|rd|th} of (every|each) month"
  const dayOfMonth = text.match(/\bthe (\d{1,2})(?:st|nd|rd|th)?\s+of (every|each)?\s*month\b/);
  if (dayOfMonth) {
    const day = Number.parseInt(dayOfMonth[1] ?? "", 10);
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      return { rule: { unit: "months", steps: 1, monthlyAnchor: { day } } };
    }
  }

  // "every {N} {unit}s" — e.g. "every 3 days", "every two weeks"
  const everyN = text.match(
    /\bevery (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(minute|hour|day|week|month|year)s?\b/,
  );
  if (everyN) {
    const count = parseCount(everyN[1]);
    const unit = `${everyN[2]}s` as RepetitionRule["unit"];
    if (count !== null && count >= 1) {
      return { rule: { unit, steps: count } };
    }
  }

  // "every other {unit}" — e.g. "every other week"
  const everyOtherUnit = text.match(/\bevery other\s+(minute|hour|day|week|month|year)\b/);
  if (everyOtherUnit) {
    const unit = `${everyOtherUnit[1]}s` as RepetitionRule["unit"];
    return { rule: { unit, steps: 2 } };
  }

  // "every {weekday}[, {weekday}...] [and {weekday}]" — collect all weekdays in scan order
  // but skip "every other {weekday}" (handled by ambiguity layer)
  if (/\bevery other\s+([a-z]+)\b/.test(text)) {
    const m = text.match(/\bevery other\s+([a-z]+)\b/);
    const wd = m && WEEKDAY_LOOKUP.get(m[1] ?? "");
    if (wd) {
      // Caller layer turns this into ambiguity. Here we return a baseline
      // "every 2 weeks on weekday" rule. Caller may add a second
      // interpretation (first-and-third-weekday-of-month).
      return { rule: { unit: "weeks", steps: 2, weekdays: [wd] } };
    }
  }

  // "every {weekday}[s]" / "every Mon and Tues" / "every Mon, Wed, Fri"
  const everyWeekday = text.match(/\bevery\s+([a-z, ]+?)(?=$|\s+(at|after|from|once|until|for))/);
  if (everyWeekday) {
    const phrase = everyWeekday[1] ?? "";
    const tokens = phrase
      .replace(/\band\b/g, ",")
      .split(/[, ]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const weekdays: Weekday[] = [];
    for (const t of tokens) {
      const wd = WEEKDAY_LOOKUP.get(t);
      if (wd) weekdays.push(wd);
    }
    if (weekdays.length > 0) {
      // De-duplicate
      const unique = Array.from(new Set(weekdays));
      return { rule: { unit: "weeks", steps: 1, weekdays: unique } };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Top-level parser
// ---------------------------------------------------------------------------

/**
 * Parse prose into a `RepetitionRule` (or report ambiguity / failure).
 *
 * Algorithm:
 *   1. Normalize the prose.
 *   2. Detect optional method ("after I complete it" → start-again).
 *   3. Detect time-of-day and end-condition substrings (narration only —
 *      neither encodes into RepetitionRule today).
 *   4. Match a frequency clause via `detectFrequency`.
 *   5. If "every other {weekday}" fired, emit an ambiguous result with
 *      both readings (every 2 weeks on weekday vs. first-and-third-weekday).
 *   6. Otherwise emit `ok` with the normalized description.
 */
export function parseRepetitionFromProse(prose: string): RepetitionParseResult {
  if (!prose?.trim()) {
    return { kind: "error", reason: "no-repetition-detected" };
  }

  const text = normalize(prose);

  // Detect (and strip) method markers so they don't pollute the frequency
  // regexes that scan for "after"/"from"/"until" boundaries.
  const methodMatch = detectMethod(text);
  const stripped = methodMatch.consumed
    ? text.replace(methodMatch.consumed, " ").replace(/\s+/g, " ").trim()
    : text;

  const timeOfDay = detectTimeOfDay(stripped);
  const endCondition = detectEndCondition(stripped);

  const freq = detectFrequency(stripped);
  if (!freq) {
    return {
      kind: "error",
      reason: "no-repetition-detected",
      suggestion: "Try a phrase like 'every Monday', 'weekly', 'every 3 days', or 'monthly'.",
    };
  }

  const rule: RepetitionRule = {
    method: methodMatch.method,
    unit: freq.rule.unit,
    steps: freq.rule.steps,
    ...(freq.rule.weekdays ? { weekdays: sortWeekdays(freq.rule.weekdays) } : {}),
    ...(freq.rule.monthlyAnchor ? { monthlyAnchor: freq.rule.monthlyAnchor } : {}),
  };

  // Ambiguity layer: "every other {weekday}" admits two readings — a
  // every-14-days-on-weekday rule (already in `rule`) and a
  // first-and-third-weekday-of-month rule (a months-unit rule with
  // monthlyAnchor.position 1 and 3 — but our schema only supports a single
  // position, so we surface the *first weekday of the month* as the closest
  // approximation and let the agent confirm).
  const everyOtherWeekday = stripped.match(/\bevery other\s+([a-z]+)\b/);
  if (everyOtherWeekday) {
    const wd = WEEKDAY_LOOKUP.get(everyOtherWeekday[1] ?? "");
    if (wd) {
      const advisorySuffix = [timeOfDay, endCondition].filter(Boolean).join(", ");
      const interpretations: RepetitionInterpretation[] = [
        {
          rule,
          description: describeRule(rule, advisorySuffix),
        },
        {
          rule: {
            method: methodMatch.method,
            unit: "months",
            steps: 1,
            monthlyAnchor: { weekday: wd, position: 1 },
          },
          description: describeRule(
            {
              method: methodMatch.method,
              unit: "months",
              steps: 1,
              monthlyAnchor: { weekday: wd, position: 1 },
            },
            advisorySuffix,
          ),
        },
      ];
      return { kind: "ambiguous", interpretations };
    }
  }

  const advisorySuffix = [timeOfDay, endCondition].filter(Boolean).join(", ");
  return {
    kind: "ok",
    rule,
    normalizedDescription: describeRule(rule, advisorySuffix),
  };
}
