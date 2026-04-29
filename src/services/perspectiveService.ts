/**
 * `PerspectiveService` — service-layer surface for perspective queries.
 *
 * Wraps `OmniFocusAdapter` and exposes `list` for the MCP tool layer.
 *
 * Currently exposes read-only operations (list / get / evaluate). Custom-perspective
 * CRUD is feasible via JXA `make({new: "perspective"})` to create the shell plus
 * OmniJS `archivedFilterRules` / `archivedTopLevelFilterAggregation` to configure
 * it — see #523 for the proposed `perspective_create / update / delete` tools.
 *
 * @see docs/domain-reference.md — Perspective schema
 * @see src/tools/perspective/list.ts — MCP tool
 */

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import {
  BUILTIN_PERSPECTIVE_IDS,
  type BuiltinPerspectiveId,
  type Perspective,
  type PerspectiveDetail,
} from "../domain/perspective.js";
import type { Task } from "../domain/task.js";
import { ValidationError } from "../errors/index.js";

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

  /**
   * Evaluate a *proposed* rule tree without persisting a perspective (per
   * #659). Composes naturally with the `perspective-author` prompt's middle
   * step (#476): propose rules → preview → save via `createCustomPerspective`.
   *
   * The adapter creates a temp perspective with a sentinel name, evaluates
   * it, and always deletes it inside one OmniJS execution. No caching —
   * dry-runs are inherently transient.
   */
  async evaluateRules(
    rules: import("../domain/perspective.js").PerspectiveRule[],
    aggregation?: import("../domain/perspective.js").PerspectiveAggregation,
  ): Promise<PerspectiveEvaluateResult> {
    const tasks = await this.adapter.evaluatePerspectiveRules(rules, aggregation);
    return { tasks, cacheHit: false };
  }

  /**
   * Read full configuration of a custom perspective — name, top-level
   * aggregation, rule tree, and icon color. Built-in perspectives have no
   * rule tree and are rejected with `ValidationError` rather than reaching
   * the adapter (which would surface a less actionable `NotFound`).
   */
  async get(perspectiveId: string): Promise<PerspectiveDetail> {
    if (isBuiltin(perspectiveId)) {
      throw new ValidationError(
        `perspective_get only supports custom perspectives; got built-in id "${perspectiveId}"`,
        { details: { field: "perspectiveId", value: perspectiveId, kind: "builtin" } },
      );
    }
    return this.adapter.getCustomPerspective(perspectiveId);
  }

  /**
   * Delete a custom perspective by id. Built-in perspectives are rejected
   * with `ValidationError` — they cannot be deleted.
   */
  async delete(perspectiveId: string): Promise<void> {
    if (isBuiltin(perspectiveId)) {
      throw new ValidationError(
        `perspective_delete cannot delete built-in perspectives; got "${perspectiveId}"`,
        { details: { field: "perspectiveId", value: perspectiveId, kind: "builtin" } },
      );
    }
    await this.adapter.deleteCustomPerspective(perspectiveId);
  }
}
