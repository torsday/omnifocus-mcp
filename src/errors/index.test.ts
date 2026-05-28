import { describe, expect, it } from "vitest";
import {
  CircuitOpen,
  ConflictError,
  FeatureRequiresOfVersion,
  FeatureRequiresPro,
  isOmniFocusError,
  NotFound,
  OmniFocusError,
  OmniFocusNotRunning,
  OmniFocusTransportRestarted,
  PermissionDenied,
  QueueFull,
  RateLimited,
  ScriptError,
  ServerShuttingDown,
  Timeout,
  TransportUnavailable,
  ValidationError,
} from "./index.js";

describe("OmniFocusError", () => {
  it("we expose the code, message, and class name", () => {
    const err = new OmniFocusNotRunning();
    expect(err.code).toBe("OF_NOT_RUNNING");
    expect(err.message).toBe("OmniFocus is not running.");
    expect(err.name).toBe("OmniFocusNotRunning");
  });

  it("we surface a default suggestion that tells the agent the next step", () => {
    expect(new OmniFocusNotRunning().suggestion).toBe("Launch OmniFocus and retry.");
    expect(new PermissionDenied().suggestion).toContain("System Settings");
  });

  it("we let the caller override suggestion and details without losing the code", () => {
    const err = new NotFound("Project not found", {
      suggestion: "Check project_list output.",
      details: { resource: "project", id: "pXYZ" },
    });
    expect(err.code).toBe("OF_NOT_FOUND");
    expect(err.suggestion).toBe("Check project_list output.");
    expect(err.details).toEqual({ resource: "project", id: "pXYZ" });
  });

  it("we chain underlying causes via Error.cause", () => {
    const root = new Error("osascript exited 1");
    const err = new ScriptError("Script failed", { cause: root });
    expect(err.cause).toBe(root);
  });

  it("we omit suggestion and details from toJSON when not set", () => {
    // Force an instance without the defaults by using the base constructor.
    const err = new OmniFocusError("OF_VALIDATION", "raw");
    expect(err.toJSON()).toEqual({
      name: "OmniFocusError",
      code: "OF_VALIDATION",
      message: "raw",
    });
  });

  it("we serialize to the envelope shape with suggestion and details", () => {
    const err = new ValidationError("Bad input", {
      details: { failures: [{ index: 2, field: "due", reason: "bare local time" }] },
    });
    const json = err.toJSON();
    expect(json.code).toBe("OF_VALIDATION");
    expect(json.message).toBe("Bad input");
    expect(json.suggestion).toBeDefined();
    expect(json.details).toBeDefined();
    expect(json.details?.failures).toHaveLength(1);
  });
});

