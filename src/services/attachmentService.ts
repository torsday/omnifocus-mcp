import type {
  AddAttachmentInput,
  AttachmentOwner,
  ListAttachmentsInput,
  OmniFocusAdapter,
  RemoveAttachmentInput,
  SaveAttachmentInput,
  SaveAttachmentResult,
} from "../adapter/OmniFocusAdapter.js";
import { assertAttachmentPath } from "../attachment/assertAttachmentPath.js";
import { assertAttachmentSize } from "../attachment/assertAttachmentSize.js";
import type { Attachment } from "../domain/attachment.js";
import type { AttachmentId } from "../domain/ids.js";

/**
 * Outcome of `add` / `remove` — the new/old attachment ID paired with the
 * owner's display name and kind so the agent can describe the mutation
 * without a follow-up read (lever-4 round-trip readability per
 * docs/nl-quality-standards.md §4 / #601).
 */
export interface AttachmentMutationOutcome {
  /** Owner kind: "task" or "project". */
  ownerKind: "task" | "project";
  /** Owner display name; null only if the owner was deleted between mutation and lookup. */
  ownerName: string | null;
}

/** Extract just the owner half (drop attachment-specific fields) from an add/remove input. */
function ownerFromInput(input: AttachmentOwner & object): AttachmentOwner {
  return "taskId" in input && input.taskId !== undefined
    ? { taskId: input.taskId }
    : {
        projectId: (
          input as { projectId: AttachmentOwner extends { projectId: infer P } ? P : never }
        ).projectId,
      };
}

function ownerKindOf(owner: AttachmentOwner): "task" | "project" {
  return "taskId" in owner ? "task" : "project";
}

// ---------------------------------------------------------------------------
// Service shape
// ---------------------------------------------------------------------------

export interface AttachmentServiceDeps {
  adapter: OmniFocusAdapter;
  /** Allowlist of absolute path prefixes for attachment operations. */
  allowedPaths: readonly string[];
  /** Max attachment size in MB; 0 = no cap. */
  maxAttachmentMb: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Attachment service — validates paths/sizes then delegates to the adapter.
 */
export class AttachmentService {
  private readonly adapter: OmniFocusAdapter;
  private readonly allowedPaths: readonly string[];
  private readonly maxMb: number;

  constructor(deps: AttachmentServiceDeps) {
    this.adapter = deps.adapter;
    this.allowedPaths = deps.allowedPaths;
    this.maxMb = deps.maxAttachmentMb;
  }

  /**
   * List all attachments on a task or project.
   *
   * @throws NotFound — when the owner does not exist
   */
  async list(input: ListAttachmentsInput): Promise<Attachment[]> {
    return this.adapter.listAttachments(input);
  }

  /**
   * Assert that a local file path could be added as an attachment — exists,
   * resolves inside the configured path scope, and is under the size cap —
   * without performing any mutation. Tools that create records *before*
   * attaching (e.g. task_extract_from_image) call this during their
   * validation phase so a bad path fails fast instead of orphaning a
   * partial write.
   *
   * @throws ValidationError — path outside allowed scope, missing file, or file exceeds cap
   */
  async assertAddable(filePath: string): Promise<void> {
    await assertAttachmentPath(filePath, this.allowedPaths);
    await assertAttachmentSize(filePath, this.maxMb);
  }

  /**
   * Add an attachment from a local file path.
   *
   * Path-scope and size-cap checks run before the adapter call so
   * invalid or oversized files fail fast with actionable errors.
   *
   * @throws ValidationError — path outside allowed scope or file exceeds cap
   * @throws NotFound — when the owner does not exist
   */
  async add(input: AddAttachmentInput): Promise<{ id: AttachmentId } & AttachmentMutationOutcome> {
    await this.assertAddable(input.filePath);
    const id = await this.adapter.addAttachment(input);
    const owner = ownerFromInput(input);
    return { id, ownerKind: ownerKindOf(owner), ownerName: await this.lookupOwnerName(owner) };
  }

  /**
   * Remove an attachment by ID.
   *
   * Captures the owner's display name *before* the JXA mutation so the
   * paired name survives even if the adapter call mutates the cache or
   * removes ancillary state (#601 AC). The lookup runs against the parent
   * task or project (which is not deleted), but we still gate on
   * pre-mutation read to keep the contract honest.
   *
   * @throws NotFound — when the owner or attachment does not exist
   */
  async remove(input: RemoveAttachmentInput): Promise<AttachmentMutationOutcome> {
    const owner = ownerFromInput(input);
    const ownerName = await this.lookupOwnerName(owner);
    await this.adapter.removeAttachment(input);
    return { ownerKind: ownerKindOf(owner), ownerName };
  }

  /**
   * Resolve a task/project owner to its display name.
   *
   * Returns `null` (rather than throwing) when the owner has been deleted
   * between the mutation and the lookup — surface the orphan rather than
   * failing the whole call.
   */
  private async lookupOwnerName(owner: AttachmentOwner): Promise<string | null> {
    try {
      if ("taskId" in owner) {
        const task = await this.adapter.getTask(owner.taskId);
        return task.name;
      }
      const project = await this.adapter.getProject(owner.projectId);
      return project.name;
    } catch {
      return null;
    }
  }

  /**
   * Save an attachment's content to a local file path.
   *
   * Destination path scope is validated before the adapter call.
   * The adapter is responsible for writing the bytes and reporting
   * the final size.
   *
   * @throws ValidationError — destination path outside allowed scope
   * @throws NotFound — when the owner or attachment does not exist
   * @throws ScriptError — when the OS-level write fails (disk full, etc.)
   */
  async saveTo(input: SaveAttachmentInput): Promise<SaveAttachmentResult> {
    // Validate the destination's *directory* — the file may not exist yet.
    const destDir = input.destPath.substring(0, input.destPath.lastIndexOf("/")) || "/";
    await assertAttachmentPath(destDir, this.allowedPaths);
    return this.adapter.saveAttachmentToPath(input);
  }
}
