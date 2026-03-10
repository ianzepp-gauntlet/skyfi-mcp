import { describe, expect, test } from "bun:test";
import { registerSearchTools } from "./search.js";
import { createToolHarness } from "./test_harness.js";

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerSearchTools", () => {
  test("uses initial search path when page is absent", async () => {
    const harness = createToolHarness();
    const calls: string[] = [];
    const client = {
      searchArchives: async (params: any) => {
        calls.push(`search:${params.aoi}`);
        return {
          total: 1,
          archives: [
            {
              archiveId: "a-1",
              provider: "prov",
              constellation: "const",
              productType: "DAY",
              resolution: "HIGH",
              captureTimestamp: "2026-01-01T00:00:00Z",
              cloudCoveragePercent: 20,
              gsd: 0.5,
              totalAreaSquareKm: 12,
              priceForOneSquareKm: 1.25,
              deliveryTimeHours: 12,
            },
          ],
          next_page: null,
        };
      },
      getArchivesPage: async () => {
        throw new Error("should not call");
      },
    };

    registerSearchTools(harness.server as any, client as any);

    const result = parseToolJson(
      await harness.invoke("search_imagery", {
        aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
        fromDate: "2026-01-01",
        toDate: "2026-01-02",
      })
    );

    expect(calls).toHaveLength(1);
    expect(result.archives[0].cloudCover).toBe("20%");
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
  });

  test("uses pagination path when page is present", async () => {
    const harness = createToolHarness();
    const calls: string[] = [];
    const client = {
      searchArchives: async () => {
        throw new Error("should not call");
      },
      getArchivesPage: async (page: string) => {
        calls.push(page);
        return { total: 0, archives: [], next_page: "next-2" };
      },
    };

    registerSearchTools(harness.server as any, client as any);

    const result = parseToolJson(await harness.invoke("search_imagery", { page: "cursor-1" }));
    expect(calls).toEqual(["cursor-1"]);
    expect(result.hasMore).toBe(true);
    expect(result.nextPage).toBe("next-2");
  });
});
