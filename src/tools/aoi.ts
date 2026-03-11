/**
 * MCP tools: `create_aoi_monitor`, `list_aoi_monitors`, `get_aoi_monitor`,
 * `delete_aoi_monitor`, `get_aoi_alerts`
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
 * - Get: fetch a single monitor by ID with its recent alerts.
 * - Delete: cancel a monitor and stop future callbacks.
 * - Alerts: retrieve stored webhook alerts for a monitor or across all monitors.
 *
 * The webhook receiver that handles incoming SkyFi callbacks is implemented in
 * `src/server/transport.ts` (`POST /webhooks/aoi`) and writes to the shared
 * `AlertStore` instance.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";
import type { AlertStore } from "./alerts.js";

/**
 * Register AOI monitoring tools on the given MCP server.
 *
 * Registers five tools: `create_aoi_monitor`, `list_aoi_monitors`,
 * `get_aoi_monitor`, `delete_aoi_monitor`, and `get_aoi_alerts`.
 *
 * @param server - The MCP server instance to register the tools on.
 * @param client - Authenticated SkyFi API client used to manage notifications.
 * @param alertStore - Shared alert store for reading webhook-delivered alerts.
 */
export function registerAoiTools(
  server: McpServer,
  client: SkyFiClient,
  alertStore?: AlertStore,
) {
  server.registerTool(
    "create_aoi_monitor",
    {
      title: "Create AOI Monitor",
      description:
        "Create an Area of Interest monitor that will send webhook notifications when new imagery is available for the specified area.",
      inputSchema: {
        aoi: z.string().describe("Area of interest as WKT POLYGON"),
        webhookUrl: z.string().describe("URL to receive webhook notifications"),
        gsdMin: z
          .number()
          .optional()
          .describe("Minimum ground sample distance (meters)"),
        gsdMax: z
          .number()
          .optional()
          .describe("Maximum ground sample distance (meters)"),
        productType: z
          .string()
          .optional()
          .describe("Filter by product type (e.g. DAY, MULTISPECTRAL, SAR)"),
      },
    },
    async ({ aoi, webhookUrl, gsdMin, gsdMax, productType }) => {
      const notification = await client.createNotification({
        aoi,
        webhookUrl,
        gsdMin,
        gsdMax,
        productType,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: "AOI monitor created.",
                monitorId: notification.id,
                aoi: notification.aoi,
                webhookUrl: notification.webhookUrl,
                createdAt: notification.createdAt,
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
    "list_aoi_monitors",
    {
      title: "List AOI Monitors",
      description: "List all active Area of Interest monitors.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await client.listNotifications();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
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
    "get_aoi_monitor",
    {
      title: "Get AOI Monitor",
      description:
        "Get details for a specific AOI monitor by ID, including recent alerts received via webhook.",
      inputSchema: {
        monitor_id: z
          .string()
          .describe("Monitor/notification UUID to retrieve"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ monitor_id }) => {
      const notification = await client.getNotification(monitor_id);
      const alerts = alertStore?.get(monitor_id) ?? [];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                monitor: {
                  id: notification.id,
                  aoi: notification.aoi,
                  webhookUrl: notification.webhookUrl,
                  gsdMin: notification.gsdMin,
                  gsdMax: notification.gsdMax,
                  productType: notification.productType,
                  createdAt: notification.createdAt,
                },
                recentAlerts: alerts.length,
                alerts: alerts.map((a) => ({
                  receivedAt: a.receivedAt,
                  payload: a.payload,
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
    "delete_aoi_monitor",
    {
      title: "Delete AOI Monitor",
      description: "Delete an Area of Interest monitor by ID.",
      inputSchema: {
        monitor_id: z.string().describe("Monitor/notification UUID to delete"),
      },
    },
    async ({ monitor_id }) => {
      await client.deleteNotification(monitor_id);
      // Clean up stored alerts for the deleted monitor.
      alertStore?.clear(monitor_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { message: "AOI monitor deleted.", monitorId: monitor_id },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_aoi_alerts",
    {
      title: "Get AOI Alerts",
      description:
        "Retrieve recent alerts received via webhook for AOI monitors. Specify a monitor_id to filter by monitor, or omit it to see all alerts.",
      inputSchema: {
        monitor_id: z
          .string()
          .optional()
          .describe("Optional monitor/notification UUID to filter alerts"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of alerts to return (default: 25)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ monitor_id, limit }) => {
      const maxResults = limit ?? 25;
      const alerts = monitor_id
        ? (alertStore?.get(monitor_id, maxResults) ?? [])
        : (alertStore?.getAll(maxResults) ?? []);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total: alerts.length,
                alerts: alerts.map((a) => ({
                  monitorId: a.monitorId,
                  receivedAt: a.receivedAt,
                  payload: a.payload,
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
