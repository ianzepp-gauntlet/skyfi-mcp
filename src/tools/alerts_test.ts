import { describe, expect, test } from "bun:test";
import { AlertStore } from "./alerts.js";

describe("AlertStore", () => {
  test("add and retrieve alerts by monitor ID", () => {
    const store = new AlertStore();
    store.add("mon-1", { imagery: "scene-a" }, "2026-01-01T00:00:00Z");
    store.add("mon-1", { imagery: "scene-b" }, "2026-01-01T01:00:00Z");

    const alerts = store.get("mon-1");
    expect(alerts).toHaveLength(2);
    // Newest first (prepended).
    expect(alerts[0]!.payload.imagery).toBe("scene-b");
    expect(alerts[1]!.payload.imagery).toBe("scene-a");
  });

  test("returns empty array for unknown monitor", () => {
    const store = new AlertStore();
    expect(store.get("nonexistent")).toEqual([]);
  });

  test("respects per-monitor limit", () => {
    const store = new AlertStore(3);
    for (let i = 0; i < 5; i++) {
      store.add("mon-1", { i }, `2026-01-01T0${i}:00:00Z`);
    }

    const alerts = store.get("mon-1");
    expect(alerts).toHaveLength(3);
    // Newest 3 should be retained.
    expect(alerts[0]!.payload.i).toBe(4);
    expect(alerts[2]!.payload.i).toBe(2);
  });

  test("get respects limit parameter", () => {
    const store = new AlertStore();
    for (let i = 0; i < 10; i++) {
      store.add("mon-1", { i });
    }

    const alerts = store.get("mon-1", 3);
    expect(alerts).toHaveLength(3);
  });

  test("getAll returns alerts across monitors sorted by receivedAt", () => {
    const store = new AlertStore();
    store.add("mon-1", { src: "a" }, "2026-01-01T01:00:00Z");
    store.add("mon-2", { src: "b" }, "2026-01-01T03:00:00Z");
    store.add("mon-1", { src: "c" }, "2026-01-01T02:00:00Z");

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]!.payload.src).toBe("b"); // 03:00
    expect(all[1]!.payload.src).toBe("c"); // 02:00
    expect(all[2]!.payload.src).toBe("a"); // 01:00
  });

  test("getAll respects limit", () => {
    const store = new AlertStore();
    for (let i = 0; i < 10; i++) {
      store.add(`mon-${i}`, { i }, `2026-01-01T00:0${i}:00Z`);
    }

    const all = store.getAll(3);
    expect(all).toHaveLength(3);
  });

  test("clear removes alerts for a specific monitor", () => {
    const store = new AlertStore();
    store.add("mon-1", { a: 1 });
    store.add("mon-2", { b: 2 });

    store.clear("mon-1");
    expect(store.get("mon-1")).toEqual([]);
    expect(store.get("mon-2")).toHaveLength(1);
  });

  test("size counts total alerts across all monitors", () => {
    const store = new AlertStore();
    store.add("mon-1", { a: 1 });
    store.add("mon-1", { a: 2 });
    store.add("mon-2", { b: 1 });

    expect(store.size).toBe(3);
  });
});
