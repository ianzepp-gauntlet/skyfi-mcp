import { describe, expect, test } from "bun:test";
import { createWorkerFetch } from "./worker_routes.js";

describe("worker fetch", () => {
  test("health endpoint returns ok", async () => {
    const fetch = createWorkerFetch({
      createAlertStore: () => ({
        add: () => undefined,
        get: () => [],
        getAll: () => [],
        clear: () => undefined,
      }),
      createMcpHandler: () => async () => new Response("mcp"),
    });

    const response = await fetch(
      new Request("http://localhost/health"),
      {} as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("webhook endpoint persists alerts using notification_id", async () => {
    const seen: Array<{ monitorId: string; payload: Record<string, unknown> }> =
      [];
    const fetch = createWorkerFetch({
      createAlertStore: () => ({
        add: async (monitorId, payload) => {
          seen.push({ monitorId, payload });
        },
        get: () => [],
        getAll: () => [],
        clear: () => undefined,
      }),
      createMcpHandler: () => async () => new Response("mcp"),
    });

    const response = await fetch(
      new Request("http://localhost/webhooks/aoi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notification_id: "mon-123", event: "match" }),
      }),
      {} as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([
      {
        monitorId: "mon-123",
        payload: { notification_id: "mon-123", event: "match" },
      },
    ]);
  });

  test("unknown routes return 404", async () => {
    const fetch = createWorkerFetch({
      createAlertStore: () => ({
        add: () => undefined,
        get: () => [],
        getAll: () => [],
        clear: () => undefined,
      }),
      createMcpHandler: () => async () => new Response("mcp"),
    });

    const response = await fetch(
      new Request("http://localhost/nope"),
      {} as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
  });
});
