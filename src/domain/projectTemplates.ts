/**
 * Project template metadata stored in the project note as a fenced YAML block.
 *
 * OmniFocus has no first-class template system. The convention this project
 * adopts (#472):
 *
 * - A folder (default name `Templates`, configurable via
 *   `OMNIFOCUS_TEMPLATES_FOLDER_NAME`) holds one project per template.
 * - Each template-project's name is the user-facing template name.
 * - The project note carries a fenced `project-template` YAML block at the
 *   top, followed by a TaskPaper rendering of the captured task tree.
 *
 * Example note body:
 *
 * ```project-template
 * name: Client onboarding
 * parameters: client,startDate
 * capturedAt: 2026-04-27T20:00:00Z
 * ```
 *
 * Client onboarding:
 *     - Send welcome email @flagged
 *     - Schedule kickoff @due(2026-05-04)
 *
 * The fence is parsed back by `project_template_list`; the TaskPaper body is
 * what `project_template_instantiate` (follow-up) will hand to the existing
 * `importTaskPaper` flow.
 *
 * @see src/domain/noteFences.ts — generic fence helper this builds on
 * @see src/tools/project/templateSave.ts — captures + writes
 * @see src/tools/project/templateList.ts — enumerates + reads
 */

import { z } from "zod";
import { isoDateString } from "./dates.js";
import { findFence, parseFenceBody, serializeFenceBody, upsertFence } from "./noteFences.js";

/** The fence tag used inside template-project notes. Stable wire format. */
export const PROJECT_TEMPLATE_FENCE = "project-template";

/** Structured metadata extracted from a template project's note. */
export interface ProjectTemplateMeta {
  /** Display name. Mirrors the project name; duplicated so `_list` can validate. */
  name: string;
  /**
   * Ordered list of parameter names the user marked for substitution at
   * instantiation time. Empty list when the template has no placeholders.
   */
  parameterNames: string[];
  /** ISO-8601-with-offset timestamp; when the template was captured. */
  capturedAt: string;
}

export const projectTemplateMetaSchema: z.ZodType<ProjectTemplateMeta> = z.object({
  name: z.string().min(1),
  parameterNames: z.array(z.string().min(1)),
  capturedAt: isoDateString(),
}) as z.ZodType<ProjectTemplateMeta>;

/**
 * Parse a `ProjectTemplateMeta` from a project note, or return undefined when
 * no fence is present or its content is malformed.
 *
 * Malformed fences degrade silently — `project_template_list` treats absence
 * as "not a template" rather than surfacing every hand-edit as an error.
 */
export function parseProjectTemplateMeta(note: string | null): ProjectTemplateMeta | undefined {
  const match = findFence(note, PROJECT_TEMPLATE_FENCE);
  if (match === undefined) return undefined;
  const fields = parseFenceBody(match.body);
  const candidate: Record<string, unknown> = {};
  if (typeof fields.name === "string" && fields.name.length > 0) candidate.name = fields.name;
  if (typeof fields.parameters === "string") {
    candidate.parameterNames = fields.parameters
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else {
    candidate.parameterNames = [];
  }
  if (typeof fields.capturedAt === "string" && fields.capturedAt.length > 0) {
    candidate.capturedAt = fields.capturedAt;
  }
  const parsed = projectTemplateMetaSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Build a project note containing the template fence followed by the captured
 * TaskPaper body. Field order in the fence is stable: name, parameters,
 * capturedAt.
 */
export function buildProjectTemplateNote(meta: ProjectTemplateMeta, taskPaperBody: string): string {
  const body = serializeFenceBody({
    name: meta.name,
    parameters: meta.parameterNames.length > 0 ? meta.parameterNames.join(",") : undefined,
    capturedAt: meta.capturedAt,
  });
  // upsertFence with an empty existing note prepends the fence; concatenate
  // the TaskPaper body below it with a blank-line separator so the fence is
  // visually distinct in the OmniFocus note editor.
  const fenceOnly = upsertFence(null, PROJECT_TEMPLATE_FENCE, body);
  if (taskPaperBody.length === 0) return fenceOnly;
  return `${fenceOnly}\n\n${taskPaperBody}`;
}

/**
 * Return the TaskPaper portion of a template-project note — i.e. everything
 * after the closing ` ``` ` of the metadata fence, with leading blank lines
 * trimmed. Returns the empty string if no fence is present.
 */
export function extractProjectTemplateBody(note: string | null): string {
  const match = findFence(note, PROJECT_TEMPLATE_FENCE);
  if (match === undefined || note === null) return "";
  return note.slice(match.end).replace(/^\n+/, "");
}

/**
 * Substitute `{{name}}` placeholders in a TaskPaper body with values from
 * `parameters`. Unknown placeholders (those not in the map) are left as-is so
 * the user can spot them in the resulting project rather than seeing silent
 * data loss.
 *
 * The match is `{{name}}` with optional whitespace inside the braces; names
 * are alphanumeric + underscore + hyphen. Substitution is purely textual —
 * no escaping, no markdown awareness. Callers should sanitize values that
 * could legitimately contain `}}` (rare).
 */
export function substituteTemplateParameters(
  body: string,
  parameters: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (match, name: string) => {
    if (Object.hasOwn(parameters, name)) return parameters[name] as string;
    return match;
  });
}

/**
 * Anchor used for relative-date shifting at instantiation time. The earliest
 * `@due(date)` in the template body is the natural anchor: shifting "the most
 * urgent thing" to the user's requested due date and preserving every other
 * date's offset from it produces an instantiated project whose deadline tree
 * has the same internal cadence.
 *
 * Returns `undefined` when the template has no `@due(date)` to anchor on —
 * date shifting is then skipped (templates without due dates have nothing to
 * shift).
 */
export function findTemplateAnchorDate(body: string): string | undefined {
  const dates: string[] = [];
  for (const m of body.matchAll(/@due\((\d{4}-\d{2}-\d{2})\)/g)) {
    dates.push(m[1] as string);
  }
  if (dates.length === 0) return undefined;
  return dates.sort()[0];
}

/**
 * Shift every `@due(YYYY-MM-DD)` and `@defer(YYYY-MM-DD)` in `body` by the
 * delta between `anchor` and `newAnchor` (both `YYYY-MM-DD`).
 *
 * Date math uses UTC midnight to avoid DST surprises — the dates carry no
 * time-of-day so calendar-day arithmetic is the right model.
 */
export function shiftTemplateDates(body: string, anchor: string, newAnchor: string): string {
  const anchorMs = Date.UTC(
    Number(anchor.slice(0, 4)),
    Number(anchor.slice(5, 7)) - 1,
    Number(anchor.slice(8, 10)),
  );
  const newAnchorMs = Date.UTC(
    Number(newAnchor.slice(0, 4)),
    Number(newAnchor.slice(5, 7)) - 1,
    Number(newAnchor.slice(8, 10)),
  );
  const deltaMs = newAnchorMs - anchorMs;
  if (deltaMs === 0) return body;

  const shift = (date: string): string => {
    const ms =
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) +
      deltaMs;
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  return body.replace(
    /@(due|defer)\((\d{4}-\d{2}-\d{2})\)/g,
    (_match, kind: string, date: string) => {
      return `@${kind}(${shift(date)})`;
    },
  );
}
