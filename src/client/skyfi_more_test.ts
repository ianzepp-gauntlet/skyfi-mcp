import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SkyFiClient } from "./skyfi.js";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
type TestHeaders = Record<string, string>;
type TimeoutCallback = (...args: unknown[]) => void;

function asFetchMock(
  fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(fn, {
    preconnect: () => Promise.resolve(),
  }) as typeof fetch;
}

describe("SkyFiClient request and wrappers", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("constructor normalizes trailing slash and omits undefined query params", async () => {
    let seenUrl = "";
    globalThis.fetch = asFetchMock(async (url: string | URL | Request) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com/",
    });
    await client.listOrders({
      orderType: "TASKING",
      pageNumber: undefined,
      pageSize: 10,
    });

    expect(seenUrl).toBe(
      "https://api.example.com/orders?orderType=TASKING&pageSize=10",
    );
  });

  test("sets content-type only when request has a body", async () => {
    const headersSeen: Array<TestHeaders | undefined> = [];
    globalThis.fetch = asFetchMock(async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      headersSeen.push(init?.headers as TestHeaders | undefined);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    await client.getOrder("ord-1");
    await client.createTaskingOrder({
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      windowStart: "2026-01-01T00:00:00Z",
      windowEnd: "2026-01-02T00:00:00Z",
      productType: "DAY",
      resolution: "HIGH",
      deliveryDriver: "S3",
      deliveryParams: { bucket: "b" },
    } as any);

    const first = headersSeen[0] as Record<string, string>;
    const second = headersSeen[1] as Record<string, string>;
    expect(first["X-Skyfi-Api-Key"]).toBe("k");
    expect(first["Content-Type"]).toBeUndefined();
    expect(second["Content-Type"]).toBe("application/json");
  });

  test("throws detailed error on non-2xx", async () => {
    globalThis.fetch = asFetchMock(
      async () => new Response("boom", { status: 500 }),
    );

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    await expect(client.whoami()).rejects.toThrow(
      "SkyFi API GET /auth/whoami failed (500): boom",
    );
  });

  test("throws for empty 200 body", async () => {
    globalThis.fetch = asFetchMock(async () => new Response("", { status: 200 }));

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    await expect(client.whoami()).rejects.toThrow("returned empty body (200)");
  });

  test("pollFeasibility returns terminal status before timeout", async () => {
    const statuses = [
      { feasibility_id: "f1", status: "PENDING" },
      { feasibility_id: "f1", status: "PROCESSING" },
      { feasibility_id: "f1", status: "FEASIBLE", opportunities: [1] },
    ];

    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify(statuses.shift() ?? statuses[statuses.length - 1]),
        {
          status: 200,
        },
      ));

    globalThis.setTimeout = ((fn: TimeoutCallback) => {
      if (typeof fn === "function") fn();
      return 0 as any;
    }) as typeof setTimeout;

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    const result = await client.pollFeasibility("f1", {
      intervalMs: 1,
      timeoutMs: 50,
    });
    expect(result.status).toBe("FEASIBLE");
  });

  test("pollFeasibility returns early when opportunities exist even if providers are still pending", async () => {
    const statuses = [
      {
        id: "f2",
        validUntil: "2026-03-22T00:00:00Z",
        overallScore: {
          feasibility: -1,
          providerScore: {
            score: -1,
            providerScores: [
              {
                provider: "PLANET",
                status: "STARTED",
                opportunities: [],
              },
            ],
          },
        },
      },
      {
        id: "f2",
        validUntil: "2026-03-22T00:00:00Z",
        overallScore: {
          feasibility: -1,
          providerScore: {
            score: -1,
            providerScores: [
              {
                provider: "SIWEI",
                status: "PENDING",
                opportunities: [],
              },
              {
                provider: "PLANET",
                status: "COMPLETE",
                opportunities: [{ providerWindowId: "pw-early" }],
              },
            ],
          },
        },
      },
    ];
    let callIndex = 0;

    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify(statuses[Math.min(callIndex++, statuses.length - 1)]),
        { status: 200 },
      ));

    globalThis.setTimeout = ((fn: TimeoutCallback) => {
      if (typeof fn === "function") fn();
      return 0 as any;
    }) as typeof setTimeout;

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    const result = await client.pollFeasibility("f2", {
      intervalMs: 1,
      timeoutMs: 50,
    });

    expect(result.opportunities).toEqual([
      {
        provider: "PLANET",
        status: "COMPLETE",
        providerWindowId: "pw-early",
      },
    ]);
  });

  test("checkFeasibility normalizes spec-shaped id to feasibility_id", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify({
          id: "f-spec-1",
          validUntil: "2026-03-22T00:00:00Z",
          overallScore: null,
        }),
        { status: 200 },
      ));

    const client = new SkyFiClient({
      apiKey: "test-key",
      baseUrl: "https://example.com",
    });

    const result = await client.checkFeasibility({
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      startDate: "2026-03-15T00:00:00Z",
      endDate: "2026-03-22T00:00:00Z",
      productType: "DAY",
      resolution: "HIGH",
    });

    expect(result.feasibility_id).toBe("f-spec-1");
    expect(result.status).toBe("STARTED");
  });

  test("checkFeasibility throws when the upstream response omits an id", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify({
          validUntil: "2026-03-22T00:00:00Z",
          overallScore: null,
        }),
        { status: 200 },
      ));

    const client = new SkyFiClient({
      apiKey: "test-key",
      baseUrl: "https://example.com",
    });

    await expect(
      client.checkFeasibility({
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        startDate: "2026-03-15T00:00:00Z",
        endDate: "2026-03-22T00:00:00Z",
        productType: "DAY",
        resolution: "HIGH",
      }),
    ).rejects.toThrow("missing feasibility_id");
  });

  test("getFeasibilityStatus flattens provider opportunities from spec-shaped payload", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify({
          id: "f-spec-2",
          validUntil: "2026-03-22T00:00:00Z",
          overallScore: {
            feasibility: 0.8,
            providerScore: {
              score: 0.8,
              providerScores: [
                {
                  provider: "PLANET",
                  status: "COMPLETE",
                  opportunities: [
                    {
                      providerWindowId: "pw-1",
                      windowStart: "2026-03-20T00:00:00Z",
                      windowEnd: "2026-03-20T01:00:00Z",
                    },
                  ],
                },
              ],
            },
          },
        }),
        { status: 200 },
      ));

    const client = new SkyFiClient({
      apiKey: "test-key",
      baseUrl: "https://example.com",
    });

    const result = await client.getFeasibilityStatus("f-spec-2");

    expect(result.status).toBe("COMPLETE");
    expect(result.opportunities).toEqual([
      {
        provider: "PLANET",
        status: "COMPLETE",
        providerWindowId: "pw-1",
        windowStart: "2026-03-20T00:00:00Z",
        windowEnd: "2026-03-20T01:00:00Z",
      },
    ]);
  });

  test("getFeasibilityStatus treats provider-level pending rows as non-terminal", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify({
          id: "f-spec-3",
          validUntil: "2026-03-22T00:00:00Z",
          overallScore: {
            feasibility: -1,
            providerScore: {
              score: -1,
              providerScores: [
                {
                  provider: "SIWEI",
                  status: "PENDING",
                  opportunities: [],
                },
                {
                  provider: "PLANET",
                  status: "COMPLETE",
                  opportunities: [
                    {
                      providerWindowId: "pw-2",
                    },
                  ],
                },
              ],
            },
          },
        }),
        { status: 200 },
      ));

    const client = new SkyFiClient({
      apiKey: "test-key",
      baseUrl: "https://example.com",
    });

    const result = await client.getFeasibilityStatus("f-spec-3");

    expect(result.status).toBe("PENDING");
    expect(result.opportunities).toEqual([
      {
        provider: "PLANET",
        status: "COMPLETE",
        providerWindowId: "pw-2",
      },
    ]);
  });
});

