/**
 * MCP tool: `location_resolve`
 *
 * Bridges the gap between human-readable place names and the WKT polygon
 * strings that the SkyFi API requires as area-of-interest (AOI) parameters.
 *
 * Without this tool, an AI would need to either ask the user for a WKT
 * polygon (unfriendly) or attempt to construct one from coordinates it may
 * hallucinate (unreliable). Instead, the AI calls `location_resolve` first
 * with a natural-language place description, receives a `wktPolygon` for each
 * candidate match, and passes the appropriate WKT directly to tools like
 * `archives_search` or `feasibility_check`.
 *
 * Architecture:
 * - Geocoding is delegated entirely to `src/client/osm.ts` (Nominatim).
 * - This tool does not receive a `SkyFiClient` because the SkyFi API is not
 *   involved — OpenStreetMap is the only external dependency.
 * - Up to 5 candidate results are returned so the AI can select the most
 *   appropriate match based on context (e.g. distinguishing "Paris, France"
 *   from "Paris, Texas").
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLocation, bboxToWkt } from "../client/osm.js";

/**
 * Register the `location_resolve` tool on the given MCP server.
 *
 * The tool is read-only — it queries OpenStreetMap but modifies no state.
 *
 * @param server - The MCP server instance to register the tool on.
 */
export function registerLocationTools(server: McpServer) {
  server.registerTool(
    "location_resolve",
    {
      title: "Resolve Location",
      description:
        "Resolve a place name to geographic coordinates and bounding box using OpenStreetMap. Returns a WKT POLYGON that can be used directly as the 'aoi' parameter in other tools like archives_search.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Place name or address to look up (e.g. 'downtown Kyiv', 'Central Park New York')",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const results = await resolveLocation(query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for "${query}". Try a more specific or different place name.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                query,
                results: results.map((r) => ({
                  name: r.displayName,
                  lat: r.lat,
                  lon: r.lon,
                  // WHY: Expose the bounding box as named cardinal directions rather
                  // than an index-based tuple so the AI can reason about which edge
                  // is which without needing to remember the [south,north,west,east]
                  // ordering convention.
                  boundingBox: {
                    south: r.boundingBox[0],
                    north: r.boundingBox[1],
                    west: r.boundingBox[2],
                    east: r.boundingBox[3],
                  },
                  // WHY: Include the pre-converted WKT so the AI can pass it directly
                  // to another tool without a round-trip conversion call.
                  wktPolygon: bboxToWkt(r.boundingBox),
                  type: r.type,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
