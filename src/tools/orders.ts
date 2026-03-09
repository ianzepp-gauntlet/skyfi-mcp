import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SkyFiClient } from "../client/skyfi.js";
import type { OrderArchiveRequest, OrderTaskingRequest } from "../client/types.js";
import { ConfirmationStore } from "./confirmation.js";

export function registerOrderTools(
  server: McpServer,
  client: SkyFiClient,
  confirmationStore = new ConfirmationStore()
) {
  // ── List Orders ──

  server.registerTool("list_orders", {
    title: "List Orders",
    description: "List your SkyFi orders with optional filtering by type and pagination.",
    inputSchema: {
      orderType: z.enum(["ARCHIVE", "TASKING"]).optional().describe("Filter by order type"),
      pageNumber: z.number().optional().describe("Page number (0-based)"),
      pageSize: z.number().optional().describe("Results per page (max 100)"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ orderType, pageNumber, pageSize }) => {
    const result = await client.listOrders({ orderType, pageNumber, pageSize });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total: result.total,
          orders: result.orders.map((o) => ({
            id: o.id,
            type: o.orderType,
            status: o.status,
            createdAt: o.createdAt,
          })),
        }, null, 2),
      }],
    };
  });

  // ── Get Order Detail ──

  server.registerTool("get_order", {
    title: "Get Order Details",
    description: "Get detailed status and history for a specific order.",
    inputSchema: {
      order_id: z.string().describe("Order UUID"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ order_id }) => {
    const order = await client.getOrder(order_id);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(order, null, 2),
      }],
    };
  });

  // ── Prepare Order (step 1 of human-in-the-loop) ──

  server.registerTool("prepare_order", {
    title: "Prepare Order",
    description:
      "Prepare a satellite imagery order and get pricing. This does NOT place the order — it returns a confirmation token that must be passed to confirm_order to actually execute the purchase. The user MUST review and approve the price before confirming.",
    inputSchema: {
      type: z.enum(["archive", "tasking"]).describe("Order type: archive (existing imagery) or tasking (new capture)"),
      aoi: z.string().describe("Area of interest as WKT POLYGON"),
      archiveId: z.string().optional().describe("Archive ID (required for archive orders)"),
      window_start: z.string().optional().describe("Capture window start (ISO 8601, required for tasking)"),
      window_end: z.string().optional().describe("Capture window end (ISO 8601, required for tasking)"),
      product_type: z.enum(["DAY", "MULTISPECTRAL", "SAR"]).optional().describe("Product type (required for tasking)"),
      resolution: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH", "ULTRA_HIGH"]).optional().describe("Resolution (required for tasking)"),
      deliveryDriver: z.enum(["S3", "GS", "AZURE"]).describe("Cloud storage delivery target"),
      deliveryBucket: z.string().describe("Delivery bucket name"),
      deliveryPath: z.string().optional().describe("Delivery path within bucket"),
    },
  }, async (params) => {
    const pricing = await client.getPricing({ aoi: params.aoi });

    const deliveryParams = {
      bucket: params.deliveryBucket,
      path: params.deliveryPath,
    };

    let orderParams: OrderArchiveRequest | OrderTaskingRequest;

    if (params.type === "archive") {
      if (!params.archiveId) {
        return {
          content: [{ type: "text" as const, text: "Error: archiveId is required for archive orders." }],
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
      if (!params.window_start || !params.window_end || !params.product_type || !params.resolution) {
        return {
          content: [{ type: "text" as const, text: "Error: window_start, window_end, product_type, and resolution are required for tasking orders." }],
          isError: true,
        };
      }
      orderParams = {
        aoi: params.aoi,
        window_start: params.window_start,
        window_end: params.window_end,
        product_type: params.product_type,
        resolution: params.resolution,
        deliveryDriver: params.deliveryDriver,
        deliveryParams,
      } satisfies OrderTaskingRequest;
    }

    const pricingSummary = JSON.stringify(pricing, null, 2);
    const token = confirmationStore.store({
      type: params.type,
      params: orderParams,
      pricingSummary,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          confirmationToken: token,
          orderType: params.type,
          expiresInSeconds: 300,
          message: "ORDER NOT YET PLACED. Review the pricing below and call confirm_order with the confirmation token to execute the purchase.",
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
                  resolution: params.resolution,
                }),
          },
        }, null, 2),
      }],
    };
  });

  // ── Confirm Order (step 2 of human-in-the-loop) ──

  server.registerTool("confirm_order", {
    title: "Confirm and Place Order",
    description:
      "Execute a previously prepared order. Requires a valid confirmation token from prepare_order. The user must have explicitly approved the order before calling this tool.",
    inputSchema: {
      confirmationToken: z.string().describe("Confirmation token from prepare_order"),
    },
  }, async ({ confirmationToken }) => {
    const pending = confirmationStore.consume(confirmationToken);
    if (!pending) {
      return {
        content: [{
          type: "text" as const,
          text: "Error: Invalid or expired confirmation token. Please call prepare_order again to get a new token.",
        }],
        isError: true,
      };
    }

    let order;
    if (pending.type === "archive") {
      order = await client.createArchiveOrder(pending.params as OrderArchiveRequest);
    } else {
      order = await client.createTaskingOrder(pending.params as OrderTaskingRequest);
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          message: "Order placed successfully.",
          orderId: order.id,
          status: order.status,
          type: order.orderType,
          createdAt: order.createdAt,
        }, null, 2),
      }],
    };
  });
}
