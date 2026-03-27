/**
 * MCP tool: `feasibility_check`
 *
 * Exposes the SkyFi tasking feasibility API as a single synchronous-feeling
 * MCP tool. Feasibility analysis determines whether any satellites have viable
 * collection opportunities over a specified AOI within a given capture window.
 *
 * The underlying SkyFi API is asynchronous: callers must submit a request and
 * then poll for results. This tool hides that async pattern by combining the
 * submit and poll steps, so the AI sees a single call-and-response interaction.
 *
 * Design notes:
 * - Polling is delegated to `SkyFiClient.pollFeasibility`, which owns the
 *   retry interval and timeout configuration. Tool code stays linear.
 * - `opportunities` defaults to an empty array in the response so the AI can
 *   always iterate the field without checking for undefined.
 * - This tool must be called before `orders_prepare` when placing a tasking
 *   order, because the `provider_window_id` from an opportunity can be used
 *   to pin the order to a specific satellite pass.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";
import {
  normalizeTaskingResolution,
  type TaskingResolutionInput,
  taskingResolutionInputSchema,
} from "./resolution.js";
import { chunkRouteToCorridorPolygons } from "./corridor.js";

const corridorChunkInputSchema = z.object({
  chunk_index: z.number().int().nonnegative().describe("Zero-based chunk index"),
  aoi: z.string().describe("Chunk AOI as a WKT POLYGON string"),
  corridor_length_meters: z
    .number()
    .optional()
    .describe("Optional centerline length of this chunk in meters"),
  polygon_vertex_count: z
    .number()
    .int()
    .optional()
    .describe("Optional number of polygon vertices in this chunk"),
});

async function runFeasibilityCheck(
  client: SkyFiClient,
  params: {
    aoi: string;
    window_start: string;
    window_end: string;
    product_type: "DAY" | "MULTISPECTRAL" | "SAR";
    resolution: TaskingResolutionInput;
  },
) {
  const initial = await client.checkFeasibility({
    aoi: params.aoi,
    startDate: params.window_start,
    endDate: params.window_end,
    productType: params.product_type,
    resolution: normalizeTaskingResolution(params.resolution),
  });

  const result = await client.pollFeasibility(initial.feasibility_id);

  return {
    feasibilityId: result.feasibility_id,
    status: result.status,
    opportunities: result.opportunities ?? [],
    message: result.message,
  };
}

/**
 * Register the `feasibility_check` tool on the given MCP server.
 *
 * The tool is read-only — it queries satellite pass schedules but does not
 * commit any order or consume credits.
 *
 * @param server - The MCP server instance to register the tool on.
 * @param client - Authenticated SkyFi API client used to submit and poll the check.
 */
