/**
 * Convert a `ZodError` into an array of agent-actionable validation failures.
 *
 * Default Zod messages ("Invalid input: expected int, received number") are
 * jargon. An agent reading them has to translate before it can fix its input.
 * This helper produces the structured shape every read of `ValidationError.details`
 * gets: `{ field, sent, expected, examples? }`. Stable enough to switch on,
 * specific enough to repair the call without another round-trip.
 *
 * The result is intended for `ValidationError.details.failures` — uniform across
 * every tool boundary. See `docs/nl-quality-standards.md` for the lever this
 * helper implements.
 *
 * @see docs/nl-quality-standards.md — fail-with-help error messages
 * @see DESIGN.md §6.7 — error taxonomy (`OF_VALIDATION`)
 */

import type { ZodError } from "zod";
import type { $ZodIssue } from "zod/v4/core";

/**
 * One field-level validation failure. Agents iterate over these and patch
 * their input before retrying.
 */
export interface ActionableValidation {
  /** Dotted path to the offending field, e.g. `"tags[0].name"`. `<root>` for top-level. */
  field: string;
  /** The value that was sent. Undefined when the field was missing. */
  sent: unknown;
  /** One-sentence description of what would have been accepted. */
  expected: string;
  /** Concrete valid values an agent can copy. Omitted when no useful examples exist. */
  examples?: unknown[];
}

/**
 * Render a Zod path to a dotted/bracketed string an agent can read.
 * Empty path → `<root>` so callers can still match on `field`.
 */
function renderPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "<root>";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

/**
 * Walk `input` along `path` and return the value at that location, or
 * `undefined` if the path doesn't resolve. Tolerant of missing parents.
 */
