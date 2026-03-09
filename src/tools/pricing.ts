import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

export function registerPricingTools(server: McpServer, client: SkyFiClient) {
  server.registerTool("get_pricing", {
    title: "Get Pricing",
    description:
      "Get the SkyFi pricing matrix for satellite imagery. Optionally provide an AOI to get area-specific pricing. Returns pricing by product type, resolution, and provider.",
    inputSchema: {
      aoi: z.string().optional().describe("Optional area of interest as WKT POLYGON for area-specific pricing"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ aoi }) => {
    const result = await client.getPricing(aoi ? { aoi } : undefined);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });
}
