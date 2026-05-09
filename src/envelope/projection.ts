/**
 * Field-projection helper for read-tool responses (#773).
 *
 * Heavy read tools (`task_list`, `task_get*`, `project_list`, `tag_list`,
 * `search_query`, `forecast_get`, `perspective_evaluate`) accept an
 * optional `fields: string[]` parameter so callers can ask for only the
 * subset of record fields they need. Cuts per-call payload size by 30–70%
 * on bulk-triage workflows where the LLM only wants id + name + dueDate.
 *
 * Contract:
 * - When `fields` is omitted (`undefined`), the input is returned unchanged
 *   — backwards-compatible for every pre-#773 caller.
 * - When `fields` is present (even an empty array), only the listed fields
 *   plus `id` are kept. `id` is always retained so cross-tool references
 *   stay resolvable; that contract holds regardless of `fields`.
 * - Unknown field names are dropped silently; the caller is expected to
 *   surface them via {@link warnUnknownFields}. Robust to LLM misspellings.
 *
 * Top-level only — nested projection (e.g. `tags.name`) is out of scope
 * for this iteration. The whole nested value is included or excluded as a
 * unit. See #773 acceptance criteria.
 *
 * @see src/envelope/index.ts → warnUnknownFields
 */

/** Result of validating a caller-supplied fields[] against the allowed set. */
export interface ValidatedFields {
  /** Recognized field names (deduplicated, `id` removed since it's implicit). */
  valid: readonly string[];
  /** Unrecognized names — feed to `warnUnknownFields`. */
  unknown: readonly string[];
}

/**
 * Validate a caller-supplied fields[] against the set of allowed field
 * names for a record type. Returns `{ valid, unknown }`. `id` is stripped
 * from the valid set (it's always retained by `applyProjection`); listing
 * `id` explicitly is not an error.
 */
export function validateFields(
  requested: readonly string[],
  allowed: ReadonlySet<string>,
): ValidatedFields {
  const valid: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const f of requested) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (f === "id") continue;
    if (allowed.has(f)) valid.push(f);
    else unknown.push(f);
  }
  return { valid, unknown };
}

/**
 * Apply a top-level projection to a single record.
 *
 * - `fields === undefined`: returns the record unchanged (no projection).
 * - `fields` is present (any length, including empty): returns a new
 *   object containing only the requested fields plus `id`.
 *
 * The function is generic over `T` so the return type carries the input's
 * shape; callers writing tests can compare projected fields directly.
 */
export function applyProjection<T extends { id: unknown }>(
  record: T,
  fields: readonly string[] | undefined,
): T | Partial<T> {
  if (fields === undefined) return record;

  const out: Partial<T> = { id: record.id } as Partial<T>;
  for (const f of fields) {
    if (f === "id") continue;
    if (Object.hasOwn(record, f)) {
      (out as Record<string, unknown>)[f] = (record as Record<string, unknown>)[f];
    }
  }
  return out;
}

/**
 * Apply a projection to an array of records — convenience for list tools
 * that don't want to map each call site.
 */
export function applyProjectionMany<T extends { id: unknown }>(
  records: readonly T[],
  fields: readonly string[] | undefined,
): (T | Partial<T>)[] {
  if (fields === undefined) return [...records];
  return records.map((r) => applyProjection(r, fields));
}
