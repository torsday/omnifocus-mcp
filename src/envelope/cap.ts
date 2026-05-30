/**
 * Wire-byte cap — the final stage of the response envelope pipeline
 * (`project → elide → truncate → cap`; see `src/envelope/CLAUDE.md`).
 *
 * Even after projection, default-elision, and note-truncation, a heavy read can
 * still return a surprising payload — e.g. `task_list` over a database with
 * thousands of tasks. `applyByteCap` lets a caller pre-commit to an upper bound
 * on the serialized size of the result array: items are appended until the next
 * one would push the wire size past the cap, then the response is finalized with
 * a continuation cursor so the caller resumes exactly where the page was cut.
 *
 * Because the cap runs last, it measures the *actual* post-transform wire size
 * of each item, not the pre-trim size (#776).
 *
 * Invariants:
 * - **Unset cap is a no-op.** `maxOutputBytes: undefined` ⇒ effective cap is
 *   `Infinity` ⇒ every item is returned and `truncatedAtCap` is false. Existing
 *   behavior is unchanged for callers that don't opt in.
 * - **Hard ceiling clamps the caller.** Even `maxOutputBytes: MAX_SAFE_INTEGER`
 *   is clamped to the server ceiling so a pathological input can't defeat the cap.
 * - **Forward progress is guaranteed.** At least one item is always returned, so
 *   a single item larger than the cap is emitted whole (with `truncatedAtCap`
 *   true and a cursor) rather than yielding an empty, non-advancing page.
 *
 * @see src/envelope/CLAUDE.md — pipeline composition order
 * @see docs/adr/0013-tool-response-envelope.md — response envelope contract
 */

// ---------------------------------------------------------------------------
// Hard ceiling
// ---------------------------------------------------------------------------

/** Absolute server-side ceiling on the effective cap, regardless of caller input. */
export const DEFAULT_HARD_CEILING_BYTES = 1024 * 1024; // 1 MiB

/**
 * Resolve the hard-ceiling override from a raw env string. Invalid, non-positive,
 * or absent values fall back to {@link DEFAULT_HARD_CEILING_BYTES}. Exported for
 * unit coverage of the parse rule.
 */
export function resolveHardCeilingBytes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HARD_CEILING_BYTES;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HARD_CEILING_BYTES;
}

/**
 * Env-resolved hard ceiling, read once at module load — matches the
 * `OMNIFOCUS_LEGACY_TEXT_CONTENT` precedent in `src/envelope/index.ts`. The env
 * var does not re-read between calls; tests override per-call via
 * {@link ByteCapOptions.hardCeilingBytes}.
 */
const HARD_CEILING_BYTES = resolveHardCeilingBytes(process.env.OMNIFOCUS_MAX_OUTPUT_BYTES_CEILING);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Outcome of {@link applyByteCap}. */
export interface ByteCapResult<T> {
  /** The retained prefix of the input array (the same array reference when not truncated). */
  items: T[];
  /** True when at least one item was dropped to satisfy the cap. */
  truncatedAtCap: boolean;
  /** Serialized byte size of the returned array (`[]` framing + items + commas). */
  bytesReturned: number;
  /** Number of items in {@link items}. */
  itemsReturned: number;
  /** Continuation cursor anchored at the last kept item; `null` when not truncated. */
  cursor: string | null;
}

/** Options for {@link applyByteCap}. */
export interface ByteCapOptions {
  /** Caller's requested cap in bytes; `undefined` ⇒ no cap (only framing measured). */
  maxOutputBytes?: number;
  /**
   * Build a continuation cursor anchored at the item at `lastKeptIndex`. Only
   * called when the response is actually truncated. The cursor must resume at
   * the first dropped item — i.e. it is anchored at `items[lastKeptIndex]`.
   */
  cursorFor: (lastKeptIndex: number) => string;
  /** Override the hard ceiling (testing). Defaults to the env-resolved ceiling. */
  hardCeilingBytes?: number;
}

/** Outcome of {@link applyByteCapById}. */
export interface ByteCapByIdResult<T> {
  /** The retained prefix of the input array (the same array reference when not truncated). */
  items: T[];
  /** True when at least one item was dropped to satisfy the cap. */
  truncatedAtCap: boolean;
  /** Serialized byte size of the returned array (`[]` framing + items + commas). */
  bytesReturned: number;
  /** Number of items in {@link items}. */
  itemsReturned: number;
  /** IDs of the items dropped to satisfy the cap, in input order; `[]` when not truncated. */
  droppedIds: string[];
}

