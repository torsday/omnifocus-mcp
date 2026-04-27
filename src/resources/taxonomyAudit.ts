/**
 * `omnifocus://taxonomy-audit` MCP resource.
 *
 * Detects tag and project name collisions in the OmniFocus database — pairs
 * (or groups) of names that are likely duplicates or near-duplicates.
 *
 * URI: `omnifocus://taxonomy-audit` (static, no parameters)
 *
 * Payload shape:
 *   {
 *     tagCollisions: TagCollision[],
 *     projectCollisions: ProjectCollision[],
 *   }
 *
 * TagCollision:
 *   { candidates: { tagId, name, taskCount }[], reason: CollisionReason }
 *
 * ProjectCollision:
 *   { candidates: { projectId, name, folderId, taskCount }[], reason: CollisionReason }
 *
 * `reason` values (most-specific to least):
 *   "exact-duplicate" | "case-difference" | "plural-singular" | "near-duplicate"
 *
 * Empty sections return `[]` — never omitted.
 *
 * Use: an agent reads this resource to identify naming drift and propose
 * merges. The merges themselves are out of scope for this resource.
 *
 * @see src/domain/textSimilarity.ts — collision detection helpers
 * @see DESIGN.md §28 — MCP resources spec
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { CollisionReason } from "../domain/textSimilarity.js";
import { collisionReason } from "../domain/textSimilarity.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TAXONOMY_AUDIT_URI = "omnifocus://taxonomy-audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagCandidate {
  tagId: string;
  name: string;
  taskCount: number;
}

export interface TagCollision {
  candidates: TagCandidate[];
  reason: CollisionReason;
}

export interface ProjectCandidate {
  projectId: string;
  name: string;
  /** Folder ID the project belongs to, or null for top-level projects. */
  folderId: string | null;
  taskCount: number;
}

export interface ProjectCollision {
  candidates: ProjectCandidate[];
  reason: CollisionReason;
}

export interface TaxonomyAuditPayload {
  tagCollisions: TagCollision[];
  projectCollisions: ProjectCollision[];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Build the taxonomy-audit payload from adapter data.
 *
 * Exported separately so unit tests can call it directly with a mock adapter.
 *
 * Algorithm: O(n²) pairwise comparison — acceptable because the number of
 * tags/projects in a typical OF database is small (dozens to a few hundred).
 * Groups overlapping pairs into collision clusters: if A~B and B~C, all three
 * share a cluster. Uses a union-find (path-compression) approach.
 */
export async function buildTaxonomyAuditPayload(
  adapter: OmniFocusAdapter,
): Promise<TaxonomyAuditPayload> {
  const [tags, projects] = await Promise.all([adapter.listTags(), adapter.listProjects()]);

  const tagCollisions = detectTagCollisions(tags);
  const projectCollisions = detectProjectCollisions(projects);

  return { tagCollisions, projectCollisions };
}

// ---------------------------------------------------------------------------
// Tag collision detection
// ---------------------------------------------------------------------------

function detectTagCollisions(
  tags: Array<{ id: unknown; name: string; taskCount: number }>,
): TagCollision[] {
  // Build candidate list
  const candidates: TagCandidate[] = tags.map((t) => ({
    tagId: String(t.id),
    name: t.name,
    taskCount: t.taskCount,
  }));

  return findCollisionClusters(
    candidates,
    (a, b) => collisionReason(a.name, b.name),
    (cluster, reason) => ({ candidates: cluster, reason }),
  );
}

// ---------------------------------------------------------------------------
// Project collision detection
// ---------------------------------------------------------------------------

function detectProjectCollisions(
  projects: Array<{ id: unknown; name: string; folderId: unknown; taskCount: number }>,
): ProjectCollision[] {
  const candidates: ProjectCandidate[] = projects.map((p) => ({
    projectId: String(p.id),
    name: p.name,
    folderId: p.folderId !== null ? String(p.folderId) : null,
    taskCount: p.taskCount,
  }));

  return findCollisionClusters(
    candidates,
    (a, b) => collisionReason(a.name, b.name),
    (cluster, reason) => ({ candidates: cluster, reason }),
  );
}

// ---------------------------------------------------------------------------
// Generic cluster finder
// ---------------------------------------------------------------------------

/**
 * Find collision clusters across an array of items.
 *
 * Uses union-find to merge pairs into clusters. Each cluster that contains
 * ≥ 2 items becomes one collision entry. The reason assigned to a cluster
 * is the most-specific reason among all pairs in the cluster.
 */
function findCollisionClusters<T, C>(
  items: T[],
  reasonFn: (a: T, b: T) => CollisionReason | null,
  buildCollision: (cluster: T[], reason: CollisionReason) => C,
): C[] {
  if (items.length < 2) return [];

  // parent[i] = index of item i's cluster root
  const parent = items.map((_, i) => i);
  // Reason for the edge between two items (most specific in the cluster)
  const clusterReason = new Map<number, CollisionReason>();

  function find(i: number): number {
    while (parent[i] !== i) {
      // Path compression
      // biome-ignore lint/style/noNonNullAssertion: parent is same length as items
      parent[i] = parent[parent[i]!]!;
      // biome-ignore lint/style/noNonNullAssertion: same
      i = parent[i]!;
    }
    return i;
  }

  function union(i: number, j: number, reason: CollisionReason): void {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) {
      // Already in same cluster — update reason if more specific
      const existing = clusterReason.get(ri) ?? "near-duplicate";
      clusterReason.set(ri, moreSpecific(existing, reason));
      return;
    }
    // Merge rj into ri
    parent[rj] = ri;
    const existing = clusterReason.get(ri) ?? clusterReason.get(rj) ?? reason;
    clusterReason.set(ri, moreSpecific(existing, reason));
  }

