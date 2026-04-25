import { describe, expect, expectTypeOf, it } from "vitest";
import { NotFound, OmniFocusError, ValidationError } from "../errors/index.js";
import {
  err,
  isError,
  isSuccess,
  ok,
  type Pagination,
  type ResponseMeta,
  type ToolEnvelope,
  type ToolError,
  type ToolSuccess,
  type Warning,
  warnDeprecatedField,
  warnDryRun,
  warnIdsNotFound,
  warnResultTruncated,
  warnSyncPending,
} from "./index.js";

const baseMeta: ResponseMeta = {
  correlationId: "01JBZK7PDR6XSYVMWT5YYVH8VQ",
  durationMs: 142,
  cacheHit: false,
  transport: "jxa",
  ofVersion: "4.5.2",
};

describe("ok()", () => {
  it("we wrap data in the standard success envelope", () => {
    const envelope = ok({ tasks: [{ id: "tA", name: "Write" }] }, baseMeta);
    expect(envelope.data).toEqual({ tasks: [{ id: "tA", name: "Write" }] });
    expect(envelope.meta).toBe(baseMeta);
    expect(envelope.pagination).toBeUndefined();
  });

  it("we include pagination when caller provides it", () => {
    const pagination: Pagination = { cursor: "abc", hasMore: true, total: 237 };
    const envelope = ok({ tasks: [] }, baseMeta, pagination);
    expect(envelope.pagination).toBe(pagination);
  });

  it("we omit pagination when not provided — envelope stays minimal", () => {
    const envelope = ok({ id: "p1" }, baseMeta);
    expect("pagination" in envelope).toBe(false);
  });

  it("we propagate meta.warnings (Warning[]) into the envelope verbatim", () => {
    const warning: Warning = warnSyncPending();
    const metaWithWarnings: ResponseMeta = { ...baseMeta, warnings: [warning] };
    const envelope = ok({ done: true }, metaWithWarnings);
    expect(envelope.meta.warnings).toHaveLength(1);
    expect(envelope.meta.warnings?.[0]?.code).toBe("WARN_SYNC_PENDING");
  });
});

describe("err()", () => {
  it("we serialize the OmniFocusError via toJSON into the error envelope", () => {
    const error = new NotFound("Project not found", {
      details: { resource: "project", id: "pMissing" },
    });
    const envelope = err(error, baseMeta);

    expect(envelope.error.code).toBe("OF_NOT_FOUND");
    expect(envelope.error.name).toBe("NotFound");
    expect(envelope.error.message).toBe("Project not found");
    expect(envelope.error.details).toEqual({ resource: "project", id: "pMissing" });
    expect(envelope.meta).toBe(baseMeta);
  });

  it("we preserve the default suggestion from the class", () => {
    const envelope = err(new ValidationError("Bad input"), baseMeta);
    expect(envelope.error.suggestion).toContain("Fix the input");
  });

  it("we accept the base OmniFocusError class, not just subclasses", () => {
    const generic = new OmniFocusError("OF_SCRIPT_ERROR", "raw");
    const envelope = err(generic, baseMeta);
    expect(envelope.error.code).toBe("OF_SCRIPT_ERROR");
    expect(envelope.error.name).toBe("OmniFocusError");
    // No suggestion when the base class is used directly.
    expect(envelope.error.suggestion).toBeUndefined();
  });
});