describe("SkyFiClient request and wrappers (additional)", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("calls expected methods and paths across wrapper methods", async () => {
    const calls: Array<{ method: string; path: string }> = [];

    globalThis.fetch = asFetchMock(async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const parsed = new URL(String(url));
      const path = `${parsed.pathname}${parsed.search}`;
      calls.push({
        method: String(init?.method ?? "GET"),
        path,
      });
      if (path === "/feasibility" || path === "/feasibility/f-1") {
        return new Response(
          JSON.stringify({
            id: "f-1",
            validUntil: "2026-03-22T00:00:00Z",
            overallScore: null,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });

    await client.searchArchives({
      aoi: "A",
      fromDate: "2026-01-01",
      toDate: "2026-01-02",
    } as any);
    await client.getArchivesPage("cursor-1");
    await client.getArchive("arc-1");
    await client.getPricing({ aoi: "A" });
    await client.checkFeasibility({
      aoi: "A",
      startDate: "w1",
      endDate: "w2",
      productType: "DAY",
      resolution: "HIGH",
    } as any);
    await client.getFeasibilityStatus("f-1");
    await client.getPassPrediction({
      aoi: "A",
      fromDate: "w1",
      toDate: "w2",
    } as any);
    await client.createArchiveOrder({
      aoi: "A",
      archiveId: "arc-1",
      deliveryDriver: "S3",
      deliveryParams: { bucket: "b" },
    } as any);
    await client.createTaskingOrder({
      aoi: "A",
      windowStart: "w1",
      windowEnd: "w2",
      productType: "DAY",
      resolution: "HIGH",
      deliveryDriver: "S3",
      deliveryParams: { bucket: "b" },
    } as any);
    await client.redeliverOrder("ord-1", {
      deliveryDriver: "S3",
      deliveryParams: { bucket: "b" },
    });
    await client.listNotifications(0, 10);
    await client.getNotification("n-1");

    expect(calls).toEqual([
      { method: "POST", path: "/archives" },
      { method: "GET", path: "/archives?page=cursor-1" },
      { method: "GET", path: "/archives/arc-1" },
      { method: "POST", path: "/pricing" },
      { method: "POST", path: "/feasibility" },
      { method: "GET", path: "/feasibility/f-1" },
      { method: "POST", path: "/feasibility/pass-prediction" },
      { method: "POST", path: "/order-archive" },
      { method: "POST", path: "/order-tasking" },
      { method: "POST", path: "/orders/ord-1/redelivery" },
      { method: "GET", path: "/notifications?pageNumber=0&pageSize=10" },
      { method: "GET", path: "/notifications/n-1" },
    ]);
  });

  test("pollFeasibility returns final pending status when timeout is reached", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(
        JSON.stringify({
          id: "f2",
          validUntil: "2026-03-22T00:00:00Z",
          overallScore: null,
        }),
        {
          status: 200,
        },
      ));

    globalThis.setTimeout = ((fn: TimeoutCallback) => {
      if (typeof fn === "function") fn();
      return 0 as any;
    }) as typeof setTimeout;

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });
    const result = await client.pollFeasibility("f2", {
      intervalMs: 1,
      timeoutMs: 1,
    });
    expect(result.status).toBe("STARTED");
  });
});