export function registerFeasibilityTools(
  server: McpServer,
  client: SkyFiClient,
) {
  server.registerTool(
    "passes_predict",
    {
      title: "Predict Passes",
      description:
        "Predict upcoming satellite passes over a WKT AOI within a future time window. Use this to find candidate providerWindowId values before preparing a tasking order. Prefer windows that start at least 24 hours from now because near-term windows may be rejected upstream.",
      inputSchema: {
        aoi: z.string().describe("Area of interest as WKT POLYGON string"),
        from_date: z
          .string()
          .describe(
            "Start of prediction window (ISO 8601). Prefer at least 24 hours in the future.",
          ),
        to_date: z.string().describe("End of prediction window (ISO 8601)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ aoi, from_date, to_date }) => {
      const result = await client.getPassPrediction({
        aoi,
        fromDate: from_date,
        toDate: to_date,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "feasibility_check",
    {
      title: "Check Feasibility",
      description:
        "Check whether a satellite tasking order is feasible for a given WKT AOI, capture window, product type, and resolution. This submits the request and polls until complete. A successful result may still return zero opportunities, which means no viable collection windows were found.",
      inputSchema: {
        aoi: z.string().describe("Area of interest as WKT POLYGON string"),
        window_start: z.string().describe("Start of capture window (ISO 8601)"),
        window_end: z.string().describe("End of capture window (ISO 8601)"),
        product_type: z
          .enum(["DAY", "MULTISPECTRAL", "SAR"])
          .describe("Product type for the requested tasking opportunity"),
        resolution: taskingResolutionInputSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ aoi, window_start, window_end, product_type, resolution }) => {
      const result = await runFeasibilityCheck(client, {
        aoi,
        window_start,
        window_end,
        product_type,
        resolution,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "corridor_chunk",
    {
      title: "Chunk Corridor",
      description:
        "Convert an ordered GPS route into corridor polygons and chunk the corridor into smaller AOIs. Use this for long linear assets such as pipelines, roads, or transmission lines when one large polygon is too long or too complex for the SkyFi API.",
      inputSchema: {
        route: z
          .array(
            z.object({
              lat: z.number().describe("Latitude in decimal degrees"),
              lon: z.number().describe("Longitude in decimal degrees"),
            }),
          )
          .min(2)
          .describe(
            "Ordered GPS points describing the centerline of the corridor as a polyline.",
          ),
        corridor_width_meters: z
          .number()
          .positive()
          .describe(
            "Total corridor width in meters. For a 1 km wide imagery corridor, use 1000.",
          ),
        max_chunk_length_meters: z
          .number()
          .positive()
          .default(20000)
          .describe(
            "Maximum centerline length per chunk in meters. Smaller chunks are safer for very long routes.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ route, corridor_width_meters, max_chunk_length_meters }) => {
      const chunks = chunkRouteToCorridorPolygons({
        route,
        corridorWidthMeters: corridor_width_meters,
        maxChunkLengthMeters: max_chunk_length_meters,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                chunkCount: chunks.length,
                corridorWidthMeters: corridor_width_meters,
                maxChunkLengthMeters: max_chunk_length_meters,
                chunks: chunks.map((chunk) => ({
                  chunk_index: chunk.chunkIndex,
                  corridor_length_meters: Math.round(chunk.lengthMeters),
                  route_point_count: chunk.routePoints.length,
                  polygon_vertex_count: chunk.polygonPoints.length - 1,
                  aoi: chunk.wktPolygon,
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

  server.registerTool(
    "feasibility_check_chunks",
    {
      title: "Check Feasibility For Chunks",
      description:
        "Run feasibility_check semantics on a set of precomputed chunks. Use this after corridor_chunk so the route decomposition is inspectable and reusable before feasibility runs.",
      inputSchema: {
        chunks: z
          .array(corridorChunkInputSchema)
          .min(1)
          .describe("Chunk objects returned by corridor_chunk."),
        window_start: z.string().describe("Start of capture window (ISO 8601)"),
        window_end: z.string().describe("End of capture window (ISO 8601)"),
        product_type: z
          .enum(["DAY", "MULTISPECTRAL", "SAR"])
          .describe("Product type for the requested tasking opportunity"),
        resolution: taskingResolutionInputSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ chunks, window_start, window_end, product_type, resolution }) => {
      const chunkResults = [];

      for (const chunk of chunks) {
        const result = await runFeasibilityCheck(client, {
          aoi: chunk.aoi,
          window_start,
          window_end,
          product_type,
          resolution,
        });
        chunkResults.push({
          chunkIndex: chunk.chunk_index,
          corridorLengthMeters:
            typeof chunk.corridor_length_meters === "number"
              ? Math.round(chunk.corridor_length_meters)
              : undefined,
          polygonVertexCount: chunk.polygon_vertex_count,
          aoi: chunk.aoi,
          feasibilityId: result.feasibilityId,
          status: result.status,
          opportunityCount: result.opportunities.length,
          opportunities: result.opportunities,
          message: result.message,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                chunkCount: chunkResults.length,
                feasibleChunkCount: chunkResults.filter(
                  (chunk) => chunk.opportunityCount > 0,
                ).length,
                totalOpportunityCount: chunkResults.reduce(
                  (sum, chunk) => sum + chunk.opportunityCount,
                  0,
                ),
                chunks: chunkResults,
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
