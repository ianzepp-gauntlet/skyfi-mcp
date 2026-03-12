/**
 * MCP tools: `orders_list`, `orders_get`, `orders_prepare`, `orders_confirm`
 *
 * Exposes the SkyFi order management system as MCP tools, covering two
 * distinct responsibilities:
 *
 *  1. **Read-only order inspection** (`orders_list`, `orders_get`) — let an AI
 *     look up existing orders without any risk of side effects.
 *
 *  2. **Human-in-the-loop ordering** (`orders_prepare`, `orders_confirm`) — a
 *     two-step flow that prevents the AI from placing paid orders without
 *     explicit human approval:
 *
 *     - `orders_prepare` validates parameters, fetches pricing, and returns a
 *       short-lived confirmation token alongside a pricing summary. No order
 *       is placed at this step.
 *     - `orders_confirm` consumes the token and submits the actual API call.
 *       The token expires after 5 minutes, forcing the user to re-review
 *       pricing if they wait too long.
 *
 * Architecture:
 * - `ConfirmationStore` is injected as a parameter (defaulting to a new instance
 *   per registration) so tests can inject a pre-populated store or inspect
 *   stored tokens without needing to invoke the tool handler directly.
 * - Both archive and tasking order types are handled by the same `orders_prepare`
 *   and `orders_confirm` tools, with a `type` discriminator field. This avoids
 *   proliferating tool count and keeps the MCP surface small.
 *
 * TRADE-OFFS:
 * - `orders_prepare` fetches pricing at preparation time, not at confirmation
 *   time. Prices could theoretically change in the 5-minute window between
 *   prepare and confirm. This is accepted because SkyFi pricing is stable
 *   over short windows, and re-checking at confirm would require storing less
 *   state (just the order params, not the pricing too).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";
import type {
  OrderArchiveRequest,
  OrderTaskingRequest,
} from "../client/types.js";
import { ConfirmationStore } from "./confirmation.js";
import {
  normalizeTaskingResolution,
  taskingResolutionInputSchema,
} from "./resolution.js";

export function registerAccountTools(server: McpServer, client: SkyFiClient) {
  server.registerTool(
    "account_whoami",
    {
      title: "Get Account Info",
      description:
        "Get the authenticated SkyFi account profile, billing budget, and payment readiness details.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const user = await client.whoami();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: user.id,
                organizationId: user.organizationId,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                isDemoAccount: user.isDemoAccount,
                currentBudgetUsage: user.currentBudgetUsage,
                budgetAmount: user.budgetAmount,
                remainingBudget:
                  user.budgetAmount - user.currentBudgetUsage,
                hasValidSharedCard: user.hasValidSharedCard,
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

/**
 * Register order management tools on the given MCP server.
 *
 * Registers four tools: `orders_list`, `orders_get`, `orders_prepare`, and
 * `orders_confirm`.
 *
 * @param server - The MCP server instance to register the tools on.
 * @param client - Authenticated SkyFi API client used for order API calls.
 * @param confirmationStore - Token store for the prepare/confirm flow. Defaults
 *   to a new `ConfirmationStore` with a 5-minute TTL. Inject a custom instance
 *   in tests to control token state.
 */
