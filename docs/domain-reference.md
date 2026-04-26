# OmniFocus Domain Reference

The canonical vocabulary and schemas this MCP uses. Kept alongside `DESIGN.md` because agents — and humans reading tool descriptions — need unambiguous meanings for overloaded words like "drop," "defer," "flag," "review," and "group."

---

## Glossary

Use these terms precisely in tool descriptions, error messages, and docs.

| Term                       | Definition                                                                                                               | OF-specific nuance                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Task**                   | A single to-do item. Has a name, optional note, dates, tags, parent, and (if an action group) subtasks.                  | Includes inbox tasks and project action items.                                                |
| **Inbox task**             | A task not yet assigned to a project or folder.                                                                          | Becomes a project or child when moved.                                                        |
| **Project**                | A container of tasks with a completion criterion (`parallel`, `sequential`, or `single action list`).                    | A project is itself a kind of task internally in OF; we treat it as a distinct resource.     |
| **Action group**           | A task with subtasks. Sequential/parallel flag controls availability.                                                    | Not a separate type in OF; it's a task with children.                                         |
| **Folder**                 | A container for projects and other folders. No tasks directly.                                                           | Pure hierarchy; carries no completion state.                                                  |
| **Tag**                    | A label attached to tasks. Tags are hierarchical and have status (`active`, `on-hold`, `dropped`).                        | Called "Context" in OF 1. Tags can have locations.                                            |
| **Perspective**            | A saved view configuration. Built-in (Inbox, Projects, Tags, Forecast, Flagged, Nearby, Review) or custom (Pro only).     | Custom perspectives are OmniJS-only.                                                          |
| **Forecast**               | The built-in calendar-like view showing overdue, today, upcoming, and flagged tasks.                                     | Accepts a date range and optional "Forecast tag" (Pro).                                       |
| **Review**                 | The Project Review feature: each project has `reviewInterval` and `nextReview`. "Review" means marking them as reviewed. | Distinct from PR-style code review; OF-specific.                                              |
| **Defer date**             | The date before which a task is _not_ available.                                                                         | Aka "start date" in other GTD tools.                                                          |
| **Due date**               | The deadline. Color-changes to orange/red as it approaches/passes.                                                        | Not the same as defer date.                                                                   |
| **Available**              | A task that has no incomplete predecessors, no future defer date, and is not blocked.                                     | `task_list({ available: true })` is a common daily-review filter.                             |
| **Blocked**                | A task in a sequential parent with an earlier incomplete sibling.                                                         | Derived property; not directly stored.                                                        |
| **Flagged**                | A boolean flag (star icon) marking a task as important.                                                                   | Orthogonal to priority; there is no numeric priority in OF.                                   |
| **Dropped**                | A task or project explicitly abandoned (still in DB, but not actionable).                                                | Distinct from **completed** (done) and **deleted** (gone). We surface both `drop` and `delete`. |
| **Completed**              | A task or project marked done. Timestamp recorded.                                                                        | A completed recurring task spawns the next occurrence if it has a repetition rule.            |
| **Repetition rule**        | The schedule that recurring tasks follow.                                                                                 | See the Repetition schema below.                                                              |
| **Estimated duration**     | The number of minutes a task is expected to take.                                                                         | Integer minutes.                                                                              |
| **Transport text**         | OF's shorthand DSL for creating tasks: `Project: Task @tag //note ::defer !! #due`.                                        | Parseable via `task_parse_transport_text`.                                                    |
| **Attachment**             | A file associated with a task or project.                                                                                 | Can be embedded (bytes in DB) or a link (alias to a filesystem path). We expose both, manipulate via path only. |
| **Sync**                   | The process of reconciling the local OF database with Omni Sync Server (or other backend).                                | We can trigger sync but don't manage its config.                                              |
| **Script**                 | A JXA or OmniJS file under `src/scripts/{jxa,omnijs}/` that performs one operation against OF.                            | See ADR-0005.                                                                                 |
| **Transport (MCP)**        | How the MCP server talks to its client. We ship stdio (see ADR-0010).                                                     | Not to be confused with "transport text."                                                     |
| **Transport (OF)**         | The layer that talks from Node to OmniFocus — JXA or OmniJS. See ADR-0002.                                                 |                                                                                               |

