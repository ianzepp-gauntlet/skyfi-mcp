/**
 * Unit tests for ConfirmationStore.
 *
 * These tests verify the security-critical properties of the two-step order
 * confirmation flow:
 * - Tokens are single-use (double-submit is rejected).
 * - Tokens expire after the configured TTL (users can't confirm stale orders).
 * - Unknown tokens are rejected cleanly.
 *
 * Time is controlled by injecting a `now` parameter to `store` and `consume`,
 * which makes TTL-related tests deterministic without relying on real clock
 * time or `sleep` calls.
 */

import { test, expect, describe } from "bun:test";
import { ConfirmationStore } from "./confirmation.js";

describe("ConfirmationStore", () => {
  test("store returns a token and consume retrieves the order", () => {
    const store = new ConfirmationStore();
    const token = store.store({
      type: "archive",
      params: {
        aoi: "POLYGON(...)",
        archiveId: "abc",
        deliveryDriver: "S3",
        deliveryParams: { bucket: "b" },
      },
      pricingSummary: "{}",
    });

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const order = store.consume(token);
    expect(order).toBeDefined();
    expect(order!.type).toBe("archive");
  });

  test("consume deletes the token (single-use)", () => {
    const store = new ConfirmationStore();
    const token = store.store({
      type: "archive",
      params: {
        aoi: "POLYGON(...)",
        archiveId: "abc",
        deliveryDriver: "S3",
        deliveryParams: { bucket: "b" },
      },
      pricingSummary: "{}",
    });

    store.consume(token);
    const second = store.consume(token);
    expect(second).toBeUndefined();
  });

  test("consume returns undefined for unknown token", () => {
    const store = new ConfirmationStore();
    expect(store.consume("nonexistent")).toBeUndefined();
  });

  test("expired tokens are cleaned up", () => {
    const store = new ConfirmationStore(1000); // 1 second TTL
    const now = Date.now();

    const token = store.store(
      {
        type: "tasking",
        params: {
          aoi: "POLYGON(...)",
          window_start: "2024-01-01",
          window_end: "2024-02-01",
          product_type: "DAY",
          resolution: "HIGH",
          deliveryDriver: "S3",
          deliveryParams: { bucket: "b" },
        },
        pricingSummary: "{}",
      },
      now,
    );

    expect(store.size).toBe(1);

    // Consume after TTL has passed
    const order = store.consume(token, now + 2000);
    expect(order).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test("non-expired tokens survive cleanup", () => {
    const store = new ConfirmationStore(10_000);
    const now = Date.now();

    const token = store.store(
      {
        type: "archive",
        params: {
          aoi: "POLYGON(...)",
          archiveId: "abc",
          deliveryDriver: "S3",
          deliveryParams: { bucket: "b" },
        },
        pricingSummary: "{}",
      },
      now,
    );

    const order = store.consume(token, now + 5000);
    expect(order).toBeDefined();
  });
});
