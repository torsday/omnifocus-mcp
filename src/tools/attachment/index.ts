/**
 * Attachment tools — `attachment_list`, `attachment_create`, `attachment_delete`,
 * `attachment_save_to_path`.
 *
 * `attachment_create` / `attachment_delete` are the canonical CRUD names (#837
 * vocabulary). The former names `attachment_add` / `attachment_remove` remain
 * registered as **deprecated aliases** for one minor version — they delegate to
 * the same handlers and emit a `tool.deprecated` log event so callers can
 * migrate. They are slated for removal in the next major (#1051).
 *
 * Attachment content (bytes) is **never** returned over MCP. Use
 * `attachment_save_to_path` to copy an attachment to the local filesystem.
 * All paths are validated against `OMNIFOCUS_ATTACHMENT_PATHS` (default: $HOME)
 * before any filesystem access.
 *
 * @see DESIGN.md §28 — tool surface
 * @see docs/design/tool-vocabulary.md — canonical verb vocabulary (#837)
 * @see src/services/attachmentService.ts — service layer
 * @see src/attachment/assertAttachmentPath.ts — path-scope guard
 * @see src/attachment/assertAttachmentSize.ts — size-cap guard
 * @see docs/domain-reference.md § Attachment — canonical schema
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AttachmentOwner } from "../../adapter/OmniFocusAdapter.js";
import { AttachmentId, ProjectId, TaskId } from "../../domain/ids.js";
import { FILE_PATH_MAX_CHARS } from "../../domain/inputLimits.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { logger } from "../../logging/logger.js";
import type { AttachmentService } from "../../services/attachmentService.js";

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

export interface AttachmentToolContext {
  attachmentService: AttachmentService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

// ---------------------------------------------------------------------------
// Shared owner schema
// ---------------------------------------------------------------------------

/**
 * Base ZodObject for the attachment owner fields.
 * Used for `.extend()` and `.shape` access — ZodEffects doesn't support these.
 * Apply `ownerRefinement` when you need cross-field validation.
 */
const ownerBaseSchema = z.object({
  taskId: TaskId.schema
    .optional()
    .describe(
      "Persistent ID of the task that owns the attachment. " +
        "Provide exactly one of taskId or projectId.",
    ),
  projectId: ProjectId.schema
    .optional()
    .describe(
      "Persistent ID of the project that owns the attachment. " +
        "Provide exactly one of taskId or projectId.",
    ),
});

function resolveOwner(input: z.infer<typeof ownerBaseSchema>): AttachmentOwner {
  if (input.taskId) return { taskId: TaskId.of(input.taskId) };
  if (input.projectId) return { projectId: ProjectId.of(input.projectId) };
  throw new ValidationError("Provide exactly one of taskId or projectId.", {});
}

// ---------------------------------------------------------------------------
// attachment_list
// ---------------------------------------------------------------------------

export const ATTACHMENT_LIST_DESCRIPTION =
  "List all file attachments on a task or project. " +
  "Do not use to retrieve attachment content — use attachment_save_to_path instead. " +
  "Returns { attachments } — array of objects with id, name, mimeType, sizeBytes, addedAt, and kind (embedded|alias). " +
  "Provide exactly one of taskId or projectId. Read-only; safe to retry. " +
  'Example: attachment_list({ taskId: "abc123" })';

/** Base ZodObject — used for `shape` access in tool registration and allInputSchemas. */
export const attachmentListInputSchema = ownerBaseSchema;

