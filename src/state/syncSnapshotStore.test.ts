import { describe, expect, it } from "vitest";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import { MAX_SIZE, SyncSnapshotStore } from "./syncSnapshotStore.js";

function snap(issuedAtIso = "2026-06-03T00:00:00.000Z") {
  return {
    tasksById: new Map<string, Task>(),
    projectsById: new Map<string, Project>(),
    issuedAtIso,
  };
}

describe("SyncSnapshotStore", () => {
  it("registers a snapshot and returns it by token", () => {
    const store = new SyncSnapshotStore();
    const token = store.register(snap());
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(store.get(token)?.issuedAtIso).toBe("2026-06-03T00:00:00.000Z");
  });

  it("returns undefined for an unknown token", () => {
    const store = new SyncSnapshotStore();
    expect(store.get("nope")).toBeUndefined();
  });

  it("expires entries past their TTL", () => {
    const store = new SyncSnapshotStore(-1); // already-expired TTL
    const token = store.register(snap());
    expect(store.get(token)).toBeUndefined();
  });

  it("hard-caps at MAX_SIZE by evicting the oldest", () => {
    const store = new SyncSnapshotStore();
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SIZE + 1; i += 1) {
      tokens.push(store.register(snap(`2026-06-03T00:00:0${i}.000Z`)));
    }
    expect(store.size).toBe(MAX_SIZE);
    // The first (oldest) token was evicted; the most recent survives.
    expect(store.get(tokens[0] as string)).toBeUndefined();
    expect(store.get(tokens[tokens.length - 1] as string)).toBeDefined();
  });

  it("delete and clear drop entries", () => {
    const store = new SyncSnapshotStore();
    const a = store.register(snap());
    const b = store.register(snap());
    store.delete(a);
    expect(store.get(a)).toBeUndefined();
    expect(store.get(b)).toBeDefined();
    store.clear();
    expect(store.size).toBe(0);
  });
});
