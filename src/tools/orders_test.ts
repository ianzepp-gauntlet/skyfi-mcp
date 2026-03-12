import { describe, expect, test } from "bun:test";
import { registerOrderTools } from "./orders.js";
import { ConfirmationStore } from "./confirmation.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerOrderTools", () => {
  test("orders_prepare archive path stores token and orders_confirm submits archive order", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({
        currency: "USD",
        rows: [{ provider: "X", price: 1.2 }],
      }),
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

    const preparedRaw = await harness.invoke("orders_prepare", {
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

    const confirmedRaw = await harness.invoke("orders_confirm", {
      confirmationToken: prepared.confirmationToken,
    });
    const confirmed = parseToolJson(confirmedRaw);

    expect(confirmed.orderId).toBe("ord-archive-1");
    expect(confirmed.type).toBe("ARCHIVE");
  });

  test("orders_prepare returns isError when tasking fields are missing", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(
      harness.server as any,
      client as any,
      new ConfirmationStore(),
    );

    const result: any = await harness.invoke("orders_prepare", {
      type: "tasking",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("window_start, window_end");
  });

  test("orders_confirm returns isError for invalid token", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(
      harness.server as any,
      client as any,
      new ConfirmationStore(),
    );

    const result: any = await harness.invoke("orders_confirm", {
      confirmationToken: "bad-token",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "Invalid or expired confirmation token",
    );
  });

  test("orders_list projects order summaries", async () => {
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

    registerOrderTools(
      harness.server as any,
      client as any,
      new ConfirmationStore(),
    );

    const resultRaw = await harness.invoke("orders_list", {
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
  test("orders_prepare returns isError when archiveId is missing", async () => {
    const harness = createToolHarness();
    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({}),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(
      harness.server as any,
      client as any,
      new ConfirmationStore(),
    );

    const result: any = await harness.invoke("orders_prepare", {
      type: "archive",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("archiveId is required");
  });

  test("orders_prepare tasking path stores details and orders_confirm submits tasking order", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({
        currency: "USD",
        tasking: [{ provider: "Y", price: 99 }],
      }),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async () => ({
        id: "ord-task-1",
        orderType: "TASKING",
        status: "SUBMITTED",
        createdAt: "2026-01-03T00:00:00Z",
      }),
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("orders_prepare", {
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

    const confirmedRaw = await harness.invoke("orders_confirm", {
      confirmationToken: prepared.confirmationToken,
    });
    const confirmed = parseToolJson(confirmedRaw);

    expect(confirmed.orderId).toBe("ord-task-1");
    expect(confirmed.type).toBe("TASKING");
  });

  test("orders_prepare normalizes underscore tasking resolution aliases to API values", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();
    const capturedParams: any[] = [];

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({
        currency: "USD",
        tasking: [{ provider: "Y", price: 99 }],
      }),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async (params: any) => {
        capturedParams.push(params);
        return {
          id: "ord-task-2",
          orderType: "TASKING",
          status: "SUBMITTED",
          createdAt: "2026-01-04T00:00:00Z",
        };
      },
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("orders_prepare", {
      type: "tasking",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      product_type: "DAY",
      resolution: "VERY_HIGH",
      deliveryDriver: "S3",
      deliveryBucket: "bucket-a",
    });

    const prepared = parseToolJson(preparedRaw);
    expect(prepared.orderDetails.resolution).toBe("VERY HIGH");

    await harness.invoke("orders_confirm", {
      confirmationToken: prepared.confirmationToken,
    });

    expect(capturedParams).toHaveLength(1);
    expect(capturedParams[0].resolution).toBe("VERY HIGH");
  });

  test("orders_confirm forwards exact params to createArchiveOrder", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();
    const capturedParams: any[] = [];

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({ currency: "USD", rows: [] }),
      createArchiveOrder: async (params: any) => {
        capturedParams.push(params);
        return {
          id: "ord-1",
          orderType: "ARCHIVE",
          status: "SUBMITTED",
          createdAt: "2026-01-01T00:00:00Z",
        };
      },
      createTaskingOrder: async () => ({ id: "unused" }),
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("orders_prepare", {
      type: "archive",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      archiveId: "arch-xyz",
      deliveryDriver: "S3",
      deliveryBucket: "my-bucket",
      deliveryPath: "data/out",
    });

    const { confirmationToken } = parseToolJson(preparedRaw);
    await harness.invoke("orders_confirm", { confirmationToken });

    expect(capturedParams).toHaveLength(1);
    expect(capturedParams[0].aoi).toBe("POLYGON((0 0,1 0,1 1,0 1,0 0))");
    expect(capturedParams[0].archiveId).toBe("arch-xyz");
    expect(capturedParams[0].deliveryDriver).toBe("S3");
    expect(capturedParams[0].deliveryParams.bucket).toBe("my-bucket");
    expect(capturedParams[0].deliveryParams.path).toBe("data/out");
  });

  test("orders_confirm forwards exact params to createTaskingOrder", async () => {
    const harness = createToolHarness();
    const store = new ConfirmationStore();
    const capturedParams: any[] = [];

    const client = {
      listOrders: async () => ({ total: 0, orders: [] }),
      getOrder: async () => ({ id: "unused" }),
      getPricing: async () => ({ currency: "USD", tasking: [] }),
      createArchiveOrder: async () => ({ id: "unused" }),
      createTaskingOrder: async (params: any) => {
        capturedParams.push(params);
        return {
          id: "ord-task-2",
          orderType: "TASKING",
          status: "SUBMITTED",
          createdAt: "2026-01-01T00:00:00Z",
        };
      },
    };

    registerOrderTools(harness.server as any, client as any, store);

    const preparedRaw = await harness.invoke("orders_prepare", {
      type: "tasking",
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      window_start: "2026-02-01T00:00:00Z",
      window_end: "2026-02-02T00:00:00Z",
      product_type: "DAY",
      resolution: "HIGH",
      deliveryDriver: "S3",
      deliveryBucket: "task-bucket",
      deliveryPath: "task/out",
    });

    const { confirmationToken } = parseToolJson(preparedRaw);
    await harness.invoke("orders_confirm", { confirmationToken });

    expect(capturedParams).toHaveLength(1);
    expect(capturedParams[0].aoi).toBe("POLYGON((0 0,1 0,1 1,0 1,0 0))");
    expect(capturedParams[0].windowStart).toBe("2026-02-01T00:00:00Z");
    expect(capturedParams[0].windowEnd).toBe("2026-02-02T00:00:00Z");
    expect(capturedParams[0].productType).toBe("DAY");
    expect(capturedParams[0].resolution).toBe("HIGH");
    expect(capturedParams[0].deliveryDriver).toBe("S3");
    expect(capturedParams[0].deliveryParams.bucket).toBe("task-bucket");
  });

  test("orders_get returns full order detail payload", async () => {
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

    registerOrderTools(
      harness.server as any,
      client as any,
      new ConfirmationStore(),
    );

    const result = parseToolJson(
      await harness.invoke("orders_get", { order_id: "ord-xyz" }),
    );
    expect(result).toEqual(fullOrder);
  });
});
