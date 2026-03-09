/**
 * MCP tools: `create_aoi_monitor`, `list_aoi_monitors`, `delete_aoi_monitor`
 *
 * Exposes the SkyFi AOI monitoring (notification) system as MCP tools. AOI
 * monitors are persistent server-side subscriptions: once created, the SkyFi
 * platform sends HTTP POST callbacks to a caller-supplied webhook URL whenever
 * new imagery matching the monitor's filters becomes available for the
 * specified area.
 *
 * This tool group covers the full lifecycle of a monitor:
 * - Create: register a new AOI + webhook combination with optional quality filters.
 * - List: enumerate all active monitors for the authenticated account.
 * - Delete: cancel a monitor and stop future callbacks.
 *
 * Note that this module only manages monitor records. The webhook receiver that
 * handles incoming SkyFi callbacks is implemented in `src/server/transport.ts`
 * (`POST /webhooks/aoi`) and is currently a logging placeholder pending Phase 4.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

/**
 * Register AOI monitoring tools on the given MCP server.
 *
 * Registers three tools: `create_aoi_monitor`, `list_aoi_monitors`, and
 * `delete_aoi_monitor`.
 *
 * @param server - The MCP server instance to register the tools on.
 * @param client - Authenticated SkyFi API client used to manage notifications.
 */
export function registerAoiTools(server: McpServer, client: SkyFiClient) {
  server.registerTool("create_aoi_monitor", {
    title: "Create AOI Monitor",
    description:
      "Create an Area of Interest monitor that will send webhook notifications when new imagery is available for the specified area.",
    inputSchema: {
      aoi: z.string().describe("Area of interest as WKT POLYGON"),
      webhookUrl: z.string().describe("URL to receive webhook notifications"),
      gsdMin: z.number().optional().describe("Minimum ground sample distance (meters)"),
      gsdMax: z.number().optional().describe("Maximum ground sample distance (meters)"),
      productType: z.string().optional().describe("Filter by product type (e.g. DAY, MULTISPECTRAL, SAR)"),
    },
  }, async ({ aoi, webhookUrl, gsdMin, gsdMax, productType }) => {
    const notification = await client.createNotification({
      aoi,
      webhookUrl,
      gsdMin,
      gsdMax,
      productType,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          message: "AOI monitor created.",
          // WHY: Return monitorId separately from the full notification object
          // so the AI can easily extract it for use in a subsequent delete call.
          monitorId: notification.id,
          aoi: notification.aoi,
          webhookUrl: notification.webhookUrl,
          createdAt: notification.createdAt,
        }, null, 2),
      }],
    };
  });

  server.registerTool("list_aoi_monitors", {
    title: "List AOI Monitors",
    description: "List all active Area of Interest monitors.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await client.listNotifications();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          // EDGE: The SkyFi API may omit `total` in some responses; fall back
          // to the array length so the count field is always present.
          total: result.total ?? result.notifications.length,
          monitors: result.notifications.map((n) => ({
            id: n.id,
            aoi: n.aoi,
            webhookUrl: n.webhookUrl,
            gsdMin: n.gsdMin,
            gsdMax: n.gsdMax,
            productType: n.productType,
            createdAt: n.createdAt,
          })),
        }, null, 2),
      }],
    };
  });

  server.registerTool("delete_aoi_monitor", {
    title: "Delete AOI Monitor",
    description: "Delete an Area of Interest monitor by ID.",
    inputSchema: {
      monitor_id: z.string().describe("Monitor/notification UUID to delete"),
    },
  }, async ({ monitor_id }) => {
    await client.deleteNotification(monitor_id);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ message: "AOI monitor deleted.", monitorId: monitor_id }, null, 2),
      }],
    };
  });
}
