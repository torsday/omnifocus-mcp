/**
 * Zod schemas and TypeScript types for the Task domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Dates are ISO-8601 with offset per ADR-0007; IDs are branded per ADR-0008.
 *
 * The explicit interfaces (Task, RepetitionRule) are the source of truth for
 * the TypeScript types; the zod schemas are annotated as `z.ZodType<T>` to
 * avoid TS4023 "cannot be named" errors caused by unique-symbol brands inside
 * deeply-inferred zod generics.
 *
 * @see docs/domain-reference.md — canonical field definitions
 * @see DESIGN.md §13 — ID strategy
 * @see DESIGN.md §14 — date handling
 */

import { z } from "zod";
import { type IsoDateString, isoDateString } from "./dates.js";
import {
  type ProjectId,
  ProjectId as ProjectIdCtor,
  type TagId,
  TagId as TagIdCtor,
  type TaskId,
  TaskId as TaskIdCtor,
} from "./ids.js";
import { type TaskLinks, taskLinksSchema } from "./links.js";

// ---------------------------------------------------------------------------
// RepetitionRule
// ---------------------------------------------------------------------------

export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type MonthlyAnchor =
  | { day: number }
  | { weekday: Weekday; position: 1 | 2 | 3 | 4 | "last" };

export interface RepetitionRule {
  method: "fixed" | "start-again" | "due-again";
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
  steps: number;
  weekdays?: Weekday[];
  monthlyAnchor?: MonthlyAnchor;
}

// ---------------------------------------------------------------------------
// TaskAlarm
// ---------------------------------------------------------------------------

/**
 * A single alarm/notification on a task. OmniFocus fires three kinds:
 *
 * - **`due-relative`** — fires `offsetSeconds` BEFORE the task's due date.
 *   Negative offsets fire AFTER the due date. Requires the task to have
 *   a `dueDate`; otherwise setting this kind raises `InvalidAlarmTarget`.
 * - **`defer-relative`** — same shape but anchored on `deferDate`.
 *   Requires the task to have a `deferDate`.
 * - **`absolute`** — fires at a fixed wall-clock instant `fireAt`
 *   (ISO-8601 with offset).
 *
 * The discriminated union makes the validation rule purely structural:
 * `offsetSeconds` is required iff `kind` is `*-relative`; `fireAt` is
 * required iff `kind === "absolute"`.
 *
 * @see #461
 */
export type TaskAlarm =
  | { kind: "due-relative"; offsetSeconds: number }
  | { kind: "defer-relative"; offsetSeconds: number }
  | { kind: "absolute"; fireAt: IsoDateString };

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface Task {
  id: TaskId;
  name: string;

  note: string | null;
  noteHtml: string | null;

  projectId: ProjectId | null;
  parentId: TaskId | null;
  tagIds: TagId[];

  deferDate: IsoDateString | null;
  /**
   * When true, the defer time follows the user across time zones rather than
   * being re-interpreted as a fixed UTC instant. Omitted from responses when
   * false to keep payloads lean. See DESIGN.md §14 — floating time zones.
   *
   * Note: the JXA transport always returns false (JXA exposes only a
   * document-level default, not per-task floating-TZ state).
   */
  deferDateFloating?: boolean;
  dueDate: IsoDateString | null;
  /** Same semantics as deferDateFloating but for the due date. */
  dueDateFloating?: boolean;
  estimatedMinutes: number | null;

  flagged: boolean;
  completed: boolean;
  completedAt: IsoDateString | null;
  dropped: boolean;
  droppedAt: IsoDateString | null;
  available: boolean;
  blocked: boolean;

  sequential: boolean;
  completedByChildren: boolean;

  repetition: RepetitionRule | null;

  /**
   * Alarms/notifications attached to this task. Omitted when the task has
   * no alarms (kept lean for the common case). The JXA transport surfaces
   * the live OmniFocus alarm list; the InMemoryAdapter tracks alarms set
   * via `setTaskAlarms` so test round-trips work without OmniFocus.
   *
   * @see TaskAlarm
   * @see src/tools/task/setAlarms.ts
   */
  notifications?: TaskAlarm[];

  createdAt: IsoDateString;
  modifiedAt: IsoDateString;

  _links?: TaskLinks;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const weekdaySchema = z.enum([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

const monthlyAnchorSchema = z.union([
  z.object({ day: z.number().int().min(1).max(31) }),
  z.object({
    weekday: weekdaySchema,
    position: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal("last")]),
  }),
]);

export const TaskAlarmSchema: z.ZodType<TaskAlarm> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("due-relative"), offsetSeconds: z.number().int() }),
  z.object({ kind: z.literal("defer-relative"), offsetSeconds: z.number().int() }),
  z.object({ kind: z.literal("absolute"), fireAt: isoDateString() }),
]);

export const RepetitionRuleSchema: z.ZodType<RepetitionRule> = z
  .object({
    method: z.enum(["fixed", "start-again", "due-again"]),
    unit: z.enum(["minutes", "hours", "days", "weeks", "months", "years"]),
    steps: z.number().int().min(1),
    weekdays: z.array(weekdaySchema).optional(),
    monthlyAnchor: monthlyAnchorSchema.optional(),
  })
  .refine((r) => r.weekdays === undefined || r.unit === "weeks", {
    message: "weekdays is only valid when unit is 'weeks'",
    path: ["weekdays"],
  })
  .refine((r) => r.monthlyAnchor === undefined || r.unit === "months", {
    message: "monthlyAnchor is only valid when unit is 'months'",
    path: ["monthlyAnchor"],
  })
  .refine((r) => !(r.weekdays !== undefined && r.monthlyAnchor !== undefined), {
    message: "Only one of weekdays or monthlyAnchor may be set",
  }) as z.ZodType<RepetitionRule>;

export const TaskSchema: z.ZodType<Task> = z.object({
  id: TaskIdCtor.schema,
  name: z.string(),

  note: z.string().nullable(),
  noteHtml: z.string().nullable(),

  projectId: ProjectIdCtor.schema.nullable(),
  parentId: TaskIdCtor.schema.nullable(),
  tagIds: z.array(TagIdCtor.schema),

  deferDate: isoDateString().nullable(),
  deferDateFloating: z.boolean().optional(),
  dueDate: isoDateString().nullable(),
  dueDateFloating: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(1).nullable(),

  flagged: z.boolean(),
  completed: z.boolean(),
  completedAt: isoDateString().nullable(),
  dropped: z.boolean(),
  droppedAt: isoDateString().nullable(),
  available: z.boolean(),
  blocked: z.boolean(),

  sequential: z.boolean(),
  completedByChildren: z.boolean(),

  repetition: RepetitionRuleSchema.nullable(),

  notifications: z.array(TaskAlarmSchema).optional(),

  createdAt: isoDateString(),
  modifiedAt: isoDateString(),

  _links: taskLinksSchema.optional(),
}) as z.ZodType<Task>;