export async function handleAttachmentList(
  input: z.infer<typeof attachmentListInputSchema>,
  ctx: AttachmentToolContext,
) {
  const owner = resolveOwner(input);
  const attachments = await ctx.attachmentService.list(owner);
  return ok({ attachments }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// attachment_create  (canonical; formerly attachment_add)
// ---------------------------------------------------------------------------

export const ATTACHMENT_CREATE_DESCRIPTION =
  "Add a file attachment to a task or project from a local file path. " +
  "The file is embedded into the OmniFocus database. " +
  "Path must be within the allowed scope (default: $HOME; override via OMNIFOCUS_ATTACHMENT_PATHS). " +
  "File must not exceed the size cap (default 100 MB; override via OMNIFOCUS_MAX_ATTACHMENT_MB). " +
  "Returns { id, ownerKind, ownerName } — ownerKind is 'task' or 'project' and ownerName is the parent's display name (null only if the parent was deleted between the add and the lookup) so the agent can describe the new attachment without a follow-up read. " +
  "Mutations do not propagate until sync_trigger is called. " +
  'Example: attachment_create({ taskId: "abc123", filePath: "/Users/me/report.pdf" })';

export const attachmentCreateInputSchema = ownerBaseSchema.extend({
  filePath: z
    .string()
    .min(1)
    .max(FILE_PATH_MAX_CHARS, "max 4 KB")
    .describe(
      "Absolute path to the source file to attach. " +
        "Must be within the allowed attachment path scope.",
    ),
});

export async function handleAttachmentCreate(
  input: z.infer<typeof attachmentCreateInputSchema>,
  ctx: AttachmentToolContext,
) {
  const owner = resolveOwner(input);
  const { id, ownerKind, ownerName } = await ctx.attachmentService.add({
    ...owner,
    filePath: input.filePath,
  });
  return ok({ id, ownerKind, ownerName }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// attachment_delete  (canonical; formerly attachment_remove)
// ---------------------------------------------------------------------------

export const ATTACHMENT_DELETE_DESCRIPTION =
  "Remove an attachment from a task or project by attachment ID. " +
  "Do not use to retrieve or export attachment content — use attachment_save_to_path instead. " +
  "Returns { removed: true, attachmentId, ownerKind, ownerName } — ownerKind is 'task' or 'project' and ownerName is captured BEFORE the JXA call so it survives even if the lookup were to fail post-mutation; null only when the parent itself has been deleted. The agent can describe the removal without a follow-up read. " +
  "Throws NotFound if the attachment or owner does not exist. " +
  "Permanent — cannot be undone. Mutations do not propagate until sync_trigger is called. " +
  'Example: attachment_delete({ taskId: "abc123", attachmentId: "att456" })';

export const attachmentDeleteInputSchema = ownerBaseSchema.extend({
  attachmentId: AttachmentId.schema.describe(
    "Persistent ID of the attachment to remove. Get from attachment_list.",
  ),
});

export async function handleAttachmentDelete(
  input: z.infer<typeof attachmentDeleteInputSchema>,
  ctx: AttachmentToolContext,
) {
  const owner = resolveOwner(input);
  const attachmentId = AttachmentId.of(input.attachmentId);
  const { ownerKind, ownerName } = await ctx.attachmentService.remove({
    ...owner,
    attachmentId,
  });
  return ok({ removed: true as const, attachmentId, ownerKind, ownerName }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Deprecated aliases — attachment_add / attachment_remove (#1051)
// Removed in the next major. Kept one minor for migration; each logs
// `tool.deprecated` on use and delegates to the canonical handler.
// ---------------------------------------------------------------------------

export const ATTACHMENT_ADD_DESCRIPTION =
  "DEPRECATED — use attachment_create instead (renamed for CRUD-verb consistency). " +
  ATTACHMENT_CREATE_DESCRIPTION;

export const ATTACHMENT_REMOVE_DESCRIPTION =
  "DEPRECATED — use attachment_delete instead (renamed for CRUD-verb consistency). " +
  ATTACHMENT_DELETE_DESCRIPTION;

/** Deprecated alias schemas — identical shape to the canonical tools. */
export const attachmentAddInputSchema = attachmentCreateInputSchema;
export const attachmentRemoveInputSchema = attachmentDeleteInputSchema;

// ---------------------------------------------------------------------------
// attachment_save_to_path
// ---------------------------------------------------------------------------

export const ATTACHMENT_SAVE_TO_PATH_DESCRIPTION =
  "Copy an attachment's content to a local file path. " +
  "Do not use to list or remove attachments — use attachment_list or attachment_delete instead. " +
  "Returns { saved: true, path, sizeBytes } on success. " +
  "Destination path must be within the allowed scope (default: $HOME). " +
  "Writes the file to destPath (creates or overwrites); no side effects on OmniFocus data. " +
  'Example: attachment_save_to_path({ taskId: "abc123", attachmentId: "att456", destPath: "/Users/me/report.pdf" })';

export const attachmentSaveToPathInputSchema = ownerBaseSchema.extend({
  attachmentId: AttachmentId.schema.describe(
    "Persistent ID of the attachment to save. Get from attachment_list.",
  ),
  destPath: z
    .string()
    .min(1)
    .describe(
      "Absolute destination path where the attachment will be written. " +
        "Must be within the allowed attachment path scope. " +
        "Existing files are overwritten.",
    ),
});

export async function handleAttachmentSaveToPath(
  input: z.infer<typeof attachmentSaveToPathInputSchema>,
  ctx: AttachmentToolContext,
) {
  const owner = resolveOwner(input);
  const result = await ctx.attachmentService.saveTo({
    ...owner,
    attachmentId: AttachmentId.of(input.attachmentId),
    destPath: input.destPath,
  });
  return ok(result, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Batch registration
// ---------------------------------------------------------------------------

/**
 * Register all attachment tools on `server`: the four canonical tools plus the
 * two deprecated aliases (`attachment_add`, `attachment_remove`).
 *
 * @param server — MCP server instance
 * @param ctx    — shared dependencies (AttachmentService + makeMeta)
 */
export function registerAttachmentTools(server: McpServer, ctx: AttachmentToolContext): void {
  server.registerTool(
    "attachment_list",
    { description: ATTACHMENT_LIST_DESCRIPTION, inputSchema: attachmentListInputSchema.shape },
    async (args) => {
      const envelope = await handleAttachmentList(
        args as z.infer<typeof attachmentListInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );

  server.registerTool(
    "attachment_create",
    { description: ATTACHMENT_CREATE_DESCRIPTION, inputSchema: attachmentCreateInputSchema.shape },
    async (args) => {
      const envelope = await handleAttachmentCreate(
        args as z.infer<typeof attachmentCreateInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );

  server.registerTool(
    "attachment_delete",
    { description: ATTACHMENT_DELETE_DESCRIPTION, inputSchema: attachmentDeleteInputSchema.shape },
    async (args) => {
      const envelope = await handleAttachmentDelete(
        args as z.infer<typeof attachmentDeleteInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );

  // Deprecated alias: attachment_add → attachment_create (#1051).
  server.registerTool(
    "attachment_add",
    { description: ATTACHMENT_ADD_DESCRIPTION, inputSchema: attachmentCreateInputSchema.shape },
    async (args) => {
      logger.warn(
        { event: "tool.deprecated", tool: "attachment_add", replacement: "attachment_create" },
        "tool 'attachment_add' is deprecated; use 'attachment_create'",
      );
      const envelope = await handleAttachmentCreate(
        args as z.infer<typeof attachmentCreateInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );

  // Deprecated alias: attachment_remove → attachment_delete (#1051).
  server.registerTool(
    "attachment_remove",
    { description: ATTACHMENT_REMOVE_DESCRIPTION, inputSchema: attachmentDeleteInputSchema.shape },
    async (args) => {
      logger.warn(
        { event: "tool.deprecated", tool: "attachment_remove", replacement: "attachment_delete" },
        "tool 'attachment_remove' is deprecated; use 'attachment_delete'",
      );
      const envelope = await handleAttachmentDelete(
        args as z.infer<typeof attachmentDeleteInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );

  server.registerTool(
    "attachment_save_to_path",
    {
      description: ATTACHMENT_SAVE_TO_PATH_DESCRIPTION,
      inputSchema: attachmentSaveToPathInputSchema.shape,
    },
    async (args) => {
      const envelope = await handleAttachmentSaveToPath(
        args as z.infer<typeof attachmentSaveToPathInputSchema>,
        ctx,
      );
      return toolResponse(envelope);
    },
  );
}
