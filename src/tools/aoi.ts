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

export interface RegisterAoiToolsOptions {
  alertStore?: AlertStoreLike;
  defaultWebhookUrl?: string;
}

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
  options: RegisterAoiToolsOptions = {},
) {
  server.registerTool(
    "notifications_create",
    {
      title: "Create Notification",
      description:
        "Create an AOI monitor that sends a webhook when new imagery matches the specified WKT AOI and optional quality filters. This is a persistent server-side monitor. Only call this tool when you already have a webhookUrl or you know this MCP server has an internally managed AOI webhook configured; otherwise ask for the missing webhook destination first.",
      inputSchema: {
        aoi: z
          .string()
          .describe(
            "Area of interest as WKT POLYGON. Use location_resolve first if the user only gave a place name.",
          ),
        webhookUrl: z
          .string()
          .optional()
          .describe(
            "Optional webhook override. Required unless you already know this MCP server has an internally managed AOI webhook URL configured.",
          ),
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
          .describe("Optional product type filter (e.g. DAY, MULTISPECTRAL, SAR)"),
      },
    },
    async ({ aoi, webhookUrl, gsdMin, gsdMax, productType }) => {
      const resolvedWebhookUrl = webhookUrl ?? options.defaultWebhookUrl;
      if (!resolvedWebhookUrl) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No webhook URL is available. This server does not have an internally managed AOI webhook URL configured, so provide webhookUrl explicitly or configure SKYFI_MCP_PUBLIC_BASE_URL.",
            },
          ],
          isError: true,
        };
      }

      const notification = await client.createNotification({
        aoi,
        webhookUrl: resolvedWebhookUrl,
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
      description:
        "List all active AOI monitors for the authenticated account. Use this to inspect existing webhook targets or confirm whether a monitor already exists.",
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
        "Get an AOI monitor by ID, including its configuration and any recent stored webhook alerts.",
      inputSchema: {
        monitor_id: z
          .string()
          .describe("Monitor/notification UUID to retrieve"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ monitor_id }) => {
      const notification = await client.getNotification(monitor_id);
      const alerts = (await options.alertStore?.get(monitor_id)) ?? [];

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
      description:
        "Delete an AOI monitor and discard its stored alerts. This is destructive and should be used only when the user wants to remove a monitor or when cleaning up a temporary demo monitor.",
      inputSchema: {
        monitor_id: z.string().describe("Monitor/notification UUID to delete"),
      },
    },
    async ({ monitor_id }) => {
      await client.deleteNotification(monitor_id);
      // Clean up stored alerts for the deleted monitor.
      await options.alertStore?.clear(monitor_id);

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
        "List recent stored webhook alerts received by this MCP server. Optionally filter by monitor ID. This only shows alerts that were delivered to a webhook endpoint connected to this server.",
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
        ? ((await options.alertStore?.get(monitor_id, maxResults)) ?? [])
        : ((await options.alertStore?.getAll(maxResults)) ?? []);

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