### Word-collision warnings for tool descriptions

| Risk                            | Rule                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Drop" vs "delete"              | `drop` = OF's drop action (status change, recoverable). `delete` = `deleteObject` (gone, not recoverable). |
| "Complete" vs "close"           | Use **complete** for the OF action. Avoid "close"; it's overloaded.                                    |
| "Review" vs "review (code PR)"  | In OF domain, review = project review. In tool descriptions, say "project review" on first use.        |
| "Tag" vs "label"                | Always "tag." OF has never had "labels."                                                               |
| "Priority" vs "flagged"         | OF has no priorities. `flagged` is the only first-class importance marker.                             |
| "Start date" vs "defer date"    | Always **defer date**. Some users say "start"; our API says "defer."                                   |
| "Folder" vs "group"             | Always **folder** for the hierarchical container. "Group" is ambiguous (action group ≠ folder).        |

---

## Canonical schemas

Authoritative shapes. The TypeScript types in `src/domain/` must match these exactly. Changes require a PR and (for public fields) semver consideration.

### `Task`

```typescript
interface Task {
  id: TaskId;
  name: string;

  // Optional content
  note: string | null;            // plain text (normalized from rich)
  noteHtml: string | null;        // rich text as HTML fragment (round-trippable)

  // Relationships
  projectId: ProjectId | null;    // null if inbox task
  parentId: TaskId | null;        // null if top-level in its container
  tagIds: TagId[];                // 0..n

  // Scheduling
  deferDate: string | null;       // ISO-8601 with offset
  dueDate: string | null;         // ISO-8601 with offset
  estimatedMinutes: number | null;

  // State
  flagged: boolean;
  completed: boolean;
  completedAt: string | null;     // ISO-8601 with offset; null if not completed
  dropped: boolean;
  droppedAt: string | null;
  available: boolean;             // derived; present on read, ignored on write
  blocked: boolean;               // derived; present on read, ignored on write

  // Action-group behavior
  sequential: boolean;            // true if subtasks must complete in order
  completedByChildren: boolean;   // true if completing all children auto-completes this

  // Repetition
  repetition: RepetitionRule | null;

  // Metadata
  createdAt: string;              // ISO-8601 with offset
  modifiedAt: string;             // ISO-8601 with offset
}
```

### `Project`

```typescript
interface Project {
  id: ProjectId;
  name: string;
  note: string | null;
  noteHtml: string | null;

  folderId: FolderId | null;      // null if at root

  // A project in OmniFocus is internally a root-level task, so it CAN carry
  // tags. We surface this uniformly with tasks. Note: some OF UIs hide tag
  // editing on projects; the underlying model supports it. Adapter confirms
  // the JXA / OmniJS API actually returns tags for projects in the M0 spike.
  tagIds: TagId[];

  status: "active" | "on-hold" | "done" | "dropped";
  completionCriterion: "parallel" | "sequential" | "singleActions";
  // OF's internal enum uses camelCase "singleActions"; we keep that verbatim.

  deferDate: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  flagged: boolean;

  // Review
  reviewIntervalDays: number | null;       // e.g. 7 for weekly review
  nextReviewDate: string | null;
  lastReviewDate: string | null;

  // Completion
  completed: boolean;
  completedAt: string | null;
  dropped: boolean;
  droppedAt: string | null;

  // Stats (derived; present on read only)
  taskCount: number;
  completedTaskCount: number;

  createdAt: string;
  modifiedAt: string;
}
```

### `Tag`

