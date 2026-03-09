import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";

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