export function registerOrderTools(
  server: McpServer,
  client: SkyFiClient,
  confirmationStore = new ConfirmationStore(),
) {
  // ── List Orders ────────────────────────────────────────────────────────────

  server.registerTool(
    "orders_list",
    {
      title: "List Orders",
      description:
        "List orders with optional filtering by type (ARCHIVE or TASKING) and pagination.",
      inputSchema: {
        orderType: z
          .enum(["ARCHIVE", "TASKING"])
          .optional()
          .describe("Filter by order type"),
        pageNumber: z.number().optional().describe("Page number (0-based)"),
        pageSize: z.number().optional().describe("Results per page (max 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ orderType, pageNumber, pageSize }) => {
      const result = await client.listOrders({
        orderType,
        pageNumber,
        pageSize,
      });
      return {
        content: [
          {
            type: "text" as const,
            // WHY: Project to a summary view. Full order objects include delivery
            // credentials and verbose metadata that are not useful for listing.
            text: JSON.stringify(
              {
                total: result.total,
                orders: result.orders.map((o) => ({
                  id: o.id,
                  type: o.orderType,
                  status: o.status,
                  createdAt: o.createdAt,
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

  // ── Get Order Detail ───────────────────────────────────────────────────────

  server.registerTool(
    "orders_get",
    {
      title: "Get Order",
      description:
        "Get status, history, and delivery details for a specific order.",
      inputSchema: {
        order_id: z.string().describe("Order UUID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      const order = await client.getOrder(order_id);
      return {
        content: [
          {
            type: "text" as const,
            // WHY: Return the full order object here (unlike orders_list) because
            // the user explicitly requested detail on a specific order.
            text: JSON.stringify(order, null, 2),
          },
        ],
      };
    },
  );

  // ── Prepare Order (step 1 of human-in-the-loop) ───────────────────────────

  server.registerTool(
    "orders_prepare",
    {
      title: "Prepare Order",
      description:
        "Validate order parameters and fetch pricing. Does NOT place the order. Returns a confirmation token for use with orders_confirm.",
      inputSchema: {
        type: z
          .enum(["archive", "tasking"])
          .describe(
            "Order type: archive (existing imagery) or tasking (new capture)",
          ),
        aoi: z.string().describe("Area of interest as WKT POLYGON"),
        archiveId: z
          .string()
          .optional()
          .describe("Archive ID (required for archive orders)"),
        window_start: z
          .string()
          .optional()
          .describe("Capture window start (ISO 8601, required for tasking)"),
        window_end: z
          .string()
          .optional()
          .describe("Capture window end (ISO 8601, required for tasking)"),
        product_type: z
          .enum(["DAY", "MULTISPECTRAL", "SAR"])
          .optional()
          .describe("Product type (required for tasking)"),
        resolution: taskingResolutionInputSchema.optional(),
        providerWindowId: z
          .string()
          .optional()
          .describe(
            "Optional provider window ID from passes_predict or feasibility_check to pin the tasking order to a specific pass",
          ),
        deliveryDriver: z
          .enum(["S3", "GS", "AZURE"])
          .describe("Cloud storage delivery target"),
        deliveryBucket: z.string().describe("Delivery bucket name"),
        deliveryPath: z
          .string()
          .optional()
          .describe("Delivery path within bucket"),
      },
    },
    async (params) => {
      // PHASE 1: VALIDATE ORDER-TYPE-SPECIFIC PARAMETERS
      // Validate fields that are conditionally required based on the order type.
      // These cross-type checks can't be expressed in the Zod schema without
      // a discriminated union, and the mixed schema is simpler for the AI to call.

      const deliveryParams = {
        bucket: params.deliveryBucket,
        path: params.deliveryPath,
      };

      let orderParams: OrderArchiveRequest | OrderTaskingRequest;

      if (params.type === "archive") {
        if (!params.archiveId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: archiveId is required for archive orders.",
              },
            ],
            isError: true,
          };
        }
        orderParams = {
          aoi: params.aoi,
          archiveId: params.archiveId,
          deliveryDriver: params.deliveryDriver,
          deliveryParams,
        } satisfies OrderArchiveRequest;
      } else {
        if (
          !params.window_start ||
          !params.window_end ||
          !params.product_type ||
          !params.resolution
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: window_start, window_end, product_type, and resolution are required for tasking orders.",
              },
            ],
            isError: true,
          };
        }
        orderParams = {
          aoi: params.aoi,
          windowStart: params.window_start,
          windowEnd: params.window_end,
          productType: params.product_type,
          resolution: normalizeTaskingResolution(params.resolution),
          providerWindowId: params.providerWindowId,
          deliveryDriver: params.deliveryDriver,
          deliveryParams,
        } satisfies OrderTaskingRequest;
      }

      // PHASE 2: FETCH PRICING
      // Get current pricing for the AOI so the user can review costs before
      // committing. Pricing is fetched here (at prepare time) and stored in the
      // confirmation token rather than re-fetched at confirm time. This ensures
      // the user is shown exactly the same pricing they will be charged.
      const pricing = await client.getPricing({ aoi: params.aoi });
      const pricingSummary = JSON.stringify(pricing, null, 2);
      const normalizedResolution =
        params.type === "tasking" && params.resolution
          ? normalizeTaskingResolution(params.resolution)
          : undefined;

      // PHASE 3: STORE PENDING ORDER AND RETURN TOKEN
      // Persist the fully-constructed order params and pricing under a short-lived
      // token. The token is what the user (via the AI) must supply to orders_confirm.
      const token = confirmationStore.store({
        type: params.type,
        params: orderParams,
        pricingSummary,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                confirmationToken: token,
                orderType: params.type,
                expiresInSeconds: 300,
                // WHY: Emphasize in the response text that the order has NOT been placed
                // to reduce the risk of the AI presenting this as a completed transaction.
                message:
                  "ORDER NOT YET PLACED. Review the pricing below and call orders_confirm with the confirmation token to execute the purchase.",
                pricing: JSON.parse(pricingSummary),
                orderDetails: {
                  aoi: params.aoi,
                  deliveryDriver: params.deliveryDriver,
                  deliveryBucket: params.deliveryBucket,
                  ...(params.type === "archive"
                    ? { archiveId: params.archiveId }
                    : {
                        window: `${params.window_start} → ${params.window_end}`,
                        productType: params.product_type,
                        resolution: normalizedResolution,
                        providerWindowId: params.providerWindowId,
                      }),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Confirm Order (step 2 of human-in-the-loop) ───────────────────────────

  server.registerTool(
    "orders_confirm",
    {
      title: "Confirm Order",
      description:
        "Execute a previously prepared order using the confirmation token from orders_prepare. Places an archive or tasking order.",
      inputSchema: {
        confirmationToken: z
          .string()
          .describe("Confirmation token from orders_prepare"),
      },
    },
    async ({ confirmationToken }) => {
      // WHY: `consume` is atomic — it retrieves and deletes the token in one
      // operation. This prevents double-submission if the AI calls this tool
      // twice with the same token (e.g. due to a retry after a network error).
      const pending = confirmationStore.consume(confirmationToken);
      if (!pending) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Invalid or expired confirmation token. Please call orders_prepare again to get a new token.",
            },
          ],
          isError: true,
        };
      }

      let order;
      if (pending.type === "archive") {
        order = await client.createArchiveOrder(pending.params);
      } else {
        order = await client.createTaskingOrder(pending.params);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: "Order placed successfully.",
                orderId: order.id,
                status: order.status,
                type: order.orderType,
                createdAt: order.createdAt,
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
