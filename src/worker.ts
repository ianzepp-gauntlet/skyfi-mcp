/**
 * SkyFi MCP Server — Cloudflare Workers entry point (Cloudflare Agents).
 *
 * Uses the `McpAgent` class from `agents/mcp` to run the MCP server as a
 * Durable Object. This gives us real stateful sessions — each MCP client
 * gets its own DO instance that holds the session map, transport, and
 * server in memory across requests.
 *
 * Differences from the Bun entry point (`src/index.ts`):
 *  1. No filesystem access — API keys come from the `x-skyfi-api-key`
 *     request header or Worker environment bindings (`wrangler secret put`).
 *  2. No port binding — requests arrive through Cloudflare's edge network.
 *  3. Stateful via Durable Objects — sessions survive across HTTP requests.
 *
 * @see src/index.ts — Bun/Node.js entry point (filesystem config, TCP port).
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "./config/index.js";
import { SkyFiClient } from "./client/skyfi.js";
import { registerSearchTools } from "./tools/search.js";
import { registerFeasibilityTools } from "./tools/feasibility.js";
import { registerPricingTools } from "./tools/pricing.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerAoiTools } from "./tools/aoi.js";
import { registerLocationTools } from "./tools/location.js";
import { AlertStore } from "./tools/alerts.js";

/**
 * The SkyFi MCP agent — a Durable Object that serves the full MCP protocol.
 *
 * Each MCP session maps to one DO instance. The `McpAgent` base class handles
 * the Streamable HTTP transport, session lifecycle, and WebSocket hibernation.
 * We only need to provide `server` and `init()` to register our tools.
 */
export class SkyFiMcpAgent extends McpAgent {
  server = new McpServer({ name: "skyfi", version: "0.1.0" });

  #alertStore = new AlertStore();

  async init() {
    // Resolve config from env bindings (set via wrangler secret put).
    // The McpAgent base class exposes this.env from the Durable Object.
    // Cast individual values to satisfy loadConfig's Record<string, string> shape.
    const env: Record<string, string> = {};
    const raw = this.env ?? {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") env[k] = v;
    }
    const config = loadConfig(undefined, undefined, env);
    const client = new SkyFiClient(config);

    registerSearchTools(this.server, client);
    registerFeasibilityTools(this.server, client);
    registerPricingTools(this.server, client);
    registerOrderTools(this.server, client);
    registerAoiTools(this.server, client, this.#alertStore);
    registerLocationTools(this.server);
  }
}

// Worker fetch handler — routes /mcp to the Durable Object agent.
export default SkyFiMcpAgent.serve("/mcp");
