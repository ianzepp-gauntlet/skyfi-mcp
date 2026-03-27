import { describe, expect, test } from "bun:test";
import { registerFeasibilityTools } from "./feasibility.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerFeasibilityTools", () => {
  test("passes_predict forwards AOI and date window to the client", async () => {
    const harness = createToolHarness();
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      getPassPrediction: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { opportunities: [{ providerWindowId: "pw-1" }] };
      },
      checkFeasibility: async () => ({
        feasibility_id: "unused",
        status: "PENDING",
      }),
      pollFeasibility: async () => ({
        feasibility_id: "unused",
        status: "COMPLETED",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    const raw = await harness.invoke("passes_predict", {
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      from_date: "2026-01-01T00:00:00Z",
      to_date: "2026-01-02T00:00:00Z",
    });
    const result = parseToolJson(raw);

    expect(result.opportunities).toEqual([{ providerWindowId: "pw-1" }]);
    expect(calls).toEqual([
      {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        fromDate: "2026-01-01T00:00:00Z",
        toDate: "2026-01-02T00:00:00Z",
      },
    ]);
  });

  test("submits and polls feasibility then normalizes opportunities", async () => {
    const harness = createToolHarness();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async () => ({
        feasibility_id: "f-1",
        status: "PENDING",
      }),
      pollFeasibility: async () => ({
        feasibility_id: "f-1",
        status: "NO_OPPORTUNITY",
        message: "none",
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("feasibility_check", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "HIGH",
      }),
    );

    expect(result.feasibilityId).toBe("f-1");
    expect(result.opportunities).toEqual([]);
  });

  test("normalizes underscore resolution aliases before calling the client", async () => {
    const harness = createToolHarness();
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async (params: Record<string, unknown>) => {
        seen.push(params);
        return {
          feasibility_id: "f-2",
          status: "PENDING",
        };
      },
      pollFeasibility: async () => ({
        feasibility_id: "f-2",
        status: "COMPLETED",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    await harness.invoke("feasibility_check", {
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      product_type: "DAY",
      resolution: "ULTRA_HIGH",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ resolution: "ULTRA HIGH" });
  });

  test("corridor_chunk returns reusable chunk AOIs for a route", async () => {
    const harness = createToolHarness();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async () => ({
        feasibility_id: "unused",
        status: "PENDING",
      }),
      pollFeasibility: async () => ({
        feasibility_id: "unused",
        status: "COMPLETE",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("corridor_chunk", {
        route: [
          { lat: 30, lon: -97 },
          { lat: 30, lon: -96.7 },
        ],
        corridor_width_meters: 1000,
        max_chunk_length_meters: 10000,
      }),
    );

    expect(result.chunkCount).toBeGreaterThan(2);
    expect(result.chunks[0].aoi.startsWith("POLYGON((")).toBe(true);
    expect(result.chunks[0].chunk_index).toBe(0);
    expect(result.chunks[0].corridor_length_meters).toBeGreaterThan(0);
  });

  test("feasibility_check_chunks runs feasibility_check semantics for each provided chunk", async () => {
    const harness = createToolHarness();
    const seen: Array<Record<string, unknown>> = [];
    let callIndex = 0;
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async (params: Record<string, unknown>) => {
        seen.push(params);
        return {
          feasibility_id: `f-${callIndex++}`,
          status: "PENDING",
        };
      },
      pollFeasibility: async (feasibilityId: string) => ({
        feasibility_id: feasibilityId,
        status: feasibilityId === "f-0" ? "COMPLETE" : "NO_OPPORTUNITY",
        opportunities:
          feasibilityId === "f-0" ? [{ providerWindowId: "pw-1" }] : [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("feasibility_check_chunks", {
        chunks: [
          {
            chunk_index: 0,
            corridor_length_meters: 10000,
            polygon_vertex_count: 5,
            aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
          },
          {
            chunk_index: 1,
            corridor_length_meters: 9000,
            polygon_vertex_count: 5,
            aoi: "POLYGON((1 0,2 0,2 1,1 1,1 0))",
          },
        ],
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "VERY_HIGH",
      }),
    );

    expect(result.chunkCount).toBe(2);
    expect(result.feasibleChunkCount).toBe(1);
    expect(result.totalOpportunityCount).toBe(1);
    expect(result.chunks[0].aoi).toBe("POLYGON((0 0,1 0,1 1,0 1,0 0))");
    expect(seen.every((call) => call.resolution === "VERY HIGH")).toBe(true);
    expect(seen.every((call) => typeof call.aoi === "string")).toBe(true);
    expect(result.chunks[0].feasibilityId).toBe("f-0");
  });
});