```typescript
interface Tag {
  id: TagId;
  name: string;
  parentId: TagId | null;        // null if root-level

  status: "active" | "on-hold" | "dropped";

  location: TagLocation | null;  // optional geolocation
  allowsNextAction: boolean;     // if false, tagged tasks never "next up"
  // OF's JXA and OmniJS APIs name this differently (JXA: allowsNextAction;
  // OmniJS historically: active). Adapter normalizes both to this field.
  // Verify in M0 spike.

  taskCount: number;             // derived; read only

  createdAt: string;
  modifiedAt: string;
}

interface TagLocation {
  name: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  trigger: "entering" | "leaving" | "both";
}
```

### `Folder`

```typescript
interface Folder {
  id: FolderId;
  name: string;
  parentId: FolderId | null;
  projectCount: number;           // derived
  subfolderCount: number;         // derived
  createdAt: string;
  modifiedAt: string;
}
```

### `Perspective`

```typescript
interface Perspective {
  id: string;                     // opaque (built-ins have known names; custom have OF IDs)
  name: string;
  kind: "builtin" | "custom";
  requiresPro: boolean;           // true for custom perspectives
  icon: string | null;            // emoji or named glyph; metadata only
}
```

**Error routing for perspectives:**

- Evaluating a custom perspective on a non-Pro OF install returns `FeatureRequiresPro`, not `NotFound`. The perspective may exist in the database but is unusable without Pro.
- Evaluating a perspective by an unknown ID returns `NotFound`.
- The perspective list (`perspective_list`) always includes custom perspectives regardless of Pro status, with `requiresPro: true` surfaced so the agent can pre-filter.

### Forecast settings

OmniFocus has a "Forecast tag" (Pro feature) — tasks with this tag appear in the Forecast view regardless of dates. We surface this via settings-shaped tools rather than rolling it into `forecast_get` arguments:

```typescript
interface ForecastSettings {
  forecastTagId: TagId | null;    // null if not set or not Pro
  includesDeferred: boolean;      // user preference in OF
  includesCompleted: boolean;
}
```

Exposed via `settings_get_forecast` and `settings_set_forecast_tag` (Milestone 4, deferred with the rest of the settings surface; not in the M1 core).

### `RepetitionRule`

The most intricate sub-schema. Full round-trip fidelity with OF.

```typescript
interface RepetitionRule {
  method: "fixed" | "start-again" | "due-again";
  //   fixed: next occurrence based on original schedule, regardless of completion date
  //   start-again: next defer date = completion date + interval
  //   due-again: next due date = completion date + interval

  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
  steps: number;                  // positive integer; e.g. 2 weeks = unit "weeks", steps 2

  // Constraints — only valid with unit "weeks":
  weekdays?: Array<
    "sunday" | "monday" | "tuesday" | "wednesday"
    | "thursday" | "friday" | "saturday"
  >;

  // Constraint — only valid with unit "months":
  monthlyAnchor?: {
    day: number;                  // 1..31; 31 interpreted as "last day of month"
  } | {
    weekday: "sunday" | "monday" | "tuesday" | "wednesday"
           | "thursday" | "friday" | "saturday";
    position: 1 | 2 | 3 | 4 | "last";
  };
}
```

Validation rules (enforced in zod, mirrored in docs):

- `steps` must be ≥ 1
- `weekdays` only allowed when `unit === "weeks"`
- `monthlyAnchor` only allowed when `unit === "months"`
- At most one of `weekdays` / `monthlyAnchor` set
- `unit === "minutes"` with `steps < 5` is accepted but surfaces a warning. Warnings flow through `meta.warnings` in the response envelope (not a separate log-only signal) so the agent can see them inline. Schema-level warnings are emitted by zod refinements and collected by the handler before invoking the service.

**Method-name mapping:** the values `"fixed"`, `"start-again"`, `"due-again"` are our on-the-wire contract. OF's JXA property names are slightly different (`fixed`, `start-after-completion`, `due-after-completion` in the scripting dictionary). The adapter normalizes both directions. Verified in M0 spike.

### TaskPaper / OPML lossiness matrix

Export/import is **lossy**. Fields TaskPaper does not represent are dropped on export and default on import. This table fixes expectations:

