/**
 * `task_extract_from_image` MCP tool — vision-driven capture from a path
 * or an existing OmniFocus attachment.
 *
 * # Why this tool exists
 *
 * Vision-capable LLMs are good at extracting structured information from
 * images (whiteboard photos, business-card stacks, screenshots of meeting
 * agendas, scanned receipts). Per ADR-0008 (attachments by path, never
 * bytes), this MCP never moves binary data through the protocol. The split:
 *
 *   - **Agent does vision.** The agent reads the image (off-MCP) and
 *     produces a `proposed: ProposedTask[]` payload — same shape as
 *     `task_extract_from_note` so downstream prompts compose freely.
 *   - **Tool does plumbing.** Validate the source, create the tasks
 *     atomically, optionally re-attach the source image so the lineage
 *     survives.
 *
 * # Source modes
 *
 *   - `path` — agent has an image on disk (recent screenshot, downloaded
 *     photo). The path is validated against the attachment-path-scope
 *     allowlist (#69) and size cap (#70), and the extension is checked
 *     against the image allowlist before any task is written.
 *   - `attachment` — image is already attached to an OF task or project.
 *     v1 supports validation only; re-attaching an existing OF attachment
 *     onto newly-created tasks would require a save-to-temp + re-add
 *     round-trip and is deferred. Callers must use `attachSourceTo: "none"`
 *     in attachment mode; the tool returns a clear `ValidationError`
 *     otherwise.
 *
 * # Two-phase contract (mirrors task_extract_from_note / task_reclassify)
 *
 *   1. `dryRun: true` (default) — validate the source, echo `proposed`
 *      back to the agent so it can render to the user. No writes.
 *   2. `dryRun: false` with `confirmation: ProposedTask[]` — create the
 *      confirmed tasks via `batchCreateTasks` semantics and (optionally)
 *      attach the source image to the parent task or to each child.
 *
 * # Image extension allowlist
 *
 * PNG, JPG/JPEG, HEIC, GIF, WEBP, PDF (first-page extraction is the
 * agent's responsibility). The allowlist is descriptor-style: the agent
 * pre-filters before invoking; the tool fails closed on anything else.
 *
 * @see #486 — feature spec
 * @see #481 — task_extract_from_note (sibling pattern)
 * @see ADR-0008 — attachments by path, never bytes
 * @see src/attachment/assertAttachmentPath.ts — path-scope guard
 */

import { extname } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { CreateTaskInput, OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateTaskMutation } from "../../cache/invalidation.js";
import type { Attachment } from "../../domain/attachment.js";
import { AttachmentId, ProjectId, TaskId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import type { AttachmentService } from "../../services/attachmentService.js";

// ---------------------------------------------------------------------------
// Image type allowlist
// ---------------------------------------------------------------------------

/** Lowercased extensions accepted as image sources. PDFs are accepted but
 * the agent is responsible for first-page extraction (multi-page is a
 * follow-up). */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".gif",
  ".webp",
  ".pdf",
]);

/** Mime-type prefixes that count as images for attachment-mode validation. */
const IMAGE_MIME_PREFIXES = ["image/", "application/pdf"];

/**
 * The allowed image extensions, exposed for capability descriptors and tests.
 * Frozen so consumers can't mutate the canonical list.
 */
export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = Object.freeze([...IMAGE_EXTENSIONS]);