function pluck(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cursor: unknown = input;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor === "object") {
      cursor = (cursor as Record<PropertyKey, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Format a small list of values for an `expected:` string. Trims long lists
 * and quotes strings so the agent can see boundaries clearly.
 */
function formatChoices(values: ReadonlyArray<unknown>, max = 6): string {
  const head = values.slice(0, max);
  const rendered = head.map((v) => (typeof v === "string" ? `"${v}"` : String(v)));
  if (values.length > max) rendered.push(`… (${values.length - max} more)`);
  return rendered.join(" | ");
}

/**
 * Map an `invalid_format` issue (datetime, email, uuid, etc.) to a
 * human-friendly expected/example pair. Falls back to the format name itself
 * for formats we don't recognize — still better than `pattern: /…/`.
 */
function describeFormat(format: string): { expected: string; examples?: unknown[] } {
  switch (format) {
    case "datetime":
      return {
        expected: "ISO-8601 datetime, UTC (Z) or with offset",
        examples: ["2025-03-01T09:00:00Z", "2025-03-01T09:00:00-05:00"],
      };
    case "date":
      return { expected: "ISO-8601 date (YYYY-MM-DD)", examples: ["2025-03-01"] };
    case "time":
      return { expected: "ISO-8601 time (HH:MM:SS)", examples: ["09:00:00"] };
    case "email":
      return { expected: "email address", examples: ["user@example.com"] };
    case "url":
      return { expected: "absolute URL", examples: ["https://example.com/path"] };
    case "uuid":
      return { expected: "UUID v4", examples: ["3fa85f64-5717-4562-b3fc-2c963f66afa6"] };
    case "ipv4":
      return { expected: "IPv4 address", examples: ["192.0.2.42"] };
    case "ipv6":
      return { expected: "IPv6 address", examples: ["2001:db8::1"] };
    case "regex":
      return { expected: "string matching the schema's regex" };
    default:
      return { expected: `string in "${format}" format` };
  }
}

/**
 * Format a numeric/array/string bound. Uses `inclusive` to pick the right
 * comparator and `origin` to pluralize the unit ("≥ 1 character", "≥ 1 item").
 */
function describeBound(
  side: "min" | "max",
  bound: number,
  inclusive: boolean,
  origin: string | undefined,
): string {
  const cmp = side === "min" ? (inclusive ? "≥" : ">") : inclusive ? "≤" : "<";
  switch (origin) {
    case "string":
      return `string with ${cmp} ${bound} character${bound === 1 ? "" : "s"}`;
    case "array":
      return `array with ${cmp} ${bound} item${bound === 1 ? "" : "s"}`;
    case "set":
      return `set with ${cmp} ${bound} member${bound === 1 ? "" : "s"}`;
    default:
      return `value ${cmp} ${bound}`;
  }
}

/**
 * Map a single Zod issue to one or more `ActionableValidation` rows. Most
 * issues map 1-to-1; `unrecognized_keys` and `invalid_union` may fan out.
 */
function issueToActionable(issue: $ZodIssue, rootInput: unknown): ActionableValidation[] {
  const sentAt = (path: ReadonlyArray<PropertyKey>) =>
    rootInput === undefined ? undefined : pluck(rootInput, path);

  switch (issue.code) {
    case "invalid_type": {
      // Zod 4 surfaces `format` for refined string types (e.g. "email")
      // alongside `invalid_format`; for raw types, `expected` is enough.
      const expected = issue.expected;
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: `${expected}`,
        },
      ];
    }

    case "invalid_value": {
      const values = issue.values;
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: `one of: ${formatChoices(values)}`,
          ...(values.length > 0 && { examples: values.slice(0, 3) }),
        },
      ];
    }

    case "invalid_format": {
      const desc = describeFormat(issue.format);
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: desc.expected,
          ...(desc.examples && { examples: desc.examples }),
        },
      ];
    }

    case "too_small": {
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: describeBound(
            "min",
            Number(issue.minimum),
            issue.inclusive ?? true,
            issue.origin,
          ),
        },
      ];
    }

    case "too_big": {
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: describeBound(
            "max",
            Number(issue.maximum),
            issue.inclusive ?? true,
            issue.origin,
          ),
        },
      ];
    }

    case "unrecognized_keys": {
      // Path points at the parent object; offending keys live in `keys`.
      // Emit one row per stray key so the agent can drop them individually.
      const parentField = renderPath(issue.path);
      return issue.keys.map((key) => ({
        field: parentField === "<root>" ? key : `${parentField}.${key}`,
        sent: pluck(rootInput, [...issue.path, key]),
        expected: "key is not part of the schema; remove it",
      }));
    }

    case "not_multiple_of": {
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: `multiple of ${String(issue.divisor)}`,
        },
      ];
    }

    case "invalid_union": {
      // Pick the deepest issue from each branch — usually the one that got
      // furthest. If a branch only has top-level issues, take its first.
      const branchSummaries: ActionableValidation[] = [];
      for (const branch of issue.errors) {
        const deepest = branch.slice().sort((a, b) => b.path.length - a.path.length)[0];
        if (deepest !== undefined) {
          branchSummaries.push(...issueToActionable(deepest, rootInput));
        }
      }
      if (branchSummaries.length === 0) {
        return [
          {
            field: renderPath(issue.path),
            sent: sentAt(issue.path),
            expected: "value matching one of the schema's accepted shapes",
          },
        ];
      }
      // Collapse to one row pointing at the parent path with combined options.
      const expected = `one of: ${branchSummaries.map((b) => b.expected).join("; or ")}`;
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected,
        },
      ];
    }

    default: {
      // `custom` and any other future code falls through here.
      return [
        {
          field: renderPath(issue.path),
          sent: sentAt(issue.path),
          expected: issue.message || `value satisfying schema constraint "${String(issue.code)}"`,
        },
      ];
    }
  }
}

/**
 * Convert a `ZodError` into an array of `ActionableValidation` rows.
 *
 * @param zodError - The error produced by `schema.parse(...)` /
 *                   `schema.safeParse(...).error`.
 * @param input    - Original input. Optional; when provided, each row's
 *                   `sent` is populated by walking the issue path. Without it,
 *                   `sent` is `undefined` (still useful — `field` and
 *                   `expected` carry most of the signal).
 * @returns        One row per offending field. May be empty only if the
 *                 input `zodError.issues` is empty (degenerate).
 *
 * @example
 *   const result = schema.safeParse(input);
 *   if (!result.success) {
 *     throw new ValidationError("Invalid input", {
 *       details: { failures: zodToActionable(result.error, input) },
 *     });
 *   }
 */
export function zodToActionable(zodError: ZodError, input?: unknown): ActionableValidation[] {
  const out: ActionableValidation[] = [];
  for (const issue of zodError.issues) {
    out.push(...issueToActionable(issue, input));
  }
  return out;
}
