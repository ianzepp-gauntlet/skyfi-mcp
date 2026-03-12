/**
 * MCP tools: `notifications_create`, `notifications_list`, `notifications_get`,
 * `notifications_delete`, `alerts_list`
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
import type { AlertStoreLike } from "./alerts.js";

/**
 * Register AOI monitoring tools on the given MCP server.
 *
 * Registers five tools: `notifications_create`, `notifications_list`,
 * `notifications_get`, `notifications_delete`, and `alerts_list`.
 *
 * @param server - The MCP server instance to register the tools on.
 * @param client - Authenticated SkyFi API client used to manage notifications.
 * @param alertStore - Shared alert store for reading webhook-delivered alerts.
 */
export function registerAoiTools(
  server: McpServer,
  client: SkyFiClient,
  alertStore?: AlertStoreLike,
) {
  server.registerTool(
    "notifications_create",
    {
      title: "Create Notification",
      description:
        "Create a notification filter that sends webhooks when new imagery matches the specified AOI and optional quality filters.",
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
    "notifications_list",
    {
      title: "List Notifications",
      description: "List all active notification filters.",
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
    "notifications_get",
    {
      title: "Get Notification",
      description:
        "Get a notification filter by ID, including its history and any recent webhook alerts.",
      inputSchema: {
        monitor_id: z
          .string()
          .describe("Monitor/notification UUID to retrieve"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ monitor_id }) => {
      const notification = await client.getNotification(monitor_id);
      const alerts = (await alertStore?.get(monitor_id)) ?? [];

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
    "notifications_delete",
    {
      title: "Delete Notification",
      description: "Delete a notification filter and discard its stored alerts.",
      inputSchema: {
        monitor_id: z.string().describe("Monitor/notification UUID to delete"),
      },
    },
    async ({ monitor_id }) => {
      await client.deleteNotification(monitor_id);
      // Clean up stored alerts for the deleted monitor.
      await alertStore?.clear(monitor_id);

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
    "alerts_list",
    {
      title: "List Alerts",
      description:
        "List recent webhook alerts. Optionally filter by notification ID.",
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
        ? ((await alertStore?.get(monitor_id, maxResults)) ?? [])
        : ((await alertStore?.getAll(maxResults)) ?? []);

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
