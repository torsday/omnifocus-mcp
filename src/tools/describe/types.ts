/**
 * Shared types for *_describe preview tools.
 *
 * @see DESIGN.md §6.8 — describe-tool shape contract
 */

export interface ChangeRecord {
  field: string;
  newValue: string | null;
  oldValue?: string | null;
}
