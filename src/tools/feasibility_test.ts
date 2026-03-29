import { describe, expect, test } from "bun:test";
import {
  FeasibilityJobStore,
  registerFeasibilityTools,
} from "./feasibility.js";
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

  test("feasibility_submit returns a job id for a batch of AOIs", async () => {
    const harness = createToolHarness();
    const seen: Array<Record<string, unknown>> = [];
    let callIndex = 0;
    const jobStore = new FeasibilityJobStore();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async (params: Record<string, unknown>) => {
        seen.push(params);
        return {
          feasibility_id: `f-${callIndex++}`,
          status: "PENDING",
        };
      },
      getFeasibilityStatus: async () => ({
        feasibility_id: "unused",
        status: "COMPLETE",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-a",
    });

    const result = parseToolJson(
      await harness.invoke("feasibility_submit", {
        aois: [
          { aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" },
          {
            aoi: "POLYGON((1 0,2 0,2 1,1 1,1 0))",
            chunk_index: 1,
            corridor_length_meters: 9000,
            polygon_vertex_count: 5,
          },
        ],
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "HIGH",
      }),
    );

    expect(result.request_count).toBe(2);
    expect(result.job_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.job_id).not.toMatch(/^feas-job-/);
    expect(result.queued_count).toBe(2);
    expect(seen.length).toBeGreaterThan(0);
  });

  test("feasibility_submit normalizes underscore resolution aliases before calling the client", async () => {
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
      getFeasibilityStatus: async () => ({
        feasibility_id: "f-2",
        status: "COMPLETED",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    await harness.invoke("feasibility_submit", {
      aois: [{ aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      product_type: "DAY",
      resolution: "ULTRA_HIGH",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ resolution: "ULTRA HIGH" });
  });

  test("feasibility_submit forwards optional feasibility constraints to the client", async () => {
    const harness = createToolHarness();
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async (params: Record<string, unknown>) => {
        seen.push(params);
        return {
          feasibility_id: "f-opts",
          status: "PENDING",
        };
      },
      getFeasibilityStatus: async () => ({
        feasibility_id: "f-opts",
        status: "COMPLETE",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any);

    await harness.invoke("feasibility_submit", {
      aois: [{ aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      product_type: "DAY",
      resolution: "VERY_HIGH",
      max_cloud_coverage_percent: 100,
      priority_item: true,
      required_provider: "SIWEI",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      resolution: "VERY HIGH",
      maxCloudCoveragePercent: 100,
      priorityItem: true,
      requiredProvider: "SIWEI",
    });
  });

  test("feasibility_status returns job-backed statuses and adds a useful hint when no opportunities are returned", async () => {
    const harness = createToolHarness();
    const jobStore = new FeasibilityJobStore();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async () => ({
        feasibility_id: "f-hint-1",
        status: "PENDING",
      }),
      getFeasibilityStatus: async () => ({
        feasibility_id: "f-hint-1",
        status: "COMPLETE",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-a",
    });

    const submit = parseToolJson(
      await harness.invoke("feasibility_submit", {
        aois: [
          {
            aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
          },
        ],
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "VERY_HIGH",
      }),
    );

    const result = parseToolJson(
      await harness.invoke("feasibility_status", {
        job_id: submit.job_id,
      }),
    );

    expect(result.request_count).toBe(1);
    expect(result.requests[0].opportunities).toEqual([]);
    expect(result.requests[0].message).toContain("passes_predict");
    expect(result.requests[0].feasibility_id).toBe("f-hint-1");
    expect(result.requests[0].chunk_index).toBeUndefined();
    expect(Object.keys(result)).toEqual([
      "job_id",
      "created_at",
      "updated_at",
      "request_count",
      "status",
      "feasible_count",
      "failed_count",
      "total_opportunity_count",
      "complete_count",
      "started_count",
      "requests",
    ]);
    expect(Object.keys(result.requests[0])).toEqual([
      "aoi",
      "feasibility_id",
      "status",
      "opportunity_count",
      "opportunities",
      "message",
      "providers",
    ]);
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
    expect(result.chunks[0].area_sqkm).toBeGreaterThan(0);
  });

  test("corridor_chunk enforces max_chunk_area_sqkm when requested", async () => {
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
          { lat: 30, lon: -96.8 },
        ],
        corridor_width_meters: 1000,
        max_chunk_length_meters: 20000,
        max_chunk_area_sqkm: 5,
      }),
    );

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.maxChunkAreaSqKm).toBe(5);
    expect(result.chunks.every((chunk: any) => chunk.area_sqkm <= 5.01)).toBe(
      true,
    );
  });

  test("corridor_chunk output can be passed directly to feasibility_submit", async () => {
    const harness = createToolHarness();
    const seen: Array<Record<string, unknown>> = [];
    let callIndex = 0;
    const jobStore = new FeasibilityJobStore();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async (params: Record<string, unknown>) => {
        seen.push(params);
        return {
          feasibility_id: `f-${callIndex++}`,
          status: "PENDING",
        };
      },
      getFeasibilityStatus: async (feasibilityId: string) => ({
        feasibility_id: feasibilityId,
        status: feasibilityId === "f-0" ? "COMPLETE" : "NO_OPPORTUNITY",
        opportunities:
          feasibilityId === "f-0" ? [{ providerWindowId: "pw-1" }] : [],
      }),
    };

    registerFeasibilityTools(harness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-a",
    });

    const result = parseToolJson(
      await harness.invoke("feasibility_submit", {
        aois: [
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

    expect(result.request_count).toBe(2);
    expect(result.job_id).not.toMatch(/^feas-job-/);
    expect(seen.every((call) => call.resolution === "VERY HIGH")).toBe(true);
    expect(seen.every((call) => typeof call.aoi === "string")).toBe(true);
  });

  test("feasibility_status keeps later results when one request fails", async () => {
    const harness = createToolHarness();
    let callIndex = 0;
    const jobStore = new FeasibilityJobStore();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async () => ({
        feasibility_id: `f-${callIndex++}`,
        status: "PENDING",
      }),
      getFeasibilityStatus: async (feasibilityId: string) => {
        if (feasibilityId === "f-1") {
          throw new Error("upstream timeout");
        }
        return {
          feasibility_id: feasibilityId,
          status: "COMPLETE",
          opportunities: [{ providerWindowId: `pw-${feasibilityId}` }],
        };
      },
    };

    registerFeasibilityTools(harness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-a",
    });

    const submit = parseToolJson(
      await harness.invoke("feasibility_submit", {
        aois: [
          {
            chunk_index: 0,
            aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
          },
          {
            chunk_index: 1,
            aoi: "POLYGON((1 0,2 0,2 1,1 1,1 0))",
          },
          {
            chunk_index: 2,
            aoi: "POLYGON((2 0,3 0,3 1,2 1,2 0))",
          },
        ],
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "VERY_HIGH",
      }),
    );

    const result = parseToolJson(
      await harness.invoke("feasibility_status", {
        job_id: submit.job_id,
      }),
    );

    expect(result.request_count).toBe(3);
    expect(result.feasible_count).toBe(2);
    expect(result.failed_count).toBe(1);
    expect(result.total_opportunity_count).toBe(2);
    expect(result.requests[1].status).toBe("ERROR");
    expect(result.requests[1].opportunities).toEqual([]);
    expect(result.requests[1].error).toBe("upstream timeout");
    expect(result.requests[2].feasibility_id).toBe("f-2");
    expect(result.requests[2].opportunity_count).toBe(1);
  });

  test("feasibility_status rejects wrong-owner and missing jobs with the same error", async () => {
    const submitHarness = createToolHarness();
    const foreignHarness = createToolHarness();
    const missingHarness = createToolHarness();
    const jobStore = new FeasibilityJobStore();
    const client = {
      getPassPrediction: async () => ({}),
      checkFeasibility: async () => ({
        feasibility_id: "f-owned",
        status: "PENDING",
      }),
      getFeasibilityStatus: async () => ({
        feasibility_id: "f-owned",
        status: "COMPLETE",
        opportunities: [],
      }),
    };

    registerFeasibilityTools(submitHarness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-a",
    });
    registerFeasibilityTools(foreignHarness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-b",
    });
    registerFeasibilityTools(missingHarness.server as any, client as any, {
      jobStore,
      ownerKey: "owner-b",
    });

    const submit = parseToolJson(
      await submitHarness.invoke("feasibility_submit", {
        aois: [{ aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
        product_type: "DAY",
        resolution: "HIGH",
      }),
    );

    await expect(
      foreignHarness.invoke("feasibility_status", { job_id: submit.job_id }),
    ).rejects.toThrow("Feasibility job not found.");
    await expect(
      missingHarness.invoke("feasibility_status", {
        job_id: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow("Feasibility job not found.");
  });
});
