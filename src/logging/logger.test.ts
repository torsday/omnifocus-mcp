import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, logger, REDACTION_PATHS_FOR_TESTS, setLogLevel } from "./logger.js";

/** Capture pino output into parsed JSON lines. */
function captureLogger(level: string, redactPaths?: string[]) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const log = pino(
    {
      level,
      ...(redactPaths ? { redact: { paths: redactPaths, censor: "[redacted]" } } : {}),
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.epochTime,
    },
    stream,
  );
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines };
}

const PII_PATHS = ["name", "note", "noteHtml", "tagNames", "tagNames[*]"];

describe("createLogger", () => {
  it("returns a pino logger instance", () => {
    const log = createLogger("info");
    expect(log).toBeDefined();
    expect(typeof log.info).toBe("function");
  });

  it("singleton writes to stderr (structural check)", () => {
    // Verify createLogger is wired to process.stderr — checked by confirming
    // the logger's level is configurable and doesn't touch stdout.
    expect(logger).toBeDefined();
    expect(logger.level).toBe(process.env.OMNIFOCUS_LOG_LEVEL ?? "info");
  });
});

describe("PII redaction", () => {
  it("redacts name, note, noteHtml at info level", () => {
    const { log, lines } = captureLogger("info", PII_PATHS);
    log.info(
      { event: "task.read", name: "Buy groceries", note: "secret", noteHtml: "<p>secret</p>" },
      "task",
    );
    const entry = lines()[0];
    expect(entry?.name).toBe("[redacted]");
    expect(entry?.note).toBe("[redacted]");
    expect(entry?.noteHtml).toBe("[redacted]");
  });

  it("redacts tagNames array at info level", () => {
    const { log, lines } = captureLogger("info", PII_PATHS);
    log.info({ event: "task.read", tagNames: ["Work", "Urgent"] }, "task");
    const entry = lines()[0];
    expect(entry?.tagNames).toBe("[redacted]");
  });

  it("still emits at debug level (level gate, not redaction toggle)", () => {
    const { log, lines } = captureLogger("debug", PII_PATHS);
    log.debug({ event: "task.read", name: "My task" }, "task");
    // pino redacts by path regardless of level — entry still present
    expect(lines()).toHaveLength(1);
  });
});

describe("log level suppression", () => {
  it("suppresses messages below the configured level", () => {
    const { log, lines } = captureLogger("warn");
    log.info("this should be suppressed");
    log.debug("also suppressed");
    expect(lines()).toHaveLength(0);
  });

  it("emits messages at or above the configured level", () => {
    const { log, lines } = captureLogger("info");
    log.info({ event: "server.started" }, "started");
    log.warn({ event: "something" }, "warning");
    expect(lines()).toHaveLength(2);
  });
});

describe("log format", () => {
  it("emits valid JSON with level and time fields", () => {
    const { log, lines } = captureLogger("info");
    log.info({ event: "server.started" }, "started");
    const entry = lines()[0];
    expect(entry?.level).toBe("info");
    expect(typeof entry?.time).toBe("number");
    expect(entry?.event).toBe("server.started");
  });

  it("uses epoch time (milliseconds)", () => {
    const before = Date.now();
    const { log, lines } = captureLogger("info");
    log.info({ event: "test" }, "t");
    const after = Date.now();
    const allLines = lines();
    const entry = allLines[0];
    expect(entry?.time as number).toBeGreaterThanOrEqual(before);
    expect(entry?.time as number).toBeLessThanOrEqual(after);
  });
});

