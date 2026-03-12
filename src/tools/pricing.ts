/**
 * MCP tool: `pricing_get`
 *
 * Exposes the SkyFi pricing matrix as an MCP tool. An AI can use this tool
 * to retrieve cost information before recommending or placing an order, helping
 * users make informed purchasing decisions.
 *
 * The pricing response structure is provider- and region-dependent, so it is
 * returned verbatim rather than being projected to a fixed schema. This keeps
 * the tool forward-compatible with pricing matrix changes on the SkyFi platform.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

/**
 * Register the `pricing_get` tool on the given MCP server.
 *
 * The tool is read-only — it retrieves pricing data without modifying any state
 * or consuming credits.
 *
 * @param server - The MCP server instance to register the tool on.
 * @param client - Authenticated SkyFi API client used to fetch pricing data.
 */
export function registerPricingTools(server: McpServer, client: SkyFiClient) {
  server.registerTool(
    "pricing_get",
    {
      title: "Get Pricing",
      description:
        "Get the SkyFi pricing matrix. Optionally scope to an AOI for area-specific pricing.",
      inputSchema: {
        aoi: z
          .string()
          .optional()
          .describe(
            "Optional area of interest as WKT POLYGON for area-specific pricing",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ aoi }) => {
      const result = await client.getPricing(aoi ? { aoi } : undefined);
      return {
        content: [
          {
            type: "text" as const,
            // WHY: Pass through verbatim rather than projecting. Pricing structure
            // varies by provider and is subject to change; a fixed projection would
            // silently drop fields that the AI might need.
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
