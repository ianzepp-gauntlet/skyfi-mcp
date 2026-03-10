import { describe, expect, test } from "bun:test";
import { registerAoiTools } from "./aoi.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerAoiTools", () => {
  test("create/list/delete AOI monitor flows", async () => {
    const harness = createToolHarness();

    const client = {
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
      deleteNotification: async () => undefined,
    };

    registerAoiTools(harness.server as any, client as any);

    const created = parseToolJson(
      await harness.invoke("create_aoi_monitor", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        webhookUrl: "https://example.com/webhook",
      })
    );
    expect(created.monitorId).toBe("mon-1");

    const listed = parseToolJson(await harness.invoke("list_aoi_monitors", {}));
    expect(listed.total).toBe(1);
    expect(listed.monitors[0].id).toBe("mon-1");

    const deleted = parseToolJson(
      await harness.invoke("delete_aoi_monitor", { monitor_id: "mon-1" })
    );
    expect(deleted.monitorId).toBe("mon-1");
  });

  test("list_aoi_monitors falls back to notifications length when total is absent", async () => {
    const harness = createToolHarness();
    const client = {
      createNotification: async () => ({ id: "unused" }),
      listNotifications: async () => ({ notifications: [{ id: "m1" }, { id: "m2" }] }),
      deleteNotification: async () => undefined,
    };

    registerAoiTools(harness.server as any, client as any);

    const listed = parseToolJson(await harness.invoke("list_aoi_monitors", {}));
    expect(listed.total).toBe(2);
  });
});
