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
import type { BuiltinPerspectiveId, Perspective } from "../domain/perspective.js";
import type { Task } from "../domain/task.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Result of {@link PerspectiveService.list}. */
export interface PerspectiveListResult {
  perspectives: Perspective[];
  cacheHit: boolean;
}

/** Result of {@link PerspectiveService.evaluate}. */
export interface PerspectiveEvaluateResult {
  tasks: Task[];
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

  /**
   * Evaluate a built-in perspective and return its task list.
   */
  async evaluate(perspectiveId: BuiltinPerspectiveId): Promise<PerspectiveEvaluateResult> {
    const tasks = await this.adapter.evaluatePerspective(perspectiveId);
    return { tasks, cacheHit: false };
  }
}
