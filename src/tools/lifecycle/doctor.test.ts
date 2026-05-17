/**
 * Tests for the `omnifocus_doctor` tool (#838).
 *
 * Schema parsing + per-error-class classification + summary roll-up.
 * Uses {@link InMemoryAdapter} as the happy-path fixture and a custom
 * stub adapter for failure modes — every typed error class gets its
 * own classifier-path assertion.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import {
  CircuitOpen,
  OFBusy,
  OmniFocusNotRunning,
  PermissionDenied,
  Timeout,
  TransportUnavailable,
} from "../../errors/index.js";
import {
  type CheckStatus,
  handleOmnifocusDoctor,
  OMNIFOCUS_DOCTOR_DESCRIPTION,
  omnifocusDoctorInputSchema,
} from "./doctor.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx(overrides: { adapter?: OmniFocusAdapter; startedAt?: number } = {}) {
  const adapter = overrides.adapter ?? new InMemoryAdapter();
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return {
    adapter,
    startedAt: overrides.startedAt ?? Date.now() - 5_000,
    serverVersion: "1.5.3-test",
    makeMeta,
  };
}

/** Stub adapter that throws `err` from `getLastSync`. Other methods are unused. */
function adapterThatThrows(err: unknown): OmniFocusAdapter {
  return {
    getLastSync: vi.fn().mockRejectedValue(err),
  } as unknown as OmniFocusAdapter;
}

function statusOf(checks: Array<{ name: string; status: CheckStatus }>, name: string): CheckStatus {
  const c = checks.find((x) => x.name === name);
  if (c === undefined) throw new Error(`no check named ${name}`);
  return c.status;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("omnifocus_doctor — input schema", () => {
  it("accepts an empty object", () => {
    expect(omnifocusDoctorInputSchema.parse({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("omnifocus_doctor — description", () => {
  it("declares the return shape", () => {
    expect(OMNIFOCUS_DOCTOR_DESCRIPTION).toMatch(/summary/);
    expect(OMNIFOCUS_DOCTOR_DESCRIPTION).toMatch(/checks/);
  });
  it("documents no side effects and no auto-launch", () => {
    expect(OMNIFOCUS_DOCTOR_DESCRIPTION).toMatch(/No side effects|no side effects/);
    expect(OMNIFOCUS_DOCTOR_DESCRIPTION).toMatch(/app_launch/);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("omnifocus_doctor — happy path", () => {
  it("returns summary=ok with all checks passing against InMemoryAdapter", async () => {
    const ctx = makeCtx();
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("ok");
    expect(envelope.data.checks).toHaveLength(4);
    for (const check of envelope.data.checks) {
      expect(check.status).toBe("pass");
      expect(check.remediation).toBeNull();
    }
  });

  it("populates server_info with uptime + version + platform", async () => {
    const ctx = makeCtx({ startedAt: Date.now() - 10_000 });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    const info = envelope.data.checks.find((c) => c.name === "server_info");
    expect(info?.status).toBe("pass");
    expect(info?.details.serverVersion).toBe("1.5.3-test");
    expect(typeof info?.details.uptimeMs).toBe("number");
    expect((info?.details.uptimeMs as number) >= 10_000).toBe(true);
    expect(info?.details.nodeVersion).toBe(process.version);
  });
});

// ---------------------------------------------------------------------------
// Failure classification — one branch per typed error
// ---------------------------------------------------------------------------

describe("omnifocus_doctor — failure classification", () => {
  it("OmniFocusNotRunning → of_running=fail, downstream=warn (skipped)", async () => {
    const ctx = makeCtx({ adapter: adapterThatThrows(new OmniFocusNotRunning()) });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("fail");
    expect(statusOf(envelope.data.checks, "automation_permission")).toBe("warn");
    expect(statusOf(envelope.data.checks, "sync_state")).toBe("warn");
    const ofCheck = envelope.data.checks.find((c) => c.name === "of_running");
    expect(ofCheck?.remediation).toMatch(/launch omnifocus/i);
  });

  it("PermissionDenied → of_running=pass, automation_permission=fail", async () => {
    const ctx = makeCtx({
      adapter: adapterThatThrows(new PermissionDenied()),
    });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("pass");
    expect(statusOf(envelope.data.checks, "automation_permission")).toBe("fail");
    const perm = envelope.data.checks.find((c) => c.name === "automation_permission");
    expect(perm?.remediation).toBeTruthy();
  });

  it("OFBusy → connectivity pass, sync_state=warn with remediation", async () => {
    const ctx = makeCtx({
      adapter: adapterThatThrows(new OFBusy("OmniFocus is busy")),
    });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("degraded");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("pass");
    expect(statusOf(envelope.data.checks, "automation_permission")).toBe("pass");
    expect(statusOf(envelope.data.checks, "sync_state")).toBe("warn");
    const sync = envelope.data.checks.find((c) => c.name === "sync_state");
    expect(sync?.remediation).toMatch(/modal|sync|dismiss/i);
  });

  it("CircuitOpen → of_running=fail (sustained outage, breaker open)", async () => {
    const ctx = makeCtx({
      adapter: adapterThatThrows(new CircuitOpen("circuit open")),
    });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("fail");
    expect(statusOf(envelope.data.checks, "automation_permission")).toBe("warn");
  });

  it("Timeout → of_running=warn (likely transient wedge)", async () => {
    const ctx = makeCtx({
      adapter: adapterThatThrows(new Timeout("Timeout")),
    });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("degraded");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("warn");
  });

  it("TransportUnavailable → of_running=fail (osascript binary missing)", async () => {
    const ctx = makeCtx({
      adapter: adapterThatThrows(
        new TransportUnavailable("osascript not found", {
          details: { reason: "spawn-failed" },
        }),
      ),
    });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("fail");
  });

  it("unknown error → all three connectivity checks fail with the original message", async () => {
    const ctx = makeCtx({ adapter: adapterThatThrows(new Error("kaboom")) });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
    expect(statusOf(envelope.data.checks, "of_running")).toBe("fail");
    expect(statusOf(envelope.data.checks, "automation_permission")).toBe("fail");
    expect(statusOf(envelope.data.checks, "sync_state")).toBe("fail");
    const of = envelope.data.checks.find((c) => c.name === "of_running");
    expect(of?.details.error).toBe("kaboom");
  });
});

// ---------------------------------------------------------------------------
// Summary roll-up
// ---------------------------------------------------------------------------

describe("omnifocus_doctor — summary roll-up", () => {
  it("'failed' beats 'warn' beats 'ok'", async () => {
    // CircuitOpen makes of_running fail but the warn-skipped downstreams
    // shouldn't dilute the summary back down to degraded.
    const ctx = makeCtx({ adapter: adapterThatThrows(new CircuitOpen("x")) });
    const envelope = await handleOmnifocusDoctor({}, ctx);
    expect(envelope.data.summary).toBe("failed");
  });
});
