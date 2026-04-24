/**
 * Zod schemas and TypeScript types for the Perspective domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Perspectives are either built-in (Inbox, Projects, Tags, Forecast,
 * Flagged, Nearby, Review) or custom (OmniJS + OmniFocus Pro).
 *
 * Note: `id` is a plain `string` (not a branded ID) because built-in
 * perspectives use stable well-known names as their IDs, not the opaque
 * UUID-style IDs that tasks/projects/tags carry.
 *
 * @see docs/domain-reference.md — canonical field definitions
 * @see DESIGN.md §13 — ID strategy
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Built-in perspective IDs (stable across OF installs)
// ---------------------------------------------------------------------------

export const BUILTIN_PERSPECTIVE_IDS = [
  "inbox",
  "projects",
  "tags",
  "forecast",
  "flagged",
  "nearby",
  "review",
] as const;

export type BuiltinPerspectiveId = (typeof BUILTIN_PERSPECTIVE_IDS)[number];

// ---------------------------------------------------------------------------
// Perspective
// ---------------------------------------------------------------------------

export interface Perspective {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  /** True for custom perspectives — require OmniFocus Pro */
  requiresPro: boolean;
  /** Emoji or named glyph; metadata only; null when unavailable */
  icon: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const PerspectiveSchema: z.ZodType<Perspective> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["builtin", "custom"]),
  requiresPro: z.boolean(),
  icon: z.string().nullable(),
}) as z.ZodType<Perspective>;
