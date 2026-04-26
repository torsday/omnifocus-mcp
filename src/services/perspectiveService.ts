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
import {
  BUILTIN_PERSPECTIVE_IDS,
  type BuiltinPerspectiveId,
  type Perspective,
} from "../domain/perspective.js";
import type { Task } from "../domain/task.js";

function isBuiltin(id: string): id is BuiltinPerspectiveId {
  return (BUILTIN_PERSPECTIVE_IDS as readonly string[]).includes(id);
}

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
   * Evaluate a perspective and return its task list. Accepts a built-in id
   * (`"inbox"`, `"flagged"`, …) routed to JXA, or an opaque custom-perspective
   * id routed to OmniJS (#55). Selection is internal — the caller passes a
   * single `perspectiveId` and the service picks the transport.
   */
  async evaluate(perspectiveId: string): Promise<PerspectiveEvaluateResult> {
    const tasks = isBuiltin(perspectiveId)
      ? await this.adapter.evaluatePerspective(perspectiveId)
      : await this.adapter.evaluateCustomPerspective(perspectiveId);
    return { tasks, cacheHit: false };
  }
}
