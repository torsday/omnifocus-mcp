/**
 * Density profiles for session-wide read-response shaping (#818).
 *
 * A client negotiates one `density` preference at the MCP `initialize`
 * handshake (see {@link file://../state/sessionState.ts}); that preference
 * then supplies the *default* value for the response-shaping flags every read
 * tool already accepts (`includeLinks`, `includeSubtasks`, `notePreviewChars`)
 * — so the client doesn't have to repeat those flags on every call. A
 * per-call argument always overrides the session default.
 *
 * Post-audit note (#791/#792/#796): the audited per-tool defaults are already
 * the lean shape, so `"default"` and `"compact"` coincide on these flags —
 * the operative new lever is `"full"`, which lets a client opt into rich
 * responses (HATEOAS links, inline subtasks, untruncated notes) session-wide
 * without enumerating flags. `noteHtml` and page `limit` are intentionally not
 * density-tunable: `noteHtml` has no read-path inclusion flag (it is always
 * elided from read envelopes and fetched via `note_get_html`), and the page
 * `limit` default is already 50 across `"default"`/`"compact"`. See
 * `docs/adr/0025-session-density-negotiation.md`.
 *
 * @see src/state/sessionState.ts — the singleton + resolvers
 * @see src/tools/task/notePreview.ts — DEFAULT_NOTE_PREVIEW_CHARS / NO_TRUNCATION
 */

/** The negotiable density preferences, in increasing verbosity. */
export const DENSITY_VALUES = ["compact", "default", "full"] as const;

/** A negotiated session density preference. */
export type Density = (typeof DENSITY_VALUES)[number];

/**
 * The default values a density profile supplies for the read-shaping flags.
 * Each is the value used when a tool call omits the corresponding argument.
 */
export interface ResolvedReadDefaults {
  /** Default for `includeLinks` — attach the `_links` HATEOAS block. */
  readonly includeLinks: boolean;
  /** Default for `includeSubtasks` — inline subtask records vs. ids-only. */
  readonly includeSubtasks: boolean;
  /**
   * Default for `notePreviewChars` — the note-preview window. `200` mirrors
   * `DEFAULT_NOTE_PREVIEW_CHARS`; `-1` is `NO_TRUNCATION` (full note body).
   * A drift guard in the unit test asserts the `200` stays in lockstep with
   * `DEFAULT_NOTE_PREVIEW_CHARS`.
   */
  readonly notePreviewChars: number;
}

/** Note-preview window for the lean profiles — mirrors DEFAULT_NOTE_PREVIEW_CHARS. */
const LEAN_NOTE_PREVIEW_CHARS = 200;
/** Sentinel for "no truncation" — mirrors NO_TRUNCATION in notePreview.ts. */
const FULL_NOTE_PREVIEW_CHARS = -1;

/**
 * Resolved read-defaults per density profile.
 *
 * `compact` deliberately equals `default`: the token-efficiency audit already
 * made the lean shape the baseline, so there is no leaner-than-default tier to
 * express here without changing audited contracts. `full` is the inverse — the
 * pre-audit generous shape, opted into once.
 */
export const READ_DEFAULTS: Record<Density, ResolvedReadDefaults> = {
  compact: {
    includeLinks: false,
    includeSubtasks: false,
    notePreviewChars: LEAN_NOTE_PREVIEW_CHARS,
  },
  default: {
    includeLinks: false,
    includeSubtasks: false,
    notePreviewChars: LEAN_NOTE_PREVIEW_CHARS,
  },
  full: {
    includeLinks: true,
    includeSubtasks: true,
    notePreviewChars: FULL_NOTE_PREVIEW_CHARS,
  },
};
