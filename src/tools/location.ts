import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLocation, bboxToWkt } from "../client/osm.js";

export function registerLocationTools(server: McpServer) {
  server.registerTool("resolve_location", {
    title: "Resolve Location",
    description:
      "Resolve a place name to geographic coordinates and bounding box using OpenStreetMap. Returns a WKT POLYGON that can be used directly as the 'aoi' parameter in other tools like search_imagery.",
    inputSchema: {
      query: z.string().describe("Place name or address to look up (e.g. 'downtown Kyiv', 'Central Park New York')"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const results = await resolveLocation(query);

    if (results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `No results found for "${query}". Try a more specific or different place name.`,
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          query,
          results: results.map((r) => ({
            name: r.displayName,
            lat: r.lat,
            lon: r.lon,
            boundingBox: {
              south: r.boundingBox[0],
              north: r.boundingBox[1],
              west: r.boundingBox[2],
              east: r.boundingBox[3],
            },
            wktPolygon: bboxToWkt(r.boundingBox),
            type: r.type,
          })),
        }, null, 2),
      }],
    };
  });
}