describe("instanceof discrimination", () => {
  it("we narrow with isOmniFocusError on caught unknowns", () => {
    let caught: unknown;
    try {
      throw new RateLimited("slow down");
    } catch (e) {
      caught = e;
    }
    expect(isOmniFocusError(caught)).toBe(true);
    if (isOmniFocusError(caught)) {
      // Inside the guard, TypeScript knows it's an OmniFocusError.
      expect(caught.code).toBe("OF_RATE_LIMITED");
    }
  });

  it("we reject non-error values from isOmniFocusError", () => {
    expect(isOmniFocusError(null)).toBe(false);
    expect(isOmniFocusError(undefined)).toBe(false);
    expect(isOmniFocusError("string")).toBe(false);
    expect(isOmniFocusError({ code: "OF_NOT_FOUND" })).toBe(false);
    expect(isOmniFocusError(new Error("plain"))).toBe(false);
  });

  it("we preserve instanceof across all subclasses", () => {
    const cases: { instance: OmniFocusError; ctor: new (...args: never[]) => OmniFocusError }[] = [
      { instance: new OmniFocusNotRunning(), ctor: OmniFocusNotRunning },
      { instance: new PermissionDenied(), ctor: PermissionDenied },
      { instance: new FeatureRequiresPro("Pro needed"), ctor: FeatureRequiresPro },
      { instance: new FeatureRequiresOfVersion("OF 4 needed"), ctor: FeatureRequiresOfVersion },
      { instance: new ValidationError("bad"), ctor: ValidationError },
      { instance: new NotFound("missing"), ctor: NotFound },
      { instance: new ConflictError("stale"), ctor: ConflictError },
      { instance: new Timeout("slow"), ctor: Timeout },
      { instance: new RateLimited("limited"), ctor: RateLimited },
      { instance: new QueueFull("full"), ctor: QueueFull },
      { instance: new CircuitOpen("open"), ctor: CircuitOpen },
      { instance: new TransportUnavailable("offline"), ctor: TransportUnavailable },
      { instance: new OmniFocusTransportRestarted("restarted"), ctor: OmniFocusTransportRestarted },
      { instance: new ScriptError("script bad"), ctor: ScriptError },
      { instance: new ServerShuttingDown(), ctor: ServerShuttingDown },
    ];

    for (const { instance, ctor } of cases) {
      expect(instance).toBeInstanceOf(OmniFocusError);
      expect(instance).toBeInstanceOf(Error);
      expect(instance).toBeInstanceOf(ctor);
      expect(instance.name).toBe(ctor.name);
    }
  });
});

describe("remediationClass — machine-readable agent action", () => {
  it("environment errors stop the agent and require user action", () => {
    expect(new OmniFocusNotRunning().remediationClass).toBe("environment");
    expect(new PermissionDenied().remediationClass).toBe("environment");
    expect(new FeatureRequiresPro("").remediationClass).toBe("environment");
    expect(new FeatureRequiresOfVersion("").remediationClass).toBe("environment");
  });

  it("input errors tell the agent to fix the input before retrying", () => {
    expect(new ValidationError("").remediationClass).toBe("input");
    expect(new NotFound("").remediationClass).toBe("input");
    expect(new ConflictError("").remediationClass).toBe("input");
  });

  it("transient errors tell the agent to wait and retry", () => {
    expect(new Timeout("").remediationClass).toBe("transient");
    expect(new RateLimited("").remediationClass).toBe("transient");
    expect(new QueueFull("").remediationClass).toBe("transient");
    expect(new CircuitOpen("").remediationClass).toBe("transient");
  });

  it("infrastructure errors tell the agent to retry once then surface to user", () => {
    expect(new TransportUnavailable("").remediationClass).toBe("infrastructure");
    expect(new OmniFocusTransportRestarted("").remediationClass).toBe("infrastructure");
    expect(new ScriptError("").remediationClass).toBe("infrastructure");
  });

  it("lifecycle errors tell the agent to reconnect", () => {
    expect(new ServerShuttingDown().remediationClass).toBe("lifecycle");
  });

  it("remediationClass appears in toJSON output", () => {
    const json = new NotFound("task missing").toJSON();
    expect(json.remediationClass).toBe("input");
  });

  it("base OmniFocusError has no remediationClass when not set", () => {
    const err = new OmniFocusError("OF_VALIDATION", "raw");
    expect(err.remediationClass).toBeUndefined();
    expect(err.toJSON()).toEqual({ name: "OmniFocusError", code: "OF_VALIDATION", message: "raw" });
  });

  it("caller can override remediationClass via options", () => {
    const err = new Timeout("slow", { remediationClass: "infrastructure" });
    expect(err.remediationClass).toBe("infrastructure");
  });
});

