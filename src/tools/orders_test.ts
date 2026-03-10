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

describe("registerOrderTools (additional)", () => {
  test("prepare_order returns isError when archiveId is missing", async () => {
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
      type: "archive",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("archiveId is required");
  });

  test("prepare_order tasking path stores details and confirm_order submits tasking order", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({ currency: "USD", tasking: [{ provider: "Y", price: 99 }] }),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({
        id: "ord-task-1",
        orderType: "TASKING",
        status: "SUBMITTED",
        createdAt: "2026-01-03T00:00:00Z",
      }),
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("prepare_order", {
      type: "tasking",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      product_type: "DAY",
      resolution: "HIGH",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
      deliveryPath: "task/path",
    });

    const prepared = parseToolJson(preparedRaw);
    expect(prepared.orderDetails.window).toContain("2026-01-01T00:00:00Z");
    expect(prepared.orderDetails.productType).toBe("DAY");
    expect(prepared.orderDetails.resolution).toBe("HIGH");

    const confirmedRaw = await harness.invoke("confirm_order", {
      confirmationToken: prepared.confirmationToken,
    });
    const confirmed = parseToolJson(confirmedRaw);

    expect(confirmed.orderId).toBe("ord-task-1");
    expect(confirmed.type).toBe("TASKING");
  });

  test("get_order returns full order detail payload", async () => {
    const harness = createToolHarness();
    const fullOrder = {
      id: "ord-xyz",
      orderType: "ARCHIVE",
      status: "DELIVERED",
      createdAt: "2026-01-01T00:00:00Z",
      delivery: { bucket: "private", path: "x/y" },
      history: [{ status: "SUBMITTED" }, { status: "DELIVERED" }],
    };

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => fullOrder,
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, new ConfirmationStore());

    const result = parseToolJson(await harness.invoke("get_order", { order_id: "ord-xyz" }));
    expect(result).toEqual(fullOrder);
  });
});
