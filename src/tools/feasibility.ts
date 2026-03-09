import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

export function registerFeasibilityTools(server: McpServer, client: SkyFiClient) {
  server.registerTool("check_feasibility", {
    title: "Check Tasking Feasibility",
    description:
      "Check whether a satellite tasking order is feasible for a given area, time window, product type, and resolution. Submits the request and polls until results are available.",
    inputSchema: {
      aoi: z.string().describe("Area of interest as WKT POLYGON string"),
      window_start: z.string().describe("Start of capture window (ISO 8601)"),
      window_end: z.string().describe("End of capture window (ISO 8601)"),
      product_type: z.enum(["DAY", "MULTISPECTRAL", "SAR"]).describe("Product type"),
      resolution: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH", "ULTRA_HIGH"]).describe("Desired resolution"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ aoi, window_start, window_end, product_type, resolution }) => {
    const initial = await client.checkFeasibility({
      aoi,
      window_start,
      window_end,
      product_type,
      resolution,
    });

    const result = await client.pollFeasibility(initial.feasibility_id);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          feasibilityId: result.feasibility_id,
          status: result.status,
          opportunities: result.opportunities ?? [],
          message: result.message,
        }, null, 2),
      }],
    };
  });
}
