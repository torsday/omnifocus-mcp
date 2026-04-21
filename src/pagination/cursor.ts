/**
 * Cursor codec for cursor-based pagination (DESIGN §15).
 *
 * Cursors are opaque to clients and base64url-encoded internally.
 * Each cursor encodes `{ lastId, lastCreatedAt, filterHash }`:
 *
 * - `lastId` — the OF persistent ID of the last item returned
 * - `lastCreatedAt` — ISO-8601 timestamp of that item (with offset)
 * - `filterHash` — SHA-256 (hex) of the serialized filter object; a mismatch
 *   means the client changed filters mid-page and gets a ValidationError
 *
 * Sort order: `createdAt ASC, id ASC` — stable under concurrent inserts.
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
  lastCreatedAt: string;
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

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).lastId !== "string" ||
    typeof (payload as Record<string, unknown>).lastCreatedAt !== "string" ||
    typeof (payload as Record<string, unknown>).filterHash !== "string"
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
 * Returns true if `item` should appear after the cursor in a
 * `(createdAt ASC, id ASC)` sort — i.e., the item is on the next page.
 */
export function isAfterCursor(
  item: { id: string; createdAt: string },
  cursor: CursorPayload,
): boolean {
  if (item.createdAt > cursor.lastCreatedAt) return true;
  if (item.createdAt === cursor.lastCreatedAt) return item.id > cursor.lastId;
  return false;
}
