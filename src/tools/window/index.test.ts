/**
 * Unit tests for window-control tools (#466).
 *
 * Covers the three handlers' happy paths, the WindowUnavailable error path,
 * and NotFound semantics for set_perspective / set_focus. Backed by
 * `InMemoryAdapter` plus an explicit `WindowUnavailable`-throwing stub.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { NotFound, WindowUnavailable } from "../../errors/index.js";
import { handleWindowGetState, handleWindowSetFocus, handleWindowSetPerspective } from "./index.js";

const makeMeta = (): never => ({}) as never;

describe("handleWindowGetState", () => {
  it("returns the in-memory adapter's stored window state", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleWindowGetState({}, { adapter, makeMeta });
    expect(env.data).toEqual({ perspectiveName: null, focusContainerIds: [] });
  });

  it("propagates WindowUnavailable when the adapter throws it", async () => {
    const adapter = {
      getWindowState: vi.fn().mockRejectedValue(new WindowUnavailable("no window")),
    } as unknown as OmniFocusAdapter;
    await expect(handleWindowGetState({}, { adapter, makeMeta })).rejects.toBeInstanceOf(
      WindowUnavailable,
    );
  });
});

describe("handleWindowSetPerspective", () => {
  it("sets the perspective and round-trips via getWindowState", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleWindowSetPerspective(
      { perspectiveName: "Forecast" },
      { adapter, makeMeta },
    );
    expect(env.data).toEqual({ perspectiveName: "Forecast" });

    const after = await adapter.getWindowState();
    expect(after.perspectiveName).toBe("Forecast");
  });

  it("propagates WindowUnavailable", async () => {
    const adapter = {
      setWindowPerspective: vi.fn().mockRejectedValue(new WindowUnavailable("no window")),
    } as unknown as OmniFocusAdapter;
    await expect(
      handleWindowSetPerspective({ perspectiveName: "Forecast" }, { adapter, makeMeta }),
    ).rejects.toBeInstanceOf(WindowUnavailable);
  });

  it("propagates NotFound when the perspective name doesn't exist (live transport)", async () => {
    const adapter = {
      setWindowPerspective: vi
        .fn()
        .mockRejectedValue(new NotFound("Perspective not found: Imaginary")),
    } as unknown as OmniFocusAdapter;
    await expect(
      handleWindowSetPerspective({ perspectiveName: "Imaginary" }, { adapter, makeMeta }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("handleWindowSetFocus", () => {
  it("focuses on a project that exists", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await adapter.createProject({ name: "Focused" });

    const env = await handleWindowSetFocus({ containerId: projectId }, { adapter, makeMeta });

    expect(env.data).toEqual({ focusContainerIds: [projectId] });

    const after = await adapter.getWindowState();
    expect(after.focusContainerIds).toEqual([projectId]);
  });

  it("clears focus when containerId is null", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await adapter.createProject({ name: "Focused" });
    await adapter.setWindowFocus(projectId);

    const env = await handleWindowSetFocus({ containerId: null }, { adapter, makeMeta });
    expect(env.data).toEqual({ focusContainerIds: [] });

    const after = await adapter.getWindowState();
    expect(after.focusContainerIds).toEqual([]);
  });

  it("throws NotFound for a containerId that's neither a project nor a folder", async () => {
    const adapter = new InMemoryAdapter();
    await expect(
      handleWindowSetFocus({ containerId: "made-up-id-not-in-store" }, { adapter, makeMeta }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("propagates WindowUnavailable from the adapter", async () => {
    const adapter = {
      setWindowFocus: vi.fn().mockRejectedValue(new WindowUnavailable("no window")),
    } as unknown as OmniFocusAdapter;
    await expect(
      handleWindowSetFocus({ containerId: null }, { adapter, makeMeta }),
    ).rejects.toBeInstanceOf(WindowUnavailable);
  });
});