describe("ConflictError — optimistic-concurrency violation", () => {
  it("has code OF_CONFLICT and remediationClass input", () => {
    const err = new ConflictError("Task was modified");
    expect(err.code).toBe("OF_CONFLICT");
    expect(err.remediationClass).toBe("input");
    expect(err.name).toBe("ConflictError");
  });

  it("suggestion tells the agent to re-read and retry with fresh modifiedAt", () => {
    expect(new ConflictError("").suggestion).toContain("modifiedAt");
  });

  it("caller can attach details with the stale and current timestamps", () => {
    const err = new ConflictError("Stale write", {
      details: { expected: "2026-04-21T10:00:00-07:00", actual: "2026-04-21T10:05:00-07:00" },
    });
    expect(err.details?.expected).toBeDefined();
    expect(err.details?.actual).toBeDefined();
  });

  it("serializes cleanly to the error envelope shape", () => {
    const json = new ConflictError("Conflict").toJSON();
    expect(json.code).toBe("OF_CONFLICT");
    expect(json.remediationClass).toBe("input");
    expect(json.suggestion).toBeDefined();
  });
});

describe("retryAfterMs — structured wait time on transient errors", () => {
  it("RateLimited includes retryAfterMs: 60000 in details by default", () => {
    expect(new RateLimited("too fast").details?.retryAfterMs).toBe(60_000);
  });

  it("CircuitOpen includes retryAfterMs: 60000 in details by default", () => {
    expect(new CircuitOpen("open").details?.retryAfterMs).toBe(60_000);
  });

  it("caller can override retryAfterMs via details", () => {
    const err = new RateLimited("slow", { details: { retryAfterMs: 30_000 } });
    expect(err.details?.retryAfterMs).toBe(30_000);
  });

  it("retryAfterMs appears in toJSON details", () => {
    const json = new CircuitOpen("").toJSON();
    expect(json.details?.retryAfterMs).toBe(60_000);
  });
});

describe("OmniFocusTransportRestarted — persistent transport child replaced", () => {
  it("has code OF_TRANSPORT_RESTARTED and infrastructure remediation", () => {
    const err = new OmniFocusTransportRestarted("child restarted mid-call");
    expect(err.code).toBe("OF_TRANSPORT_RESTARTED");
    expect(err.remediationClass).toBe("infrastructure");
    expect(err.name).toBe("OmniFocusTransportRestarted");
  });

  it("suggestion points the operator at internal_status transport stats", () => {
    expect(new OmniFocusTransportRestarted("").suggestion).toContain("internal_status");
  });

  it("carries transport context in details", () => {
    const err = new OmniFocusTransportRestarted("restarted", {
      details: { transport: "jxa", scriptName: "task_list", reason: "exit 1" },
    });
    expect(err.details?.transport).toBe("jxa");
    expect(err.details?.scriptName).toBe("task_list");
  });
});

describe("error code coverage — every documented code has a class", () => {
  it("we have a concrete class for each code in DESIGN §6.7", () => {
    const expectedCodes = new Set([
      "OF_NOT_RUNNING",
      "OF_PERMISSION_DENIED",
      "OF_FEATURE_REQUIRES_PRO",
      "OF_FEATURE_REQUIRES_VERSION",
      "OF_VALIDATION",
      "OF_NOT_FOUND",
      "OF_CONFLICT",
      "OF_TIMEOUT",
      "OF_RATE_LIMITED",
      "OF_QUEUE_FULL",
      "OF_CIRCUIT_OPEN",
      "OF_TRANSPORT_UNAVAILABLE",
      "OF_SCRIPT_ERROR",
      "OF_SHUTTING_DOWN",
    ]);

    const actualCodes = new Set([
      new OmniFocusNotRunning().code,
      new PermissionDenied().code,
      new FeatureRequiresPro("").code,
      new FeatureRequiresOfVersion("").code,
      new ValidationError("").code,
      new NotFound("").code,
      new ConflictError("").code,
      new Timeout("").code,
      new RateLimited("").code,
      new QueueFull("").code,
      new CircuitOpen("").code,
      new TransportUnavailable("").code,
      new ScriptError("").code,
      new ServerShuttingDown().code,
    ]);

    expect(actualCodes).toEqual(expectedCodes);
    expect(actualCodes.size).toBe(14);
  });
});
