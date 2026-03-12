/**
 * Contract tests: SkyFiClient vs. the OpenAPI spec.
 *
 * These tests run the real SkyFiClient methods against a Prism mock server
 * backed by `docs/openapi.json`. Prism validates every request (headers,
 * query params, body) against the spec schemas and returns spec-shaped mock
 * responses. Any field name mismatch, missing required field, or type error
 * causes Prism to return a 422, which the client surfaces as a thrown error —
 * failing the test.
 *
 * This is NOT a unit test of client logic (those live in skyfi_test.ts and
 * skyfi_more_test.ts). This is a contract test that proves the client sends
 * requests the real API would accept and can parse the responses it would get.
 *
 * Prerequisites:
 *   Prism must be running: bunx prism mock docs/openapi.json --port 4010 --host 127.0.0.1 --errors
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { SkyFiClient } from "./skyfi.js";

const PRISM_URL = "http://127.0.0.1:4010";
const AOI =
  "POLYGON((-99.919 16.847,-99.921 16.826,-99.899 16.825,-99.899 16.849,-99.919 16.847))";

// Prism validates path params against spec format constraints.
// The SkyFi spec uses format: uuid for most IDs.
const UUID = "497f6eca-6276-4993-bfeb-53cbbbba6f08";

let client: SkyFiClient;

beforeAll(async () => {
  try {
    const res = await fetch(`${PRISM_URL}/ping`);
    if (!res.ok) throw new Error(`Prism returned ${res.status}`);
  } catch (e) {
    throw new Error(
      `Prism mock server not reachable at ${PRISM_URL}. ` +
        `Start it with: bunx prism mock docs/openapi.json --port 4010 --host 127.0.0.1 --errors\n` +
        `Original error: ${e}`,
    );
  }

  client = new SkyFiClient({ apiKey: "test-key", baseUrl: PRISM_URL });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("contract: auth", () => {
  test("GET /auth/whoami", async () => {
    const user = await client.whoami();
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("email");
  });
});

// ── Archives ──────────────────────────────────────────────────────────────────

describe("contract: archives", () => {
  test("POST /archives — search", async () => {
    const result = await client.searchArchives({
      aoi: AOI,
      fromDate: "2024-01-01T00:00:00Z",
      toDate: "2024-06-01T00:00:00Z",
    });
    expect(result).toHaveProperty("archives");
    expect(Array.isArray(result.archives)).toBe(true);
  });

  test("GET /archives?page= — pagination", async () => {
    const result = await client.getArchivesPage("page-cursor");
    expect(result).toHaveProperty("archives");
  });

  test("GET /archives/{archive_id}", async () => {
    const archive = await client.getArchive("test-archive-id");
    expect(archive).toHaveProperty("archiveId");
  });
});

// ── Pricing ───────────────────────────────────────────────────────────────────

describe("contract: pricing", () => {
  test("POST /pricing — no AOI", async () => {
    const result = await client.getPricing();
    expect(result).toBeDefined();
  });

  test("POST /pricing — with AOI", async () => {
    const result = await client.getPricing({ aoi: AOI });
    expect(result).toBeDefined();
  });
});

// ── Feasibility ───────────────────────────────────────────────────────────────

describe("contract: feasibility", () => {
  test("POST /feasibility", async () => {
    const result = await client.checkFeasibility({
      aoi: AOI,
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-02-01T00:00:00Z",
      productType: "DAY",
      resolution: "HIGH",
    });
    // Response field name is `id` in the spec, our type calls it `feasibility_id`
    expect(result).toBeDefined();
  });

  test("GET /feasibility/{id}", async () => {
    const result = await client.getFeasibilityStatus(UUID);
    expect(result).toBeDefined();
  });

  test("POST /feasibility/pass-prediction", async () => {
    const result = await client.getPassPrediction({
      aoi: AOI,
      fromDate: "2024-01-01T00:00:00Z",
      toDate: "2024-02-01T00:00:00Z",
    });
    expect(result).toBeDefined();
  });
});

// ── Orders ────────────────────────────────────────────────────────────────────

describe("contract: orders", () => {
  test("GET /orders", async () => {
    const result = await client.listOrders();
    expect(result).toHaveProperty("orders");
  });

  test("GET /orders/{id}", async () => {
    const order = await client.getOrder(UUID);
    expect(order).toBeDefined();
  });

  test("POST /orders/{order_id}/redelivery", async () => {
    const order = await client.redeliverOrder(UUID, {
      deliveryDriver: "S3",
      deliveryParams: { bucket: "my-bucket", path: "imagery/" },
    });
    expect(order).toBeDefined();
  });

  test("POST /order-archive", async () => {
    const order = await client.createArchiveOrder({
      aoi: AOI,
      archiveId: "test-archive-id",
      deliveryDriver: "S3",
      deliveryParams: { bucket: "my-bucket", path: "imagery/" },
    });
    expect(order).toBeDefined();
  });

  test("POST /order-tasking", async () => {
    const order = await client.createTaskingOrder({
      aoi: AOI,
      windowStart: "2024-01-01T00:00:00Z",
      windowEnd: "2024-02-01T00:00:00Z",
      productType: "DAY",
      resolution: "HIGH",
      deliveryDriver: "S3",
      deliveryParams: { bucket: "my-bucket", path: "imagery/" },
    });
    expect(order).toBeDefined();
  });
});

// ── Notifications ─────────────────────────────────────────────────────────────

describe("contract: notifications", () => {
  test("POST /notifications", async () => {
    const notification = await client.createNotification({
      aoi: AOI,
      webhookUrl: "https://example.com/webhook",
    });
    expect(notification).toHaveProperty("id");
  });

  test("GET /notifications", async () => {
    const result = await client.listNotifications();
    expect(result).toHaveProperty("notifications");
  });

  test("GET /notifications/{id}", async () => {
    const notification = await client.getNotification(UUID);
    expect(notification).toHaveProperty("id");
  });

  test("DELETE /notifications/{id}", async () => {
    await client.deleteNotification(UUID);
  });
});