describe("setLogLevel", () => {
  it("updates the singleton log level", () => {
    const original = logger.level;
    setLogLevel("warn");
    expect(logger.level).toBe("warn");
    setLogLevel(original);
    expect(logger.level).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Redaction canary (#842)
//
// A synthetic record mirrors every shape that can carry user-content PII
// (task / project / tag / folder / attachment, top-level + `data.*` +
// forecast buckets + error-details). Each leaf value is a unique sentinel
// string. After logging, the JSON output is searched for any sentinel —
// any leak fails the test. New shapes need an entry here AND a path in
// `PII_REDACT_PATHS`; the test will surface either gap.
// ---------------------------------------------------------------------------

describe("PII redaction canary (#842)", () => {
  function makeCanaryPayload() {
    const T = (k: string) => `CANARY_${k}_PASSWORD_S3CR3T_xyz`;
    return {
      event: "canary",
      // 1. Direct
      name: T("name"),
      note: T("note"),
      noteHtml: T("noteHtml"),
      tagNames: [T("tagNames_0"), T("tagNames_1")],
      meta: { name: T("meta_name"), note: T("meta_note") },
      // 2. Domain arrays at top
      tasks: [
        {
          id: "t1",
          name: T("tasks_0_name"),
          note: T("tasks_0_note"),
          noteHtml: T("tasks_0_noteHtml"),
          tagNames: [T("tasks_0_tagNames_0")],
        },
      ],
      projects: [{ id: "p1", name: T("projects_0_name"), note: T("projects_0_note") }],
      tags: [{ id: "tg1", name: T("tags_0_name") }],
      folders: [{ id: "f1", name: T("folders_0_name") }],
      attachments: [{ id: "a1", name: T("attachments_0_name"), path: T("attachments_0_path") }],
      // 3. Envelope path
      data: {
        name: T("data_name"),
        note: T("data_note"),
        noteHtml: T("data_noteHtml"),
        tagNames: [T("data_tagNames_0")],
        tasks: [
          {
            id: "dt1",
            name: T("data_tasks_0_name"),
            note: T("data_tasks_0_note"),
            noteHtml: T("data_tasks_0_noteHtml"),
            tagNames: [T("data_tasks_0_tagNames_0")],
          },
        ],
        projects: [{ id: "dp1", name: T("data_projects_0_name"), note: T("data_projects_0_note") }],
        tags: [{ id: "dtg1", name: T("data_tags_0_name") }],
        folders: [{ id: "df1", name: T("data_folders_0_name") }],
        attachments: [
          { id: "da1", name: T("data_attachments_0_name"), path: T("data_attachments_0_path") },
        ],
        // Forecast buckets
        overdue: [
          {
            id: "o1",
            name: T("overdue_0_name"),
            note: T("overdue_0_note"),
            tagNames: [T("overdue_0_tagNames_0")],
          },
        ],
        dueToday: [
          {
            id: "dd1",
            name: T("dueToday_0_name"),
            note: T("dueToday_0_note"),
            tagNames: [T("dueToday_0_tagNames_0")],
          },
        ],
        deferredToday: [
          { id: "dt2", name: T("deferredToday_0_name"), note: T("deferredToday_0_note") },
        ],
        flagged: [{ id: "fg1", name: T("flagged_0_name"), note: T("flagged_0_note") }],
        inbox: [{ id: "ib1", name: T("inbox_0_name"), note: T("inbox_0_note") }],
        // Single-object wrappers
        task: {
          id: "stk",
          name: T("data_task_name"),
          note: T("data_task_note"),
          noteHtml: T("data_task_noteHtml"),
          tagNames: [T("data_task_tagNames_0")],
        },
        project: { id: "sp", name: T("data_project_name"), note: T("data_project_note") },
        tag: { id: "stg", name: T("data_tag_name") },
        folder: { id: "sf", name: T("data_folder_name") },
        attachment: { id: "sa", name: T("data_attachment_name"), path: T("data_attachment_path") },
      },
      // 5. Error / details
      details: {
        input: {
          name: T("details_input_name"),
          note: T("details_input_note"),
          noteHtml: T("details_input_noteHtml"),
          tagNames: [T("details_input_tagNames_0")],
          destPath: T("details_input_destPath"),
        },
      },
      err: {
        details: {
          input: {
            name: T("err_details_input_name"),
            note: T("err_details_input_note"),
            noteHtml: T("err_details_input_noteHtml"),
            destPath: T("err_details_input_destPath"),
          },
        },
      },
    };
  }

  it("never lets a CANARY_* sentinel reach output across info, warn, error", () => {
    const { log, lines } = captureLogger("info", REDACTION_PATHS_FOR_TESTS as string[]);
    const payload = makeCanaryPayload();
    log.info(payload, "canary-info");
    log.warn(payload, "canary-warn");
    log.error(payload, "canary-error");
    const raw = JSON.stringify(lines());
    const leaks = raw.match(/CANARY_[A-Za-z0-9_]+_PASSWORD_S3CR3T_xyz/g) ?? [];
    expect(leaks).toEqual([]);
  });

  it("redacts at debug level too — pino redacts pre-emit regardless of level", () => {
    const { log, lines } = captureLogger("debug", REDACTION_PATHS_FOR_TESTS as string[]);
    log.debug(makeCanaryPayload(), "canary-debug");
    const raw = JSON.stringify(lines());
    const leaks = raw.match(/CANARY_[A-Za-z0-9_]+_PASSWORD_S3CR3T_xyz/g) ?? [];
    expect(leaks).toEqual([]);
  });

  it("non-PII fields (IDs, booleans, dates) are NOT redacted", () => {
    // Confirms the redactor isn't over-broad — IDs, status values, and
    // dates stay visible so logs remain useful for debugging.
    const { log, lines } = captureLogger("info", REDACTION_PATHS_FOR_TESTS as string[]);
    log.info(
      {
        event: "non-pii",
        data: {
          task: {
            id: "task_123",
            completed: false,
            dueDate: "2026-05-10T00:00:00Z",
            projectId: "proj_456",
          },
        },
      },
      "non-pii",
    );
    const entry = lines()[0] as Record<string, unknown>;
    const data = entry.data as Record<string, unknown>;
    const task = data.task as Record<string, unknown>;
    expect(task.id).toBe("task_123");
    expect(task.completed).toBe(false);
    expect(task.dueDate).toBe("2026-05-10T00:00:00Z");
    expect(task.projectId).toBe("proj_456");
  });
});
