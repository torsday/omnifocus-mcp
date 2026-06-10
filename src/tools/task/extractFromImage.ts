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
import { NAME_MAX_CHARS, NOTE_MAX_CHARS } from "../../domain/inputLimits.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { validateRefined } from "../../errors/validateRefined.js";
import type { AttachmentService } from "../../services/attachmentService.js";

// ---------------------------------------------------------------------------
// Image type allowlist
// ---------------------------------------------------------------------------

/** Lowercased extensions accepted as image sources. PDF first-page extraction
 * is the agent's responsibility (multi-page is a follow-up). */
const IMAGE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".gif",
  ".webp",
  ".pdf",
];

function hasImageExtension(filePath: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(filePath).toLowerCase());
}

function attachmentLooksLikeImage(att: Attachment): boolean {
  if (att.mimeType !== null) {
    return att.mimeType.startsWith("image/") || att.mimeType === "application/pdf";
  }
  return hasImageExtension(att.name);
}

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const TASK_EXTRACT_FROM_IMAGE_DESCRIPTION =
  "Capture tasks from an image — agent does vision, tool does plumbing. " +
  "Source is a path or existing OF attachment; agent supplies proposed: ProposedTask[]. " +
  "Two-phase: dryRun=true validates+echoes; dryRun=false with confirmation[] writes. " +
  "attachSourceTo: 'parent-task' (default), 'each-task' (path-mode only), or 'none'. " +
  "Path-mode: PNG/JPEG/HEIC/HEIF/GIF/WEBP/PDF; respects attachment-path-scope + size cap. " +
  "Do NOT use when you already have structured tasks — call task_batch_create. " +
  "Returns { phase, proposed?, parent?, created?, outcome? }. " +
  "Side effects: dryRun=false creates tasks; call sync_trigger for cross-device. " +
  'Example: task_extract_from_image({ source: { kind: "path", path: "/tmp/whiteboard.png" }, proposed: [{ name: "Follow up with Alice" }], dryRun: true })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * `ProposedTask` — same shape as `task_extract_from_note` so the inbox-triage
 * prompt (#475) and other composers can accept either tool's output.
 */
const proposedTaskSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(NAME_MAX_CHARS, "max 1 KB")
    .describe("Task name extracted from the image."),
  note: z
    .string()
    .max(NOTE_MAX_CHARS, "max 1 MB")
    .optional()
    .describe("Additional context or plain-text note for the task."),
  deferDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Defer date as ISO-8601 with offset, if detected in the image."),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("Due date as ISO-8601 with offset, if detected in the image."),
});

const sourceSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("path"),
        imagePath: z
          .string()
          .min(1)
          .describe(
            "Absolute path within attachment-path-scope, with one of the supported image " +
              `extensions (${IMAGE_EXTENSIONS.join(",")}). Subject to the configured size cap.`,
          )
          .refine(hasImageExtension, {
            message: `imagePath must use one of ${IMAGE_EXTENSIONS.join(",")}`,
          }),
      })
      .describe("Image read from a filesystem path."),
    z
      .object({
        kind: z.literal("attachment"),
        attachmentId: AttachmentId.schema.describe(
          "Persistent ID of the OF attachment carrying the image.",
        ),
        ownerTaskId: TaskId.schema
          .optional()
          .describe(
            "Owner task that holds the attachment. Mutually exclusive with ownerProjectId.",
          ),
        ownerProjectId: ProjectId.schema
          .optional()
          .describe(
            "Owner project that holds the attachment. Mutually exclusive with ownerTaskId.",
          ),
      })
      .describe("Image referenced via an existing OF attachment ID."),
  ])
  .describe("Image source. attachment requires exactly one owner.");

const attachSourceToSchema = z
  .enum(["parent-task", "each-task", "none"])
  .default("parent-task")
  .describe("Re-attachment mode after task creation.");

/**
 * Inner ZodObject — exposes `.shape` for MCP registration. The exported
 * schema below applies the cross-field refinement.
 */
