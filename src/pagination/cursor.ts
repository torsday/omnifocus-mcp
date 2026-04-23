/**
 * Cursor codec for cursor-based pagination (DESIGN §15).
 *
 * Cursors are opaque to clients and base64url-encoded internally.
 * Each cursor encodes `{ lastId, lastSortValue, filterHash }`:
 *
 * - `lastId` — the OF persistent ID of the last item returned
 * - `lastSortValue` — the sort-field value of that item (null when the field
 *   is absent on the item, e.g. a task with no dueDate); null values sort last
 *   regardless of direction
 * - `filterHash` — SHA-256 (hex) of the serialized filter object; a mismatch
 *   means the client changed filters mid-page and gets a ValidationError
 *
 * Sort order is determined by the caller (default `createdAt ASC, id ASC`).
 *
 * @see DESIGN.md §15 — pagination strategy
 */

import { createHash } from "node:crypto";
import { ValidationError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CursorPayload {
  lastId: string;
  /** Sort-field value of the last emitted item; null when the field is absent on the item. */
  lastSortValue: string | null;
  filterHash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute a stable SHA-256 hex digest of an arbitrary filter object. */
export function hashFilter(filter: Record<string, unknown>): string {
  const stable = JSON.stringify(
    Object.fromEntries(
      Object.entries(filter)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  return createHash("sha256").update(stable).digest("hex");
}

/** Encode a cursor payload to a base64url string. */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a cursor string and validate it against the current filter.
 *
 * @throws ValidationError if the cursor is malformed or the filterHash does
 *   not match `currentFilterHash`.
 */
export function decodeCursor(cursor: string, currentFilterHash: string): CursorPayload {
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ValidationError("Cursor is not valid base64url.", {
      suggestion: "Pass the cursor value exactly as returned by the previous response.",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new ValidationError("Cursor payload is not valid JSON.", {
      suggestion: "Pass the cursor value exactly as returned by the previous response.",
    });
  }

  const p2 = payload as Record<string, unknown>;
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof p2.lastId !== "string" ||
    (p2.lastSortValue !== null && typeof p2.lastSortValue !== "string") ||
    typeof p2.filterHash !== "string"
  ) {
    throw new ValidationError("Cursor payload is missing required fields.", {
      suggestion: "Pass the cursor value exactly as returned by the previous response.",
    });
  }

  const p = payload as CursorPayload;

  if (p.filterHash !== currentFilterHash) {
    throw new ValidationError(
      "Cursor filter hash does not match the current query filters. Start a fresh query.",
      {
        suggestion:
          "Call the list tool without a cursor to begin a new page sequence with the updated filters.",
        details: { cursorFilterHash: p.filterHash, currentFilterHash },
      },
    );
  }

  return p;
}

// ---------------------------------------------------------------------------
// Sort predicate
// ---------------------------------------------------------------------------

/**
 * Returns true if `item` should appear after the cursor in a stable
 * `(sortValue, id)` sort — i.e., the item is on the next page.
 *
 * Null sort values sort **last** regardless of direction (nulls-last
 * semantics). When both are null the tie is broken by ID.
 *
 * @param item          The candidate item to test.
 * @param cursor        The decoded cursor from the previous page.
 * @param sortDirection "asc" (default) or "desc".
 */
export function isAfterCursor(
  item: { id: string; sortValue: string | null },
  cursor: CursorPayload,
  sortDirection: "asc" | "desc" = "asc",
): boolean {
  const iv = item.sortValue;
  const cv = cursor.lastSortValue;

  // Both null → tie-break on id (always ascending for stability)
  if (iv === null && cv === null) return item.id > cursor.lastId;

  // Null sorts last: a null item is only "after" a non-null cursor in ASC,
  // and always "after" nothing (non-null > null) in DESC.
  if (iv === null) return sortDirection === "asc"; // null comes after non-null in ASC
  if (cv === null) return sortDirection === "desc"; // non-null comes after null in DESC

  // Both non-null: compare normally
  if (iv !== cv) {
    return sortDirection === "asc" ? iv > cv : iv < cv;
  }
  // Equal values: tie-break on id
  return item.id > cursor.lastId;
}
