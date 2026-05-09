/**
 * Default-valued field elision for read responses (#774, part of #770).
 *
 * Read responses serialize many fields at their default — `flagged: false`,
 * `completed: false`, `dropped: false`, `tagIds: []`, `note: null`, and so on.
 * Across a 200-item bulk read those defaults are pure noise: the LLM can infer
 * them from the documented schema and the omission convention in
 * `docs/domain-reference.md`. Eliding them cuts payload size with no
 * information loss.
 *
 * **Convention.** A field that is *absent* from a read response means the
 * default value applies. A field that is *present with `null`* means
 * "explicitly cleared" and is distinct from absent. Concretely:
 *
 *   { dueDate: null }   ← explicitly no due date (unusual; defaults to absent)
 *   { }                  ← dueDate absent → default applies (no due date set)
 *
 * For most response fields these two are semantically identical and we elide
 * `null` along
with the documented
defaults;
the;
{
  @link
  FieldDefaults;
}
map
 *
for each type records the
chosen;
convention;
per;
field.
 *
 * **Verbose
opt-out.** Every
read;
tool;
that;
applies;
elision;
must;
accept;
a * `verbose: true`;
input;
flag;
that;
returns;
the;
full;
unelided;
shape;
—
for
 * debugging and for callers who haven
't yet adopted the omission convention.
 *
 *
@see
#
770;
— token-efficiency epic
 *
@see
docs / domain - reference.md;
— canonical field definitions
 */

/**
 * Per-field default specification. The helper omits a key when its value
 * `===` the default *or* is one of the additional accepted "default-equivalent"
 * values listed in `equivalentTo`.
 *
 * Most fields use a single default value and don't need `equivalentTo`. Use it
 * for fields where the wire shape conflates absent/null/empty (e.g. `tagIds`
 * is logically empty whether `[]` or `null` reach the wire).
 */
export interface DefaultSpec {
  /** The canonical default value. Compared with strict `===` equality. */
  value: unknown;
  /**
   * Additional values that are also treated as "default" for elision purposes.
   * Use `Array.isArray` membership check; cells must be primitives or null.
   */
  equivalentTo?: readonly unknown[];
}

/** Map from field name to its default spec. */
export type FieldDefaults<T> = {
  readonly [K in keyof T]?: DefaultSpec;
};

/**
 * Return a shallow copy of `obj` with keys whose value matches the field's
 * default removed. Pure — does not mutate the input.
 *
 * Special-cased: empty arrays `[]` are treated as default-equivalent only when
 * the spec's `value` is `[]` (or any array — content is not deep-compared, by
 * design: defaults registry uses `[]` to mean "any empty array").
 *
 * Generic over `T` so callers preserve type information; the return type
 * reflects that any field may now be absent.
 */
export function elideDefaults<T extends object>(obj: T, defaults: FieldDefaults<T>): Partial<T> {
  const out = {} as Partial<T>;
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const spec = defaults[key];
    const value = obj[key];
    if (spec === undefined) {
      out[key] = value;
      continue;
    }
    if (isDefault(value, spec)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Apply {@link elideDefaults} to every element of an array. Returns a new
 * array; does not mutate.
 */
export function elideDefaultsAll<T extends object>(
  items: readonly T[],
  defaults: FieldDefaults<T>,
): Array<Partial<T>> {
  return items.map((item) => elideDefaults(item, defaults));
}

function isDefault(value: unknown, spec: DefaultSpec): boolean {
  if (value === spec.value) return true;
  // Empty-array shorthand: spec.value === [] matches any empty array on wire.
  if (Array.isArray(spec.value) && Array.isArray(value) && value.length === 0) {
    return true;
  }
  if (spec.equivalentTo !== undefined) {
    for (const eq of spec.equivalentTo) {
      if (value === eq) return true;
    }
  }
  return false;
}
