import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

export function registerSearchTools(server: McpServer, client: SkyFiClient) {
  server.registerTool("search_imagery", {
    title: "Search Satellite Imagery",
    description:
      "Search the SkyFi satellite imagery catalog. Provide an area of interest as a WKT polygon, date range, and optional filters. Returns matching archive imagery with metadata and pricing.",
    inputSchema: {
      aoi: z.string().describe("Area of interest as WKT POLYGON string"),
      fromDate: z.string().describe("Start date (ISO 8601, e.g. 2024-01-01)"),
      toDate: z.string().describe("End date (ISO 8601, e.g. 2024-06-01)"),
      maxCloudCoveragePercent: z.number().optional().describe("Max cloud cover percentage (0-100)"),
      maxOffNadirAngle: z.number().optional().describe("Max off-nadir angle in degrees"),
      resolutions: z.array(z.string()).optional().describe("Resolution filters (e.g. LOW, HIGH, VERY_HIGH)"),
      productTypes: z.array(z.string()).optional().describe("Product type filters (e.g. DAY, MULTISPECTRAL, SAR)"),
      pageSize: z.number().optional().describe("Results per page (default 25)"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ aoi, fromDate, toDate, ...rest }) => {
    const result = await client.searchArchives({ aoi, fromDate, toDate, ...rest });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total: result.total,
          count: result.archives.length,
          archives: result.archives.map((a) => ({
            archiveId: a.archiveId,
            provider: a.provider,
            constellation: a.constellation,
            productType: a.productType,
            resolution: a.resolution,
            captureDate: a.captureTimestamp,
            cloudCover: `${a.cloudCoveragePercent}%`,
            gsd: `${a.gsd}m`,
            area: `${a.totalAreaSquareKm} km²`,
            pricePerKm2: `$${a.priceForOneSquareKm}`,
            deliveryTime: `${a.deliveryTimeHours}h`,
          })),
          hasMore: !!result.next_page,
        }, null, 2),
      }],
    };
  });
}