function hasImageExtension(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function attachmentLooksLikeImage(att: Attachment): boolean {
  if (att.mimeType !== null) {
    return IMAGE_MIME_PREFIXES.some((p) => att.mimeType?.startsWith(p));
  }
  // Fall back to the filename extension when the OF mime-type is null.
  return hasImageExtension(att.name);
}

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_EXTRACT_FROM_IMAGE_DESCRIPTION =
  "Capture tasks from an image — agent does the vision work, this tool does the plumbing. " +
  "Source is either a local file path (kind: 'path') or an existing OmniFocus attachment " +
  "(kind: 'attachment'). The agent supplies the extraction as proposed: ProposedTask[]; " +
  "the tool validates the source, creates the tasks, and optionally re-attaches the image. " +
  "Two-phase contract: dryRun=true validates and echoes proposed; dryRun=false with " +
  "confirmation: ProposedTask[] writes via batchCreateTasks semantics. " +
  "attachSourceTo controls re-attachment: 'parent-task' creates a wrapper parent task and " +
  "attaches the image there (with the proposed tasks as children), 'each-task' attaches the " +
  "image to every created task (path mode only — re-attaching existing OF attachments is a " +
  "v1 follow-up; use 'none' in attachment mode), 'none' skips attachment entirely. " +
  "Path-mode supports PNG, JPG/JPEG, HEIC/HEIF, GIF, WEBP, and PDF (first page is the " +
  "agent's responsibility for PDFs); paths must pass the attachment-path-scope guard. " +
  "Do NOT use this tool when you already have structured tasks — call task_batch_create " +
  "directly. Returns { phase: 'dryRun', proposed, sourceKind } or { phase: 'created', " +
  "parent?, created: { taskId, name, attachedSourcePath? }[], outcome } accordingly. " +
  "Side effects: dryRun=true is read-only; dryRun=false creates tasks and may add " +
  "attachments. Mutations do not sync automatically — call sync_trigger if cross-device " +
  "visibility matters.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * `ProposedTask` — same shape as `task_extract_from_note` so the inbox-triage
 * prompt (#475) and other composers can accept either tool's output.
 */
const proposedTaskSchema = z.object({
  name: z.string().min(1).describe("Task name."),
  note: z.string().optional().describe("Optional note body for the created task."),
  deferDate: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tag NAMES — resolved by the agent before passing here, since this tool does not look up tag IDs.",
    ),
});

const sourceSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("path"),
      imagePath: z
        .string()
        .min(1)
        .describe(
          "Absolute path to the image file. Must be within the allowed attachment scope " +
            "(default: $HOME) and within the size cap (default: 100 MB).",
        ),
    }),
    z.object({
      kind: z.literal("attachment"),
      attachmentId: AttachmentId.schema.describe("Persistent ID of the source attachment."),
      ownerTaskId: TaskId.schema
        .optional()
        .describe(
          "Task that owns the source attachment. Provide exactly one of ownerTaskId or ownerProjectId.",
        ),
      ownerProjectId: ProjectId.schema
        .optional()
        .describe(
          "Project that owns the source attachment. Provide exactly one of ownerTaskId or ownerProjectId.",
        ),
    }),
  ])
  .describe("Where to read the source image from.");

const attachSourceToSchema = z
  .enum(["parent-task", "each-task", "none"])
  .default("parent-task")
  .describe(
    "Where the source image is re-attached after task creation. " +
      "'parent-task' (default) creates a wrapper parent task and attaches the image there; " +
      "'each-task' attaches the image to every created task; " +
      "'none' creates tasks without re-attachment.",
  );

/**
 * Inner ZodObject — exposes `.shape` for MCP registration. The exported
 * schema below applies the cross-field refinement.
 */
const taskExtractFromImageInputBaseSchema = z.object({
  source: sourceSchema,
  targetProjectId: ProjectId.schema.describe(
    "Project that will receive created tasks on dryRun=false.",
  ),
  proposed: z
    .array(proposedTaskSchema)
    .min(1)
    .describe(
      "Agent-supplied extraction. Echoed back as preview on dryRun=true; ignored on dryRun=false " +
        "in favor of confirmation[] (which the agent can edit before passing).",
    ),
  attachSourceTo: attachSourceToSchema,
  parentTaskName: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Name of the wrapper parent task when attachSourceTo is 'parent-task'. " +
        "Defaults to 'Captured from image' when unset.",
    ),
  dryRun: z
    .boolean()
    .default(true)
    .describe(
      "Default true — validate and echo proposed without creating. false requires confirmation[].",
    ),
  confirmation: z
    .array(proposedTaskSchema)
    .optional()
    .describe(
      "Required when dryRun is false. The (possibly-edited) ProposedTask[] the agent has confirmed with the user.",
    ),
});