| Field                 | TaskPaper | OPML  |
| --------------------- | --------- | ----- |
| name                  | ✓         | ✓     |
| note (plain)          | ✓         | ✓     |
| noteHtml              | ✗         | ✗     |
| defer/due dates       | ✓ (via `@defer` / `@due` tags) | ✗ (unless we extend) |
| flagged               | ✓ (`@flagged`) | ✗ |
| tags                  | ✓ (`@tag`)      | ✗ |
| estimated minutes     | ✓ (`@estimate`) | ✗ |
| repetition rule       | partial (`@repeat` with limited syntax) | ✗ |
| attachments           | ✗         | ✗     |
| task IDs              | ✗ (new IDs on import) | ✗ |
| subtasks              | ✓ (indentation) | ✓ |
| completion state      | ✓ (`@done`) | ✗ |
| dropped state         | ✗         | ✗     |

On import, the server returns the count of successfully created items plus any per-line warnings via `meta.warnings`.

### `Attachment`

```typescript
interface Attachment {
  id: AttachmentId;
  name: string;                    // filename as shown in OF
  mimeType: string | null;
  sizeBytes: number | null;        // null if unknown (e.g. alias to missing file)
  addedAt: string;                 // ISO-8601 with offset
  kind: "embedded" | "alias";     // how OF stores it
}
```

Attachment **content** is never returned over MCP. Use `attachment_save_to_path` to extract.

### `SyncStatus`

```typescript
interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  lastSyncError: string | null;   // OF's error message if last sync failed
  inProgress: boolean;
}
```

---

## Wire-format examples

Concrete JSON samples, for reference in tool descriptions and tests.

### Creating a task

Request (`task_create`):

```json
{
  "projectId": "pAbCdEfGhIj",
  "name": "Review Q2 budget draft",
  "note": "Focus on cloud line items.",
  "dueDate": "2026-05-01T17:00:00-05:00",
  "deferDate": "2026-04-28T09:00:00-05:00",
  "flagged": true,
  "tagIds": ["tWorK"],
  "estimatedMinutes": 45
}
```

Response:

```json
{
  "data": {
    "id": "tNeWtAsKiD",
    "name": "Review Q2 budget draft",
    "projectId": "pAbCdEfGhIj",
    "note": "Focus on cloud line items.",
    "noteHtml": null,
    "parentId": null,
    "tagIds": ["tWorK"],
    "deferDate": "2026-04-28T09:00:00-05:00",
    "dueDate": "2026-05-01T17:00:00-05:00",
    "estimatedMinutes": 45,
    "flagged": true,
    "completed": false,
    "completedAt": null,
    "dropped": false,
    "droppedAt": null,
    "available": false,
    "blocked": false,
    "sequential": false,
    "completedByChildren": false,
    "repetition": null,
    "createdAt": "2026-04-19T15:23:04-05:00",
    "modifiedAt": "2026-04-19T15:23:04-05:00"
  },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 287,
    "cacheHit": false,
    "transport": "jxa",
    "ofVersion": "4.5.2"
  }
}
```

### A paginated list

Request (`task_list`):

```json
{
  "available": true,
  "limit": 50
}
```

Response:

```json
{
  "data": {
    "tasks": [ /* 50 task objects */ ]
  },
  "pagination": {
    "cursor": "eyJsYXN0SWQiOiJ0WFhZWVpaWkFBIiwibGFzdENyZWF0ZWRBdCI6IjIwMjYtMDQtMTdUMTQ6MDE6MDAtMDU6MDAifQ",
    "hasMore": true,
    "total": 237
  },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 412,
    "cacheHit": false,
    "transport": "jxa",
    "ofVersion": "4.5.2"
  }
}
```

### A typed error

Response (missing project):

```json
{
  "error": {
    "code": "OF_NOT_FOUND",
    "message": "Project not found",
    "suggestion": "Confirm the ID with project_list. Use the persistent ID, not the project name.",
    "details": { "resource": "project", "id": "pDoEsNoTeXiSt" }
  },
  "meta": {
    "correlationId": "01JBZK7PDR6XSYVMWT5YYVH8VQ",
    "durationMs": 18
  }
}
```
