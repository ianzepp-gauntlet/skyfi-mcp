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
    registerAoiTools(harness.server as any, client as any, {
      defaultWebhookUrl: "https://mcp.example.com/webhooks/aoi",
    });

    const created = parseToolJson(
      await harness.invoke("notifications_create", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        webhookUrl: "https://example.com/webhook",
      }),
    );
    expect(created.monitorId).toBe("mon-1");

    const listed = parseToolJson(
      await harness.invoke("notifications_list", {}),
    );
    expect(listed.total).toBe(1);
    expect(listed.monitors[0].id).toBe("mon-1");

    const deleted = parseToolJson(
      await harness.invoke("notifications_delete", { monitor_id: "mon-1" }),
    );
    expect(deleted.monitorId).toBe("mon-1");
  });

  test("notifications_list falls back to notifications length when total is absent", async () => {
    const harness = createToolHarness();
    const client = {
      ...createMockClient(),
      listNotifications: async () => ({
        notifications: [{ id: "m1" }, { id: "m2" }],
      }),
    };

    registerAoiTools(harness.server as any, client as any);

    const listed = parseToolJson(
      await harness.invoke("notifications_list", {}),
    );
    expect(listed.total).toBe(2);
  });

  test("notifications_get returns monitor details with alerts", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { imagery: "scene-a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-1", { imagery: "scene-b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, { alertStore });

    const result = parseToolJson(
      await harness.invoke("notifications_get", { monitor_id: "mon-1" }),
    );
    expect(result.monitor.id).toBe("mon-1");
    expect(result.monitor.productType).toBe("DAY");
    expect(result.recentAlerts).toBe(2);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts[0].payload.imagery).toBe("scene-b");
  });

  test("notifications_get works without alert store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("notifications_get", { monitor_id: "mon-1" }),
    );
    expect(result.monitor.id).toBe("mon-1");
    expect(result.recentAlerts).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  test("notifications_delete clears alerts from store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { imagery: "scene-a" });

    registerAoiTools(harness.server as any, client as any, { alertStore });

    await harness.invoke("notifications_delete", { monitor_id: "mon-1" });
    expect(alertStore.get("mon-1")).toEqual([]);
  });

  test("alerts_list returns alerts for specific monitor", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { src: "a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-2", { src: "b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, { alertStore });

    const result = parseToolJson(
      await harness.invoke("alerts_list", { monitor_id: "mon-1" }),
    );
    expect(result.total).toBe(1);
    expect(result.alerts[0].monitorId).toBe("mon-1");
  });

  test("alerts_list returns all alerts when no monitor_id given", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    alertStore.add("mon-1", { src: "a" }, "2026-01-01T01:00:00Z");
    alertStore.add("mon-2", { src: "b" }, "2026-01-01T02:00:00Z");

    registerAoiTools(harness.server as any, client as any, { alertStore });

    const result = parseToolJson(await harness.invoke("alerts_list", {}));
    expect(result.total).toBe(2);
  });

  test("alerts_list respects limit parameter", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    const alertStore = new AlertStore();
    for (let i = 0; i < 10; i++) {
      alertStore.add("mon-1", { i }, `2026-01-01T00:0${i}:00Z`);
    }

    registerAoiTools(harness.server as any, client as any, { alertStore });

    const result = parseToolJson(
      await harness.invoke("alerts_list", { monitor_id: "mon-1", limit: 3 }),
    );
    expect(result.total).toBe(3);
  });

  test("alerts_list returns empty when no alert store", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("alerts_list", { monitor_id: "mon-1" }),
    );
    expect(result.total).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  test("notifications_create uses the internally managed webhook URL by default", async () => {
    const harness = createToolHarness();
    let receivedWebhookUrl = "";
    const client = {
      ...createMockClient(),
      createNotification: async ({ webhookUrl }: { webhookUrl: string }) => {
        receivedWebhookUrl = webhookUrl;
        return {
          id: "mon-1",
          aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
          webhookUrl,
          createdAt: "2026-01-01T00:00:00Z",
        };
      },
    };

    registerAoiTools(harness.server as any, client as any, {
      defaultWebhookUrl: "https://mcp.example.com/webhooks/aoi",
    });

    const created = parseToolJson(
      await harness.invoke("notifications_create", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      }),
    );

    expect(receivedWebhookUrl).toBe("https://mcp.example.com/webhooks/aoi");
    expect(created.webhookUrl).toBe("https://mcp.example.com/webhooks/aoi");
  });

  test("notifications_create errors when neither override nor managed webhook is available", async () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const result = (await harness.invoke("notifications_create", {
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
    })) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No webhook URL is available");
  });

  test("registers all five AOI tools", () => {
    const harness = createToolHarness();
    const client = createMockClient();
    registerAoiTools(harness.server as any, client as any);

    const names = harness.names();
    expect(names).toContain("notifications_create");
    expect(names).toContain("notifications_list");
    expect(names).toContain("notifications_get");
    expect(names).toContain("notifications_delete");
    expect(names).toContain("alerts_list");
  });
});