  // Pairwise comparison
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      // biome-ignore lint/style/noNonNullAssertion: i and j are within bounds
      const reason = reasonFn(items[i]!, items[j]!);
      if (reason !== null) {
        union(i, j, reason);
      }
    }
  }

  // Group by cluster root
  const clusters = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const existing = clusters.get(root);
    if (existing) {
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      existing.push(items[i]!);
    } else {
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      clusters.set(root, [items[i]!]);
    }
  }

  // Emit only clusters with ≥ 2 members
  const result: C[] = [];
  for (const [root, members] of clusters) {
    if (members.length >= 2) {
      const reason = clusterReason.get(root) ?? "near-duplicate";
      result.push(buildCollision(members, reason));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reason specificity ordering
// ---------------------------------------------------------------------------

const REASON_RANK: Record<CollisionReason, number> = {
  "exact-duplicate": 0,
  "case-difference": 1,
  "plural-singular": 2,
  "near-duplicate": 3,
};

/** Return whichever reason is more specific (lower rank). */
function moreSpecific(a: CollisionReason, b: CollisionReason): CollisionReason {
  return REASON_RANK[a] <= REASON_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `omnifocus://taxonomy-audit` resource.
 *
 * Read this resource to discover naming drift in your OmniFocus database.
 * Returns tag and project name pairs that are likely duplicates. Use the
 * results to decide which names to consolidate before running a grooming
 * workflow.
 */
export function registerTaxonomyAuditResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-taxonomy-audit",
    TAXONOMY_AUDIT_URI,
    {
      description:
        "Taxonomy audit: detects tag and project name collisions (exact duplicates, " +
        "case differences, plural/singular variants, near-duplicates with Levenshtein ≤ 2 " +
        "or token-set equality). " +
        "Returns { tagCollisions: TagCollision[], projectCollisions: ProjectCollision[] }. " +
        "Each collision lists the candidate names and a reason. " +
        "Use to identify naming drift and plan merge operations. " +
        "Empty sections return [], never omitted.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const payload = await buildTaxonomyAuditPayload(adapter);
      return {
        contents: [
          {
            uri: TAXONOMY_AUDIT_URI,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