/** Options for {@link applyByteCapById}. */
export interface ByteCapByIdOptions<T> {
  /** Caller's requested cap in bytes; `undefined` ⇒ no cap (only framing measured). */
  maxOutputBytes?: number;
  /** Extract the stable id of an item — used to report the dropped tail. */
  idOf: (item: T) => string;
  /** Override the hard ceiling (testing). Defaults to the env-resolved ceiling. */
  hardCeilingBytes?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Resolve the effective cap = min(caller request, hard ceiling); `undefined` ⇒ ∞. */
function resolveCap(
  maxOutputBytes: number | undefined,
  hardCeilingBytes: number | undefined,
): number {
  const ceiling = hardCeilingBytes ?? HARD_CEILING_BYTES;
  return maxOutputBytes === undefined
    ? Number.POSITIVE_INFINITY
    : Math.min(maxOutputBytes, ceiling);
}

/**
 * Count the longest prefix of `items` whose serialized array size stays within
 * `cap`. Shared by {@link applyByteCap} (cursor model) and
 * {@link applyByteCapById} (dropped-ids model) so both measure bytes identically.
 *
 * Array framing: `[` + `]` (2 bytes). Each item adds its JSON bytes plus a
 * leading comma for every item after the first. The first item is never dropped,
 * guaranteeing forward progress past a single oversized row.
 */
function countKeptPrefix<T>(items: readonly T[], cap: number): { kept: number; bytes: number } {
  let bytes = 2;
  let kept = 0;
  for (let i = 0; i < items.length; i++) {
    const itemBytes = Buffer.byteLength(JSON.stringify(items[i]) ?? "null", "utf8");
    const sep = i === 0 ? 0 : 1; // comma separator
    const next = bytes + sep + itemBytes;
    if (i > 0 && next > cap) break;
    bytes = next;
    kept = i + 1;
  }
  return { kept, bytes };
}

/**
 * Apply a wire-byte cap to a list-response array.
 *
 * @param items - the fully-transformed (projected/elided/truncated) wire items
 * @param opts - cap value, cursor builder, optional ceiling override
 * @returns the retained prefix plus the truncation signal, byte/item counts,
 *   and a re-anchored continuation cursor when truncation occurred
 */
export function applyByteCap<T>(items: readonly T[], opts: ByteCapOptions): ByteCapResult<T> {
  const cap = resolveCap(opts.maxOutputBytes, opts.hardCeilingBytes);
  const { kept, bytes } = countKeptPrefix(items, cap);
  const truncatedAtCap = kept < items.length;
  return {
    items: truncatedAtCap ? items.slice(0, kept) : (items as T[]),
    truncatedAtCap,
    bytesReturned: bytes,
    itemsReturned: kept,
    cursor: truncatedAtCap ? opts.cursorFor(kept - 1) : null,
  };
}

/**
 * Apply a wire-byte cap to a list-response array that has **no pagination
 * cursor** (bulk-by-id and other bounded reads, #1060). Identical byte
 * accounting to {@link applyByteCap}, but because there is no cursor to resume
 * from, the dropped tail is reported by id so the caller can re-request exactly
 * those items (e.g. with a larger cap or in a second batch).
 *
 * @param items - the fully-transformed wire items
 * @param opts - cap value, id extractor, optional ceiling override
 * @returns the retained prefix plus the truncation signal, byte/item counts,
 *   and the ids of the dropped tail when truncation occurred
 */
export function applyByteCapById<T>(
  items: readonly T[],
  opts: ByteCapByIdOptions<T>,
): ByteCapByIdResult<T> {
  const cap = resolveCap(opts.maxOutputBytes, opts.hardCeilingBytes);
  const { kept, bytes } = countKeptPrefix(items, cap);
  const truncatedAtCap = kept < items.length;
  return {
    items: truncatedAtCap ? items.slice(0, kept) : (items as T[]),
    truncatedAtCap,
    bytesReturned: bytes,
    itemsReturned: kept,
    droppedIds: truncatedAtCap ? items.slice(kept).map(opts.idOf) : [],
  };
}
