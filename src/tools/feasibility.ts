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
  taskingResolutionInputSchema,
} from "./resolution.js";

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
        "Predict upcoming satellite passes over an AOI within a time window. Use this to find candidate providerWindowId values before preparing a tasking order.",
      inputSchema: {
        aoi: z.string().describe("Area of interest as WKT POLYGON string"),
        from_date: z
          .string()
          .describe("Start of prediction window (ISO 8601)"),
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
        "Check whether a satellite tasking order is feasible for a given area, time window, product type, and resolution. Submits the request and polls until complete.",
      inputSchema: {
        aoi: z.string().describe("Area of interest as WKT POLYGON string"),
        window_start: z.string().describe("Start of capture window (ISO 8601)"),
        window_end: z.string().describe("End of capture window (ISO 8601)"),
        product_type: z
          .enum(["DAY", "MULTISPECTRAL", "SAR"])
          .describe("Product type"),
        resolution: taskingResolutionInputSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ aoi, window_start, window_end, product_type, resolution }) => {
      // PHASE 1: SUBMIT — enqueue the feasibility check and get the tracking ID.
      // Map MCP tool field names (snake_case) to API field names (camelCase).
      const initial = await client.checkFeasibility({
        aoi,
        startDate: window_start,
        endDate: window_end,
        productType: product_type,
        resolution: normalizeTaskingResolution(resolution),
      });

      // PHASE 2: POLL — wait for the check to reach a terminal state.
      // pollFeasibility handles the retry loop with configurable interval/timeout.
      const result = await client.pollFeasibility(initial.feasibility_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                feasibilityId: result.feasibility_id,
                status: result.status,
                // WHY: Default to empty array so the AI can always iterate
                // opportunities without a null check.
                opportunities: result.opportunities ?? [],
                message: result.message,
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
