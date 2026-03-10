import { describe, expect, test } from "bun:test";
import { registerOrderTools } from "./orders.js";
import { ConfirmationStore } from "./confirmation.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerOrderTools", () => {
  test("prepare_order archive path stores token and confirm_order submits archive order", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({ currency: "USD", rows: [{ provider: "X", price: 1.2 }] }),
      createArchiveOrder: async (params: any) => ({
        id: "ord-archive-1",
        orderType: "ARCHIVE",
        status: "SUBMITTED",
        createdAt: "2026-01-01T00:00:00Z",
        params,
      }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("prepare_order", {
      type: "archive",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      archiveId: "arch-123",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
      deliveryPath: "path/a",
    });

    const prepared = parseToolJson(preparedRaw);
    expect(prepared.orderType).toBe("archive");
    expect(prepared.message).toContain("ORDER NOT YET PLACED");
    expect(typeof prepared.confirmationToken).toBe("string");

    const confirmedRaw = await harness.invoke("confirm_order", {
      confirmationToken: prepared.confirmationToken,
    });
    const confirmed = parseToolJson(confirmedRaw);

    expect(confirmed.orderId).toBe("ord-archive-1");
    expect(confirmed.type).toBe("ARCHIVE");
  });

  test("prepare_order returns isError when tasking fields are missing", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, new ConfirmationStore());

    const result: any = await harness.invoke("prepare_order", {
      type: "tasking",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("window_start, window_end");
  });

  test("confirm_order returns isError for invalid token", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, new ConfirmationStore());

    const result: any = await harness.invoke("confirm_order", {
      confirmationToken: "bad-token",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid or expired confirmation token");
  });

  test("list_orders projects order summaries", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({
        total: 1,
        orders: [
          {
            id: "ord-1",
            orderType: "TASKING",
            status: "DELIVERED",
            createdAt: "2026-01-02T00:00:00Z",
            noisyField: "ignored",
          },
        ],
      }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, new ConfirmationStore());

    const resultRaw = await harness.invoke("list_orders", {
      orderType: "TASKING",
      pageNumber: 0,
      pageSize: 5,
    });
    const result = parseToolJson(resultRaw);

    expect(result.total).toBe(1);
    expect(result.orders).toEqual([
      {
        id: "ord-1",
        type: "TASKING",
        status: "DELIVERED",
        createdAt: "2026-01-02T00:00:00Z",
      },
    ]);
  });
});
