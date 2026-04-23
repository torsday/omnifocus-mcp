/**
 * `PerspectiveService` — service-layer surface for perspective queries.
 *
 * Wraps `OmniFocusAdapter` and exposes `list` for the MCP tool layer.
 * Perspectives are read-only; mutations are not supported.
 *
 * @see docs/domain-reference.md — Perspective schema
 * @see src/tools/perspective/list.ts — MCP tool
 */

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { Perspective } from "../domain/perspective.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Result of {@link PerspectiveService.list}. */
export interface PerspectiveListResult {
  perspectives: Perspective[];
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PerspectiveService {
  private readonly adapter: OmniFocusAdapter;

  constructor(deps: { adapter: OmniFocusAdapter }) {
    this.adapter = deps.adapter;
  }

  /**
   * List all perspectives (built-in + custom).
   *
   * Built-in perspectives are always present. Custom perspectives require
   * OmniFocus Pro and are returned with `requiresPro: true`.
   */
  async list(): Promise<PerspectiveListResult> {
    const perspectives = await this.adapter.listPerspectives();
    return { perspectives, cacheHit: false };
  }
}