export const taskExtractFromImageInputBaseSchema = z.object({
  source: sourceSchema,
  targetProjectId: ProjectId.schema.describe(
    "Project that receives the captured tasks (and the wrapper, if `parent-task` mode).",
  ),
  proposed: z.array(proposedTaskSchema).min(1).describe("Agent-supplied extraction."),
  attachSourceTo: attachSourceToSchema,
  parentTaskName: z
    .string()
    .min(1)
    .optional()
    .describe("Wrapper parent task name; default 'Captured from image'."),
  dryRun: z
    .boolean()
    .default(true)
    .describe("true (default) = preview; false requires confirmation[]."),
  confirmation: z
    .array(proposedTaskSchema)
    .optional()
    .describe("Required when dryRun=false. (Possibly-edited) confirmed tasks."),
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
  )
  .refine((v) => v.source.kind !== "attachment" || v.attachSourceTo === "none", {
    message: "attachment-mode source requires attachSourceTo='none' (v1 limitation)",
    path: ["attachSourceTo"],
  });

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

type ResolvedSource =
  | { kind: "path"; imagePath: string }
  | { kind: "attachment"; attachment: Attachment };

export interface CreatedTaskRecord {
  taskId: TaskId;
  name: string;
  attachedSourcePath?: string;
}

export interface ParentTaskRecord {
  taskId: TaskId;
  name: string;
  attachedSourcePath?: string;
}

async function resolveSource(
  source: TaskExtractFromImageInput["source"],
  ctx: TaskExtractFromImageContext,
): Promise<ResolvedSource> {
  if (source.kind === "path") {
    // Image-extension check is enforced at the Zod boundary
    // (see sourceSchema.path.imagePath.refine). Path scope, existence, and
    // size cap must be asserted HERE — before any task is written — so both
    // the dry-run preview and the write phase fail fast instead of orphaning
    // a wrapper task when a later attachmentService.add rejects the path.
    await ctx.attachmentService.assertAddable(source.imagePath);
    return { kind: "path", imagePath: source.imagePath };
  }
  const owner = source.ownerTaskId
    ? { taskId: source.ownerTaskId }
    : // biome-ignore lint/style/noNonNullAssertion: schema refinement guarantees one of the two
      { projectId: source.ownerProjectId! };
  const found = (await ctx.attachmentService.list(owner)).find((a) => a.id === source.attachmentId);
  if (!found) {
    throw new ValidationError(`Attachment not found: ${source.attachmentId}`, {
      details: { field: "source.attachmentId" },
    });
  }
  if (!attachmentLooksLikeImage(found)) {
    throw new ValidationError(`Attachment is not an image: ${found.name}`, {
      details: { field: "source.attachmentId" },
    });
  }
  return { kind: "attachment", attachment: found };
}

function toCreateInput(
  p: {
    name: string;
    note?: string | undefined;
    deferDate?: string | undefined;
    dueDate?: string | undefined;
  },
  parent: { projectId: ProjectId } | { parentId: TaskId },
): CreateTaskInput {
  return {
    name: p.name,
    ...parent,
    ...(p.note !== undefined && { note: p.note }),
    ...(p.deferDate !== undefined && { deferDate: p.deferDate }),
    ...(p.dueDate !== undefined && { dueDate: p.dueDate }),
  };
}

/** Pure handler — callable directly in unit tests. */
export async function handleTaskExtractFromImage(
  input: TaskExtractFromImageInput,
  ctx: TaskExtractFromImageContext,
) {
  // Re-parse against the refined schema so the cross-field rules
  // (dryRun→confirmation; attachment-source owner XOR) actually fire — the
  // SDK only validates the base shape. See src/errors/validateRefined.ts.
  validateRefined(taskExtractFromImageInputSchema, input);

  // Always validate the source — catches bad paths / non-image attachments
  // before the agent burns time on a write phase.
  const resolved = await resolveSource(input.source, ctx);

  if (input.dryRun || !input.confirmation) {
    return ok(
      { phase: "dryRun" as const, proposed: input.proposed, sourceKind: resolved.kind },
      ctx.makeMeta(),
    );
  }

  // The (resolved.kind === "attachment" && attachSourceTo !== "none")
  // exclusion is now enforced at the Zod boundary (see input-schema refine).
  const confirmation = input.confirmation;
  const sourcePath = resolved.kind === "path" ? resolved.imagePath : undefined;
  let parent: ParentTaskRecord | undefined;
  let parentScope: { projectId: ProjectId } | { parentId: TaskId } = {
    projectId: input.targetProjectId,
  };

  // attachSourceTo === 'parent-task': create the wrapper first so children nest beneath it.
  if (input.attachSourceTo === "parent-task") {
    const parentName = input.parentTaskName ?? "Captured from image";
    const parentId = await ctx.adapter.createTask({
      name: parentName,
      projectId: input.targetProjectId,
    });
    if (sourcePath !== undefined) {
      await ctx.attachmentService.add({ taskId: parentId, filePath: sourcePath });
    }
    parent = {
      taskId: parentId,
      name: parentName,
      ...(sourcePath !== undefined && { attachedSourcePath: sourcePath }),
    };
    parentScope = { parentId };
  }

  const outcome = await ctx.adapter.batchCreateTasks(
    confirmation.map((p) => toCreateInput(p, parentScope)),
  );

  const created: CreatedTaskRecord[] = [];
  for (const s of outcome.succeeded) {
    const proposed = confirmation[s.index];
    let attachedSourcePath: string | undefined;
    if (input.attachSourceTo === "each-task" && sourcePath !== undefined) {
      await ctx.attachmentService.add({ taskId: s.value, filePath: sourcePath });
      attachedSourcePath = sourcePath;
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
  return ok({ phase: "created" as const, parent, created, outcome }, meta);
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