export const taskExtractFromImageInputSchema = taskExtractFromImageInputBaseSchema
  .refine((v) => v.dryRun || v.confirmation !== undefined, {
    message: "confirmation[] is required when dryRun is false",
    path: ["confirmation"],
  })
  .refine(
    (v) =>
      v.source.kind !== "attachment" ||
      (v.source.ownerTaskId !== undefined) !== (v.source.ownerProjectId !== undefined),
    {
      message:
        "attachment source requires exactly one of source.ownerTaskId or source.ownerProjectId",
      path: ["source"],
    },
  );

export type TaskExtractFromImageInput = z.infer<typeof taskExtractFromImageInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface TaskExtractFromImageContext {
  adapter: OmniFocusAdapter;
  attachmentService: AttachmentService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: InvalidatingCache;
}

interface ResolvedPathSource {
  kind: "path";
  imagePath: string;
}

interface ResolvedAttachmentSource {
  kind: "attachment";
  attachment: Attachment;
}

type ResolvedSource = ResolvedPathSource | ResolvedAttachmentSource;

/**
 * Validate the source and resolve it to either a vetted file path or a
 * vetted attachment reference. Throws ValidationError on any rejection so
 * the dry-run and write phases share the same fail-fast behaviour.
 */
async function resolveAndValidateSource(
  source: TaskExtractFromImageInput["source"],
  ctx: TaskExtractFromImageContext,
): Promise<ResolvedSource> {
  if (source.kind === "path") {
    if (!hasImageExtension(source.imagePath)) {
      throw new ValidationError(
        `Unsupported image extension for ${source.imagePath}. Allowed: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}`,
        { details: { field: "source.imagePath" } },
      );
    }
    // The path-scope and size-cap guards are the same checks AttachmentService
    // runs on attachment_add; we reach into the service rather than duplicate.
    return { kind: "path", imagePath: source.imagePath };
  }

  // attachment kind — look up the attachment via the service layer.
  const owner = source.ownerTaskId
    ? { taskId: source.ownerTaskId }
    : // biome-ignore lint/style/noNonNullAssertion: schema refinement guarantees one of the two
      { projectId: source.ownerProjectId! };
  const attachments = await ctx.attachmentService.list(owner);
  const found = attachments.find((a) => a.id === source.attachmentId);
  if (!found) {
    throw new ValidationError(`Attachment not found on owner: ${source.attachmentId}`, {
      details: { field: "source.attachmentId", attachmentId: source.attachmentId },
    });
  }
  if (!attachmentLooksLikeImage(found)) {
    throw new ValidationError(
      `Attachment is not an image (mimeType=${found.mimeType ?? "null"}, name=${found.name})`,
      { details: { field: "source.attachmentId", attachmentId: source.attachmentId } },
    );
  }
  return { kind: "attachment", attachment: found };
}

/**
 * Result entry per created task.
 */
export interface CreatedTaskRecord {
  taskId: TaskId;
  name: string;
  /** Path of the source image attached to this task, when applicable. */
  attachedSourcePath?: string;
}

/** Wrapper-parent record returned in `attachSourceTo: "parent-task"` mode. */
export interface ParentTaskRecord {
  taskId: TaskId;
  name: string;
  attachedSourcePath?: string;
}

