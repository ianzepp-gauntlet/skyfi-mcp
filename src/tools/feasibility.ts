/**
 * MCP feasibility tools.
 *
 * The SkyFi feasibility API is asynchronous: callers submit feasibility jobs,
 * then poll later for status and opportunities. Railway's public HTTP path is
 * not reliable enough for long synchronous feasibility waits, so the MCP layer
 * exposes two batch-oriented primitives instead:
 *
 * - `feasibility_submit` — enqueue feasibility jobs for an array of AOIs
 * - `feasibility_status` — fetch the latest status/opportunities for an array
 *   of previously submitted feasibility IDs
 *
 * This keeps the AOI surface identical for normal polygons and corridor chunks:
 * both are just arrays of `{ aoi, ...optional metadata }`.
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

const feasibilityAoiInputSchema = corridorChunkInputSchema;

const feasibilityStatusInputSchema = feasibilityAoiInputSchema.extend({
  feasibility_id: z
    .string()
    .describe("Feasibility job ID returned by feasibility_submit"),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function feasibilityDebugEnabled(): boolean {
  const value = process.env.SKYFI_DEBUG_FEASIBILITY?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function logFeasibilityToolDebug(
  event: string,
  payload: Record<string, unknown>,
): void {
  if (!feasibilityDebugEnabled()) return;
  console.error("[feasibility-tool]", JSON.stringify({ event, ...payload }));
}

function summarizeProviders(result: {
  providerScores?: Array<Record<string, unknown>>;
}) {
  return (result.providerScores ?? []).map((providerScore) => ({
    provider:
      typeof providerScore.provider === "string"
        ? providerScore.provider
        : undefined,
    status:
      typeof providerScore.status === "string"
        ? providerScore.status
        : undefined,
    opportunityCount: Array.isArray(providerScore.opportunities)
      ? providerScore.opportunities.length
      : 0,
  }));
}

function summarizeFeasibilityResult(
  result: {
    feasibility_id: string;
    status: string;
    opportunities?: Array<Record<string, unknown>>;
    message?: string;
    providerScores?: Array<Record<string, unknown>>;
  },
  options?: { synthesizeNoOpportunityHint?: boolean },
) {
  const upstreamMessage =
    typeof result.message === "string" && result.message.trim().length > 0
      ? result.message
      : undefined;
  let message = upstreamMessage;

  if (
    options?.synthesizeNoOpportunityHint &&
    !message &&
    (result.opportunities ?? []).length === 0
  ) {
    message =
      "No opportunities were returned for the requested AOI, window, and constraints. passes_predict can still show overpasses that feasibility excludes.";
  }

  return {
    feasibilityId: result.feasibility_id,
    status: result.status,
    opportunityCount: result.opportunities?.length ?? 0,
    opportunities: result.opportunities ?? [],
    message,
    providers: summarizeProviders(result),
  };
}

async function submitFeasibility(
  client: SkyFiClient,
  params: {
    aoi: string;
    window_start: string;
    window_end: string;
    product_type: "DAY" | "MULTISPECTRAL" | "SAR";
    resolution: TaskingResolutionInput;
    max_cloud_coverage_percent?: number;
    priority_item?: boolean;
    required_provider?: string;
  },
) {
  const normalizedResolution = normalizeTaskingResolution(params.resolution);
  logFeasibilityToolDebug("submit-start", {
    windowStart: params.window_start,
    windowEnd: params.window_end,
    productType: params.product_type,
    resolution: normalizedResolution,
    maxCloudCoveragePercent: params.max_cloud_coverage_percent,
    priorityItem: params.priority_item,
    requiredProvider: params.required_provider,
  });

  const result = await client.checkFeasibility({
    aoi: params.aoi,
    startDate: params.window_start,
    endDate: params.window_end,
    productType: params.product_type,
    resolution: normalizedResolution,
    maxCloudCoveragePercent: params.max_cloud_coverage_percent,
    priorityItem: params.priority_item,
    requiredProvider: params.required_provider,
  });

  const summary = summarizeFeasibilityResult(result);
  logFeasibilityToolDebug("submitted", summary);
  return summary;
}

async function fetchFeasibilityStatus(
  client: SkyFiClient,
  feasibilityId: string,
) {
  logFeasibilityToolDebug("status-start", { feasibilityId });
  const result = await client.getFeasibilityStatus(feasibilityId);
  const summary = summarizeFeasibilityResult(result, {
    synthesizeNoOpportunityHint: true,
  });
  logFeasibilityToolDebug("status-complete", summary);
  return summary;
}

/**
 * Register the feasibility tools on the given MCP server.
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
    "feasibility_submit",
    {
      title: "Submit Feasibility",
      description:
        "Submit SkyFi feasibility jobs for an array of AOIs. Use the same AOI list shape for ordinary polygons and corridor_chunk outputs, then poll later with feasibility_status.",
      inputSchema: {
        aois: z
          .array(feasibilityAoiInputSchema)
          .min(1)
          .describe(
            "Array of AOI objects. Pass plain polygons directly or reuse corridor_chunk output objects.",
          ),
        window_start: z.string().describe("Start of capture window (ISO 8601)"),
        window_end: z.string().describe("End of capture window (ISO 8601)"),
        product_type: z
          .enum(["DAY", "MULTISPECTRAL", "SAR"])
          .describe("Product type for the requested tasking opportunity"),
        resolution: taskingResolutionInputSchema,
        max_cloud_coverage_percent: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            "Optional maximum cloud coverage percentage. Useful when feasibility returns no opportunities but passes_predict still shows overpasses.",
          ),
        priority_item: z
          .boolean()
          .optional()
          .describe(
            "Optional priority flag for expedited feasibility processing when supported upstream.",
          ),
        required_provider: z
          .string()
          .optional()
          .describe(
            "Optional provider constraint such as PLANET, UMBRA, or SIWEI when the upstream account/provider supports it.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      aois,
      window_start,
      window_end,
      product_type,
      resolution,
      max_cloud_coverage_percent,
      priority_item,
      required_provider,
    }) => {
      const results = [];

      for (const item of aois) {
        try {
          const result = await submitFeasibility(client, {
            aoi: item.aoi,
            window_start,
            window_end,
            product_type,
            resolution,
            max_cloud_coverage_percent,
            priority_item,
            required_provider,
          });
          results.push({
            ...result,
            aoi: item.aoi,
            chunkIndex: item.chunk_index,
            corridorLengthMeters:
              typeof item.corridor_length_meters === "number"
                ? Math.round(item.corridor_length_meters)
                : undefined,
            polygonVertexCount: item.polygon_vertex_count,
          });
        } catch (error) {
          const message = toErrorMessage(error);
          results.push({
            aoi: item.aoi,
            chunkIndex: item.chunk_index,
            corridorLengthMeters:
              typeof item.corridor_length_meters === "number"
                ? Math.round(item.corridor_length_meters)
                : undefined,
            polygonVertexCount: item.polygon_vertex_count,
            status: "ERROR",
            opportunityCount: 0,
            opportunities: [],
            message,
            error: message,
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                requestCount: results.length,
                requests: results,
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
    "corridor_chunk",
    {
      title: "Chunk Corridor",
      description:
        "Convert an ordered GPS route into corridor polygons and split the corridor into smaller reusable AOI chunks. Use this first for long linear assets such as pipelines, roads, or transmission lines when one large polygon is too long or too complex for the SkyFi API. The returned chunks can be passed directly into feasibility_submit.",
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
            "Ordered GPS points describing the corridor centerline as a polyline. Keep the points in route order.",
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
            "Maximum centerline length per chunk in meters. Smaller chunks are safer for very long routes and are usually easier for upstream AOI handling.",
          ),
        max_chunk_area_sqkm: z
          .number()
          .positive()
          .optional()
          .describe(
            "Optional hard cap on chunk polygon area in square kilometers. When provided, chunk lengths are reduced until each corridor polygon fits within this area budget.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      route,
      corridor_width_meters,
      max_chunk_length_meters,
      max_chunk_area_sqkm,
    }) => {
      const chunks = chunkRouteToCorridorPolygons({
        route,
        corridorWidthMeters: corridor_width_meters,
        maxChunkLengthMeters: max_chunk_length_meters,
        maxChunkAreaSqKm: max_chunk_area_sqkm,
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
                maxChunkAreaSqKm: max_chunk_area_sqkm,
                chunks: chunks.map((chunk) => ({
                  chunk_index: chunk.chunkIndex,
                  corridor_length_meters: Math.round(chunk.lengthMeters),
                  area_sqkm: Number(chunk.areaSqKm.toFixed(3)),
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
    "feasibility_status",
    {
      title: "Get Feasibility Status",
      description:
        "Fetch the latest feasibility status for an array of AOIs that were previously submitted with feasibility_submit. Use the same AOI object shape, plus feasibility_id for each item.",
      inputSchema: {
        aois: z
          .array(feasibilityStatusInputSchema)
          .min(1)
          .describe(
            "Array of AOI objects with feasibility_id values returned by feasibility_submit.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ aois }) => {
      const results = [];

      for (const item of aois) {
        try {
          const result = await fetchFeasibilityStatus(
            client,
            item.feasibility_id,
          );
          results.push({
            ...result,
            aoi: item.aoi,
            chunkIndex: item.chunk_index,
            corridorLengthMeters:
              typeof item.corridor_length_meters === "number"
                ? Math.round(item.corridor_length_meters)
                : undefined,
            polygonVertexCount: item.polygon_vertex_count,
          });
        } catch (error) {
          const message = toErrorMessage(error);
          results.push({
            aoi: item.aoi,
            feasibilityId: item.feasibility_id,
            chunkIndex: item.chunk_index,
            corridorLengthMeters:
              typeof item.corridor_length_meters === "number"
                ? Math.round(item.corridor_length_meters)
                : undefined,
            polygonVertexCount: item.polygon_vertex_count,
            status: "ERROR",
            opportunityCount: 0,
            opportunities: [],
            message,
            error: message,
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                requestCount: results.length,
                feasibleCount: results.filter(
                  (item) => item.opportunityCount > 0,
                ).length,
                failedCount: results.filter(
                  (item) => item.status === "ERROR",
                ).length,
                totalOpportunityCount: results.reduce(
                  (sum, item) => sum + item.opportunityCount,
                  0,
                ),
                requests: results,
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
