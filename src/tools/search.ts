/**
 * MCP tool: `search_imagery`
 *
 * Exposes the SkyFi archive catalog search capability as an MCP tool. An AI
 * calling this tool can discover available satellite imagery for a geographic
 * area and time range before deciding whether to purchase a scene.
 *
 * Design notes:
 * - The same tool handles both initial searches (AOI + dates required) and
 *   page-cursor fetches (only `page` required). This keeps the AI's tool
 *   surface small — a single tool handles both the first call and all subsequent
 *   page fetches, rather than requiring the AI to switch tools mid-pagination.
 * - Zod's `superRefine` is used for cross-field validation because the
 *   "required unless page is provided" rule cannot be expressed with per-field
 *   validators alone.
 * - The response is projected to a curated subset of `Archive` fields. The
 *   full `Archive` type contains raw footprint WKT and thumbnail URLs that are
 *   verbose and rarely useful to an AI; the projection keeps context window
 *   usage reasonable.
 *
 * TRADE-OFFS:
 * - Human-readable units are inlined (e.g. "45%", "0.5m", "$1.20") rather than
 *   raw numbers. This makes responses easier for an AI to interpret at the cost
 *   of making the values harder to sort/filter programmatically. The assumption
 *   is that the AI re-issues the search with narrower filters rather than
 *   post-processing raw numbers.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

/**
 * Input schema for the `search_imagery` MCP tool.
 *
 * Two mutually exclusive invocation modes:
 * - **Initial search**: `aoi` + `fromDate` + `toDate` are required; optional
 *   quality and type filters can narrow results.
 * - **Pagination**: only `page` (opaque cursor from a prior result) is required;
 *   all other fields are ignored if provided.
 *
 * The `superRefine` validator enforces this distinction at parse time so the
 * tool handler can trust that `aoi`, `fromDate`, and `toDate` are non-null
 * whenever `page` is absent.
 */
export const searchImagerySchema = z
  .object({
    page: z
      .string()
      .optional()
      .describe("Pagination cursor returned by a previous search_imagery call"),
    aoi: z
      .string()
      .optional()
      .describe("Area of interest as WKT POLYGON string"),
    fromDate: z
      .string()
      .optional()
      .describe("Start date (ISO 8601, e.g. 2024-01-01)"),
    toDate: z
      .string()
      .optional()
      .describe("End date (ISO 8601, e.g. 2024-06-01)"),
    maxCloudCoveragePercent: z
      .number()
      .optional()
      .describe("Max cloud cover percentage (0-100)"),
    maxOffNadirAngle: z
      .number()
      .optional()
      .describe("Max off-nadir angle in degrees"),
    resolutions: z
      .array(z.string())
      .optional()
      .describe("Resolution filters (e.g. LOW, HIGH, VERY_HIGH)"),
    productTypes: z
      .array(z.string())
      .optional()
      .describe("Product type filters (e.g. DAY, MULTISPECTRAL, SAR)"),
    pageSize: z.number().optional().describe("Results per page (default 25)"),
  })
  .superRefine((params, ctx) => {
    // WHY: Without this cross-field rule, an AI could call the tool with only
    // partial parameters (e.g. aoi without dates) and receive a confusing API
    // error rather than a clear schema validation failure.
    if (!params.page && (!params.aoi || !params.fromDate || !params.toDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Initial searches require aoi, fromDate, and toDate unless page is provided.",
      });
    }
  });

/**
 * Register the `search_imagery` tool on the given MCP server.
 *
 * The tool is read-only (`readOnlyHint: true`) — it queries the SkyFi catalog
 * but does not place orders or consume credits.
 *
 * @param server - The MCP server instance to register the tool on.
 * @param client - Authenticated SkyFi API client used to execute searches.
 */
export function registerSearchTools(server: McpServer, client: SkyFiClient) {
  server.registerTool(
    "search_imagery",
    {
      title: "Search Satellite Imagery",
      description:
        "Search the SkyFi satellite imagery catalog. Provide an area of interest as a WKT polygon, date range, and optional filters for an initial search, or provide a page cursor from a previous result to fetch the next page.",
      inputSchema: searchImagerySchema,
      annotations: { readOnlyHint: true },
    },
    async ({ page, aoi, fromDate, toDate, ...rest }) => {
      // WHY: Branch on `page` presence rather than checking aoi/dates, because
      // the schema validator already guarantees that if `page` is absent then
      // aoi/fromDate/toDate are present (non-null assertion is safe).
      const result = page
        ? await client.getArchivesPage(page)
        : await client.searchArchives({
            aoi: aoi!,
            fromDate: fromDate!,
            toDate: toDate!,
            ...rest,
          });

      return {
        content: [
          {
            type: "text" as const,
            // WHY: Project to a curated subset rather than returning raw Archive
            // objects. The full Archive has verbose footprint WKT and multiple
            // thumbnail URLs that inflate context window usage without helping the
            // AI decide which scene to purchase.
            text: JSON.stringify(
              {
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
                nextPage: result.next_page ?? null,
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
