import { describe, expect, test } from "bun:test";
import { registerAoiTools } from "./aoi.js";
import { AlertStore } from "./alerts.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

function createMockClient() {
  return {
    createNotification: async () => ({
      id: "mon-1",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      webhookUrl: "https://example.com/webhook",
      createdAt: "2026-01-01T00:00:00Z",
    }),
    listNotifications: async () => ({
      notifications: [
        {
          id: "mon-1",
          aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
          webhookUrl: "https://example.com/webhook",
          gsdMin: 0.3,
          gsdMax: 2,
          productType: "DAY",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    }),
    getNotification: async (id: string) => ({
      id,
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      webhookUrl: "https://example.com/webhook",
      gsdMin: 0.3,
      gsdMax: 2,
      productType: "DAY",
      createdAt: "2026-01-01T00:00:00Z",
    }),
    deleteNotification: async () => undefined,
  };
}

describe("registerAoiTools", () => {
  test("create/list/delete AOI monitor flows", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const created = parseToolJson(
      await harness.invoke("create_aoi_monitor", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        webhookUrl: "https://example.com/webhook",
      }),
    );
    expect(created.monitorId).toBe("mon-1");

    const listed = parseToolJson(await harness.invoke("list_aoi_monitors", {}));
    expect(listed.total).toBe(1);
    expect(listed.monitors[0].id).toBe("mon-1");

    const deleted = parseToolJson(
      await harness.invoke("delete_aoi_monitor", { monitor_id: "mon-1" }),
    );
    expect(deleted.monitorId).toBe("mon-1");
  });

  test("list_aoi_monitors falls back to notifications length when total is absent", async () => {
    const harness = createToolHarness();
    const client = {
      ...createMockClient(),
      listNotifications: async () => ({
        notifications: [{ id: "m1" }, { id: "m2" }],
      }),
    };

    registerAoiTools(harness.server as any, client as any);

    const listed = parseToolJson(await harness.invoke("list_aoi_monitors", {}));
    expect(listed.total).toBe(2);
  });

  test("get_aoi_monitor returns monitor details with alerts", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { imagery: "scene-a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-1", { imagery: "scene-b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, alertStore);

    const result = parseToolJson(
      await harness.invoke("get_aoi_monitor", { monitor_id: "mon-1" }),
    );
    expect(result.monitor.id).toBe("mon-1");
    expect(result.monitor.productType).toBe("DAY");
    expect(result.recentAlerts).toBe(2);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts[0].payload.imagery).toBe("scene-b");
  });

  test("get_aoi_monitor works without alert store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("get_aoi_monitor", { monitor_id: "mon-1" }),
    );
    expect(result.monitor.id).toBe("mon-1");
    expect(result.recentAlerts).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  test("delete_aoi_monitor clears alerts from store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { imagery: "scene-a" });

    registerAoiTools(harness.server as any, client as any, alertStore);

    await harness.invoke("delete_aoi_monitor", { monitor_id: "mon-1" });
    expect(alertStore.get("mon-1")).toEqual([]);
  });

  test("get_aoi_alerts returns alerts for specific monitor", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { src: "a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-2", { src: "b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, alertStore);

    const result = parseToolJson(
      await harness.invoke("get_aoi_alerts", { monitor_id: "mon-1" }),
    );
    expect(result.total).toBe(1);
    expect(result.alerts[0].monitorId).toBe("mon-1");
  });

  test("get_aoi_alerts returns all alerts when no monitor_id given", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { src: "a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-2", { src: "b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, alertStore);

    const result = parseToolJson(await harness.invoke("get_aoi_alerts", {}));
    expect(result.total).toBe(2);
  });

  test("get_aoi_alerts respects limit parameter", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    for (let i = 0; i < 10; i++) {
      alertStore.add("mon-1", { i }, `2026-01-01T00:0${i}:00Z`);
    }

    registerAoiTools(harness.server as any, client as any, alertStore);

    const result = parseToolJson(
      await harness.invoke("get_aoi_alerts", { monitor_id: "mon-1", limit: 3 }),
    );
    expect(result.total).toBe(3);
  });

  test("get_aoi_alerts returns empty when no alert store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("get_aoi_alerts", { monitor_id: "mon-1" }),
    );
    expect(result.total).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  test("registers all five AOI tools", () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const names = harness.names();
    expect(names).toContain("create_aoi_monitor");
    expect(names).toContain("list_aoi_monitors");
    expect(names).toContain("get_aoi_monitor");
    expect(names).toContain("delete_aoi_monitor");
    expect(names).toContain("get_aoi_alerts");
  });
});