describe("envelope shape — snapshot locks", () => {
  it("success snapshot matches the ADR-0013 contract", () => {
    const envelope = ok(
      { tasks: [{ id: "t1", name: "example" }] },
      {
        correlationId: "01JBZK_SUCCESS",
        durationMs: 87,
        cacheHit: true,
        transport: "cache",
        ofVersion: "4.5.2",
      },
      { cursor: null, hasMore: false, total: 1 },
    );
    expect(envelope).toMatchInlineSnapshot(`
      {
        "data": {
          "tasks": [
            {
              "id": "t1",
              "name": "example",
            },
          ],
        },
        "meta": {
          "cacheHit": true,
          "correlationId": "01JBZK_SUCCESS",
          "durationMs": 87,
          "ofVersion": "4.5.2",
          "transport": "cache",
        },
        "pagination": {
          "cursor": null,
          "hasMore": false,
          "total": 1,
        },
      }
    `);
  });

  it("error snapshot matches the ADR-0013 contract", () => {
    const envelope = err(
      new NotFound("Task not found", { details: { resource: "task", id: "tXYZ" } }),
      {
        correlationId: "01JBZK_ERROR",
        durationMs: 12,
        cacheHit: false,
        transport: "jxa",
        ofVersion: "4.5.2",
      },
    );
    expect(envelope).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "OF_NOT_FOUND",
          "details": {
            "id": "tXYZ",
            "resource": "task",
          },
          "message": "Task not found",
          "name": "NotFound",
          "remediationClass": "input",
          "suggestion": "Confirm the ID with the corresponding \`*_list\` tool. Use OmniFocus persistent IDs, not names.",
        },
        "meta": {
          "cacheHit": false,
          "correlationId": "01JBZK_ERROR",
          "durationMs": 12,
          "ofVersion": "4.5.2",
          "transport": "jxa",
        },
      }
    `);
  });
});

describe("isSuccess / isError type guards", () => {
  it("we narrow a ToolEnvelope to ToolSuccess inside isSuccess", () => {
    const envelope: ToolEnvelope<{ n: number }> = ok({ n: 1 }, baseMeta);
    expect(isSuccess(envelope)).toBe(true);
    expect(isError(envelope)).toBe(false);
    if (isSuccess(envelope)) {
      // Compile-time narrowing — data is accessible without error guard.
      expect(envelope.data.n).toBe(1);
    }
  });

  it("we narrow a ToolEnvelope to ToolError inside isError", () => {
    const envelope: ToolEnvelope<{ n: number }> = err(new ValidationError("bad"), baseMeta);
    expect(isError(envelope)).toBe(true);
    expect(isSuccess(envelope)).toBe(false);
    if (isError(envelope)) {
      expect(envelope.error.code).toBe("OF_VALIDATION");
    }
  });
});

describe("Warning builders", () => {
  it("warnIdsNotFound includes missing IDs in details", () => {
    const w = warnIdsNotFound(["id1", "id2"]);
    expect(w.code).toBe("WARN_IDS_NOT_FOUND");
    expect(w.details?.missing).toEqual(["id1", "id2"]);
    expect(w.suggestion).toBeDefined();
  });

  it("warnResultTruncated includes limit in details", () => {
    const w = warnResultTruncated(500);
    expect(w.code).toBe("WARN_RESULT_TRUNCATED");
    expect(w.details?.limit).toBe(500);
    expect(w.suggestion).toBeDefined();
  });

  it("warnSyncPending has no details", () => {
    const w = warnSyncPending();
    expect(w.code).toBe("WARN_SYNC_PENDING");
    expect(w.details).toBeUndefined();
    expect(w.suggestion).toBeDefined();
  });

  it("warnDeprecatedField includes field and replacement in details", () => {
    const w = warnDeprecatedField("oldField", "newField");
    expect(w.code).toBe("WARN_DEPRECATED_FIELD");
    expect(w.details?.field).toBe("oldField");
    expect(w.details?.replacement).toBe("newField");
    expect(w.suggestion).toContain("newField");
  });

  it("warnDryRun has no details", () => {
    const w = warnDryRun();
    expect(w.code).toBe("WARN_DRY_RUN");
    expect(w.details).toBeUndefined();
    expect(w.suggestion).toBeDefined();
  });
});

describe("TypeScript surface", () => {
  it("ok() preserves the data type parameter through the envelope", () => {
    type Payload = { tasks: { id: string; name: string }[] };
    const envelope = ok<Payload>({ tasks: [] }, baseMeta);
    expectTypeOf(envelope).toMatchTypeOf<ToolSuccess<Payload>>();
    expectTypeOf(envelope.data.tasks).toEqualTypeOf<{ id: string; name: string }[]>();
  });

  it("err() return type is structurally ToolError", () => {
    const envelope = err(new NotFound("x"), baseMeta);
    expectTypeOf(envelope).toMatchTypeOf<ToolError>();
  });
});
