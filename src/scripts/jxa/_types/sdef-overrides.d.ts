// Hand-maintained overrides for sdef-snapshot drift.
//
// The OmniFocus JXA runtime exposes accessors that don't exist on the
// matching `<class>` in `vendor/OmniFocus.sdef` — typically because the
// runtime walks through a related object (e.g. `task.note.fileAttachments`
// is exposed as `task.fileAttachments` at the JXA-DOM level). The generator
// can't infer those conveniences from the sdef alone, so they're declared
// here via TypeScript's interface declaration merging.
//
// Joins the generated `interface Task { … }` (and friends) from
// `omnifocus.d.ts` at type-check time. Ambient (no `export`) so the
// merging happens in script-mode scope automatically.
//
// **Add an entry only when**:
//   - the accessor works at runtime (verified against the live OmniFocus
//     app or `src/adapter/jxa/sandbox/`), AND
//   - the sdef doesn't declare it on the same class.
//
// **Don't add** sdef-derived fields here — those stay generator-owned.
// If a field IS in the sdef but the generator missed it, the generator
// is wrong; fix `scripts/generate-jxa-types.ts` instead.
//
// JXA scripts opt in by adding this reference to the prologue (alongside
// `omnifocus.d.ts`, `jxa-globals.d.ts`, and `jxa-helpers.d.ts` as needed):
//
//   /// <reference path="_types/sdef-overrides.d.ts" />
//
// Only reference when the script actually consumes one of the overrides
// below — otherwise the addition is dead context.
//
// @see #999 — provenance for the file
// @see #994 — broader type-system gap inventory

// ---------------------------------------------------------------------------
// File-attachment accessors (#999)
//
// At runtime, `task.fileAttachments()` and `project.fileAttachments()` work
// directly even though the sdef attaches `<element type="file attachment"/>`
// only to `rich text`. The JXA-DOM exposes them as a convenience over
// `task.note.fileAttachments`. Used by `attachment_list.js`,
// `attachment_add.js`, `attachment_save_to_path.js`, `attachment_remove.js`.
// ---------------------------------------------------------------------------

// `fileAttachments` is both callable (`.fileAttachments()` evaluates to a
// snapshot — `attachment_list.js`) and property-accessible
// (`.fileAttachments.push(att)` mutates the live element collection —
// `attachment_add.js`). The intersection lets both forms typecheck; same
// pattern as `defaultDocument` in `jxa-globals.d.ts`.

interface Task {
  /** Runtime convenience over `note.fileAttachments` — see file header. */
  fileAttachments: JxaCollection<FileAttachment> & (() => JxaCollection<FileAttachment>);
}

interface Project {
  /** Runtime convenience over `note.fileAttachments` — see file header. */
  fileAttachments: JxaCollection<FileAttachment> & (() => JxaCollection<FileAttachment>);
}

// ---------------------------------------------------------------------------
// Attachment runtime extras (#999)
//
// The sdef's `<class name="attachment">` and `<class name="file attachment">`
// declare only `fileName()` and `embedded()`. At runtime, OF additionally
// exposes the standard JXA-object surface (`id`, `name`, `creationDate`) and
// a small set of attachment-specific accessors (`fileType`, `fileSize`,
// `linked`). The OF 4.x runtime is unreliable about these — `attachment_list.js`
// defensively try/catches each one — so the declarations are advisory:
// they let `// @ts-check` consumers compile, not assert availability.
// ---------------------------------------------------------------------------

interface Attachment {
  /** Object identifier. May throw on some Attachment subtypes — guard with try/catch. */
  id(): string;
  /** Display name. May throw — guard with try/catch. */
  name(): string;
  /** Creation date as a JS Date. May throw — guard with try/catch. */
  creationDate(): Date;
  /** MIME type. May throw — guard with try/catch. */
  fileType(): string | null;
  /** Size in bytes. May throw — guard with try/catch. */
  fileSize(): number | null;
  /** `true` when the attachment is an alias rather than embedded. May throw. */
  linked(): boolean;
}

interface FileAttachment {
  /**
   * The JXA Path object for the attachment's underlying file. Used by
   * `attachment_save_to_path.js` to source a binary-safe copy via
   * NSFileManager. The returned Path-like exposes `.toString()` →
   * POSIX path; typed conservatively as `{ toString(): string }` so
   * the only operation consumers can perform is the supported one.
   */
  file(): { toString(): string };
}

