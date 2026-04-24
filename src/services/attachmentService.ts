import type {
  AddAttachmentInput,
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
   * Add an attachment from a local file path.
   *
   * Path-scope and size-cap checks run before the adapter call so
   * invalid or oversized files fail fast with actionable errors.
   *
   * @throws ValidationError — path outside allowed scope or file exceeds cap
   * @throws NotFound — when the owner does not exist
   */
  async add(input: AddAttachmentInput): Promise<AttachmentId> {
    await assertAttachmentPath(input.filePath, this.allowedPaths);
    await assertAttachmentSize(input.filePath, this.maxMb);
    return this.adapter.addAttachment(input);
  }

  /**
   * Remove an attachment by ID.
   *
   * @throws NotFound — when the owner or attachment does not exist
   */
  async remove(input: RemoveAttachmentInput): Promise<void> {
    return this.adapter.removeAttachment(input);
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
