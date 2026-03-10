import { describe, expect, test } from "bun:test";
import { registerPricingTools } from "./pricing.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerPricingTools", () => {
  test("passes undefined when no AOI is provided", async () => {
    const harness = createToolHarness();
    const calls: any[] = [];
    const client = {
      getPricing: async (arg: any) => {
        calls.push(arg);
        return { currency: "USD" };
      },
    };

    registerPricingTools(harness.server as any, client as any);

    const result = parseToolJson(await harness.invoke("get_pricing", {}));
    expect(result.currency).toBe("USD");
    expect(calls).toEqual([undefined]);
  });

  test("passes AOI object when provided", async () => {
    const harness = createToolHarness();
    const calls: any[] = [];
    const client = {
      getPricing: async (arg: any) => {
        calls.push(arg);
        return { ok: true };
      },
    };

    registerPricingTools(harness.server as any, client as any);

    await harness.invoke("get_pricing", { aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" });
    expect(calls).toEqual([{ aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }]);
  });
});