// ---------------------------------------------------------------------------
// Review-cycle runtime extras
//
// The sdef declares `<property name="review interval" type="repetition interval">`,
// emitted as `Project.reviewInterval(): RepetitionInterval`. At runtime OF
// also exposes `reviewIntervalDays()` as a scalar-day convenience — used by
// `review_list_due.js`.
// ---------------------------------------------------------------------------

interface Project {
  /** Review interval expressed as a scalar day count. Runtime convenience. */
  reviewIntervalDays(): number;
}

// ---------------------------------------------------------------------------
// Document-level commands
//
// The sdef declares `<command name="synchronize">` taking a document specifier
// as `<direct-parameter>`. The generator only emits `<class>` and `<property>`
// shapes (not standalone commands), so `doc.synchronize()` shows up as missing.
// Used by `sync_trigger.js`.
// ---------------------------------------------------------------------------

interface Document {
  /** Trigger OmniFocus sync with the configured server. Async — returns immediately. */
  synchronize(): void;
}

// ---------------------------------------------------------------------------
// Window accessors bubbled up from DocumentWindow
//
// The sdef puts `perspectiveName`, `focus`, and `perspective` on
// `DocumentWindow` (extends Window). Every OF front window is in practice a
// DocumentWindow, but `windows[0]()` / `frontWindow()` type-resolves to
// `Window`. Add the accessors to the parent `Window` interface so window-
// inspection scripts (`window_get_state`, `window_set_focus`,
// `window_set_perspective`) typecheck without per-script casts.
// ---------------------------------------------------------------------------

interface Window {
  /** Name of the active perspective. DocumentWindow accessor bubbled up. */
  perspectiveName(): string;
  /**
   * Project focus — both gettable (`w.focus()` returns the array of
   * container specifiers) and settable (`w.focus = [...]` replaces it; an
   * empty array clears the focus). Typed as `any` because the dual
   * property/method semantics plus mutability through assignment can't
   * be expressed as a clean intersection in strict mode. Compile-time
   * compromise; runtime semantics are documented in the sdef.
   */
  // biome-ignore lint/suspicious/noExplicitAny: see comment — dual property/method, mutable.
  focus: any;
  /**
   * Active perspective specifier — gettable (`w.perspective()`) and
   * settable (`w.perspective = target`). Same dual-shape constraint as
   * `focus`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: see comment — dual property/method, mutable.
  perspective: any;
}

// ---------------------------------------------------------------------------
// Sdef-property setter assignments — `@ts-expect-error` pattern
//
// Sdef `<property>` blocks emit as parameterless methods
// (`Project.status(): unknown`, `Tag.allowsNextAction(): boolean`). At
// runtime JXA accepts assignment too — `proj.status = "dropped"`,
// `tag.allowsNextAction = true`.
//
// Declaration merging *can't* paper over this: the generator-emitted
// method-typed member wins over a property-typed merge with the same
// name, so an `interface Project { status: any }` override here would
// be silently ignored. Consumers that need to assign use a per-call-site
// `// @ts-expect-error` line above the assignment instead — small,
// localized, and the comment documents the JXA semantics. Examples
// in `project_complete.js`, `project_drop.js`, `tag_update.js`. If we
// ever need to flip many scripts to setter assignment, a generator
// change (emit `status: unknown` for writable sdef properties) is the
// real fix.
//
// ---------------------------------------------------------------------------
// Application-level JXA write verbs
//
// Standard JXA commands (`markComplete`, `markReviewed`) live on the
// application surface at runtime — `ofApp.markComplete(specifier)`. The
// sdef declares them as standalone `<command>` blocks taking a direct
// parameter; the generator only emits class-attached methods.
// ---------------------------------------------------------------------------

interface Application {
  /** Mark a specifier (project/task) complete. JXA verb. */
  markComplete(item: unknown): void;
  /** Mark a specifier (project) reviewed — updates the review cycle. JXA verb. */
  markReviewed(item: unknown): void;
}

// ---------------------------------------------------------------------------
// Tag.status — runtime extra
//
// The sdef declares `<class name="tag">` without a `status` property —
// only Project has one. At runtime OF accepts `tag.status = "on hold"` to
// flip a tag's availability state. Used by `tag_update.js`. Property-form
// is fine here because there's no method-form conflict (sdef doesn't
// declare status on Tag), unlike the Project case above.
// ---------------------------------------------------------------------------

interface Tag {
  /** Tag availability status (`"active"` / `"on hold"`). Runtime extra. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous assignment values.
  status: any;
}
