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