describe("SkyFiClient notification endpoints", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("createNotification and deleteNotification hit notification endpoints", async () => {
    const calls: Array<{ method: string; path: string }> = [];

    globalThis.fetch = asFetchMock(async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const parsed = new URL(String(url));
      calls.push({
        method: String(init?.method ?? "GET"),
        path: `${parsed.pathname}${parsed.search}`,
      });

      if (String(init?.method ?? "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({ id: "n-1" }), { status: 200 });
    });

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });

    const created = await client.createNotification({
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      webhookUrl: "https://example.com/webhook",
    } as any);
    await client.deleteNotification("n-1");

    expect(created.id).toBe("n-1");
    expect(calls).toEqual([
      { method: "POST", path: "/notifications" },
      { method: "DELETE", path: "/notifications/n-1" },
    ]);
  });
});

describe("SkyFiClient deliverable download endpoint", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("getOrderDeliverableUrl returns redirect location header", async () => {
    globalThis.fetch = asFetchMock(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: "https://signed.example.com/file.tif",
        },
      }));

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });

    const url = await client.getOrderDeliverableUrl("ord-1", "image");
    expect(url).toBe("https://signed.example.com/file.tif");
  });

  test("getOrderDeliverableUrl throws when redirect location is missing", async () => {
    globalThis.fetch = asFetchMock(
      async () => new Response(null, { status: 200 }),
    );

    const client = new SkyFiClient({
      apiKey: "k",
      baseUrl: "https://api.example.com",
    });

    await expect(
      client.getOrderDeliverableUrl("ord-1", "image"),
    ).rejects.toThrow("did not return a redirect location");
  });
});
