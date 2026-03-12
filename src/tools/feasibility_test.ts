import { describe, expect, test } from "bun:test";
import { registerFeasibilityTools } from "./feasibility.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerFeasibilityTools", () => {
  test("submits and polls feasibility then normalizes opportunities", async () => {
    const harness = createToolHarness();
    const client = {
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
});