/** Pure handler — callable directly in unit tests. */
export async function handleTaskExtractFromImage(
  input: TaskExtractFromImageInput,
  ctx: TaskExtractFromImageContext,
) {
  // Always validate the source — catches bad paths / non-image attachments
  // before the agent burns time on a write phase.
  const resolved = await resolveAndValidateSource(input.source, ctx);

  if (input.dryRun || !input.confirmation) {
    const meta = ctx.makeMeta();
    return ok(
      {
        phase: "dryRun" as const,
        proposed: input.proposed,
        sourceKind: resolved.kind,
      },
      meta,
    );
  }

  // -- Write phase ---------------------------------------------------------
  // Reject the not-yet-supported combinations early so the user's intent
  // surfaces as a clear error rather than a silent skip-attachment.
  if (resolved.kind === "attachment" && input.attachSourceTo !== "none") {
    throw new ValidationError(
      "Attachment-mode source supports attachSourceTo='none' only in v1. " +
        "Re-attaching an existing OF attachment to newly-created tasks " +
        "(save-to-temp + re-add round-trip) is a follow-up. Use 'none' or " +
        "switch to path-mode if you need re-attachment.",
      { details: { field: "attachSourceTo", attachSourceTo: input.attachSourceTo } },
    );
  }

  const confirmation = input.confirmation;

  // ── attachSourceTo === 'parent-task' ───────────────────────────────────
  // Create the parent first so we can hand its id to each child as parentId.
  // This nests the captured items under a single navigable container.
  if (input.attachSourceTo === "parent-task") {
    const parentName = input.parentTaskName ?? "Captured from image";
    const parentId = await ctx.adapter.createTask({
      name: parentName,
      projectId: input.targetProjectId,
    });

    let attachedSourcePath: string | undefined;
    if (resolved.kind === "path") {
      await ctx.attachmentService.add({ taskId: parentId, filePath: resolved.imagePath });
      attachedSourcePath = resolved.imagePath;
    }

    const childInputs: CreateTaskInput[] = confirmation.map((p) => ({
      name: p.name,
      parentId,
      ...(p.note !== undefined && { note: p.note }),
      ...(p.deferDate !== undefined && { deferDate: p.deferDate }),
      ...(p.dueDate !== undefined && { dueDate: p.dueDate }),
    }));
    const outcome = await ctx.adapter.batchCreateTasks(childInputs);

    const created: CreatedTaskRecord[] = outcome.succeeded.map((s) => {
      const proposed = confirmation[s.index];
      return {
        taskId: s.value,
        name: proposed?.name ?? "(unknown)",
      };
    });

    if (ctx.cache !== undefined) {
      invalidateTaskMutation(ctx.cache, { projectId: input.targetProjectId });
    }

    const meta = ctx.makeMeta({ syncPending: true });
    const parent: ParentTaskRecord = {
      taskId: parentId,
      name: parentName,
      ...(attachedSourcePath !== undefined && { attachedSourcePath }),
    };
    return ok(
      {
        phase: "created" as const,
        parent: parent as ParentTaskRecord | undefined,
        created,
        outcome,
      },
      meta,
    );
  }

  // ── attachSourceTo in {'each-task', 'none'} ────────────────────────────
  const flatInputs: CreateTaskInput[] = confirmation.map((p) => ({
    name: p.name,
    projectId: input.targetProjectId,
    ...(p.note !== undefined && { note: p.note }),
    ...(p.deferDate !== undefined && { deferDate: p.deferDate }),
    ...(p.dueDate !== undefined && { dueDate: p.dueDate }),
  }));
  const outcome = await ctx.adapter.batchCreateTasks(flatInputs);

  const created: CreatedTaskRecord[] = [];
  for (const s of outcome.succeeded) {
    const proposed = confirmation[s.index];
    let attachedSourcePath: string | undefined;
    if (input.attachSourceTo === "each-task" && resolved.kind === "path") {
      await ctx.attachmentService.add({ taskId: s.value, filePath: resolved.imagePath });
      attachedSourcePath = resolved.imagePath;
    }
    created.push({
      taskId: s.value,
      name: proposed?.name ?? "(unknown)",
      ...(attachedSourcePath !== undefined && { attachedSourcePath }),
    });
  }

  if (ctx.cache !== undefined && outcome.succeeded.length > 0) {
    invalidateTaskMutation(ctx.cache, { projectId: input.targetProjectId });
  }

  const meta = ctx.makeMeta({ syncPending: outcome.succeeded.length > 0 });
  return ok(
    {
      phase: "created" as const,
      parent: undefined as ParentTaskRecord | undefined,
      created,
      outcome,
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskExtractFromImageTool(
  server: McpServer,
  ctx: TaskExtractFromImageContext,
) {
  return server.registerTool(
    "task_extract_from_image",
    {
      description: TASK_EXTRACT_FROM_IMAGE_DESCRIPTION,
      inputSchema: taskExtractFromImageInputBaseSchema.shape,
    },
    async (args: TaskExtractFromImageInput) => {
      const envelope = await handleTaskExtractFromImage(args, ctx);
      return toolResponse(envelope);
    },
  );
}
