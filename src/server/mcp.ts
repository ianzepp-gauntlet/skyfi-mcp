/**
 * MCP server factory for the SkyFi integration.
 *
 * This module is the composition root for the MCP server: it creates an
 * `McpServer` instance, wires it to a `SkyFiClient`, and delegates tool
 * registration to the individual tool modules. No tool logic lives here —
 * this file only wires things together.
 *
 * Architecture:
 * - Each tool group (search, feasibility, pricing, orders, AOI monitoring,
 *   location) lives in its own module under `src/tools/`. This keeps related
 *   tools co-located and avoids this file growing into a monolith.
 * - A new `McpServer` is created per call, rather than sharing a singleton.
 *   This is required by the transport layer, which creates one server per
 *   session so that each caller's API key is isolated.
 * - `registerLocationTools` is the only registration that does not receive a
 *   `SkyFiClient`, because location resolution goes through OpenStreetMap, not
 *   the SkyFi API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SkyFiClient } from "../client/skyfi.js";
import type { SkyFiConfig } from "../config/index.js";
import { registerSearchTools } from "../tools/search.js";
import { registerFeasibilityTools } from "../tools/feasibility.js";
import { registerPricingTools } from "../tools/pricing.js";
import { registerOrderTools } from "../tools/orders.js";
import { registerAoiTools } from "../tools/aoi.js";
import { registerLocationTools } from "../tools/location.js";
import type { AlertStore } from "../tools/alerts.js";

/** Options for MCP server creation beyond the base SkyFi config. */
export interface CreateMcpServerOptions {
  /**
   * Shared alert store for AOI webhook alerts. When provided, the
   * `notifications_get` and `alerts_list` tools can return stored alerts.
   */
  alertStore?: AlertStore;
}

/**
 * Create and fully configure an MCP server for the given SkyFi account.
 *
 * Instantiates both the MCP server and the SkyFi API client from the provided
 * config, then registers all tool groups. The returned server is ready to be
 * connected to a transport.
 *
 * This function is called once per MCP session (i.e. once per connected client)
 * so that the API key is bound at server creation time and does not need to be
 * threaded through every tool handler.
 *
 * @param config - SkyFi API credentials and base URL for this session.
 * @param options - Additional options (e.g. shared alert store).
 * @returns A fully registered `McpServer` instance, not yet connected to a transport.
 */
export function createMcpServer(
  config: SkyFiConfig,
  options?: CreateMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: "skyfi",
    version: "0.1.0",
  });

  const client = new SkyFiClient(config);

  // Register all tool groups. Order does not affect functionality — tools are
  // looked up by name at call time, not by registration order.
  registerSearchTools(server, client);
  registerFeasibilityTools(server, client);
  registerPricingTools(server, client);
  registerOrderTools(server, client);
  registerAoiTools(server, client, options?.alertStore);
  // Location tools use OpenStreetMap, not the SkyFi API, so they don't
  // need a SkyFiClient reference.
  registerLocationTools(server);

  return server;
}
