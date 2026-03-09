import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SkyFiClient } from "../client/skyfi.js";
import type { SkyFiConfig } from "../config/index.js";
import { registerSearchTools } from "../tools/search.js";
import { registerFeasibilityTools } from "../tools/feasibility.js";
import { registerPricingTools } from "../tools/pricing.js";
import { registerOrderTools } from "../tools/orders.js";
import { registerAoiTools } from "../tools/aoi.js";
import { registerLocationTools } from "../tools/location.js";

export function createMcpServer(config: SkyFiConfig): McpServer {
  const server = new McpServer({
    name: "skyfi",
    version: "0.1.0",
  });

  const client = new SkyFiClient(config);

  // Register all tools
  registerSearchTools(server, client);
  registerFeasibilityTools(server, client);
  registerPricingTools(server, client);
  registerOrderTools(server, client);
  registerAoiTools(server, client);
  registerLocationTools(server);

  return server;
}
