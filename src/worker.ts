/**
 * SkyFi MCP Server — Cloudflare Workers entry point (Cloudflare Agents).
 *
 * Uses the `McpAgent` class from `agents/mcp` to run the MCP server as a
 * Durable Object. Each MCP client gets its own DO instance, while shared
 * webhook alerts live in a separate Durable Object store.
 *
 * Differences from the Bun entry point (`src/index.ts`):
 *  1. No filesystem access — API keys come from the `x-skyfi-api-key`
 *     request header (bound to the MCP session) or Worker environment
 *     bindings (`wrangler secret put`).
 *  2. No port binding — requests arrive through Cloudflare's edge network.
 *  3. Stateful via Durable Objects — sessions survive across HTTP requests.
 *  4. `/webhooks/aoi` remains a first-class Worker route rather than part of
 *     the MCP transport so webhook deliveries and MCP traffic can coexist.
 *
 * @see src/index.ts — Bun/Node.js entry point (filesystem config, TCP port).
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DurableAlertStoreClient, SkyFiAlertStore } from "./alerts_object.js";
import { loadConfig } from "./config/index.js";
import { createAgentMcpHandler } from "./server/agent_transport.js";
import { createMcpServer } from "./server/mcp.js";
import { createWorkerFetch } from "./worker_routes.js";

type SkyFiAgentProps = {
  skyfiApiKey?: string;
};

export interface WorkerEnv extends Cloudflare.Env {
  MCP_OBJECT: DurableObjectNamespace<SkyFiMcpAgent>;
  ALERT_STORE: DurableObjectNamespace<any>;
}

/**
 * The SkyFi MCP agent — a Durable Object that serves the full MCP protocol.
 *
 * Each MCP session maps to one DO instance. The `McpAgent` base class handles
 * the Streamable HTTP transport, session lifecycle, and WebSocket hibernation.
 * We only need to provide `server` and `init()` to register our tools.
 */
export class SkyFiMcpAgent extends McpAgent<WorkerEnv, unknown, SkyFiAgentProps> {
  server = new McpServer({ name: "skyfi", version: "0.1.0" });

  async init() {
    // Resolve config from session props first so remote clients can supply
    // their own SkyFi API key. Fall back to Worker env bindings for single-
    // tenant deployments.
    const env: Record<string, string> = {};
    const raw = this.env ?? {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") env[k] = v;
    }
    const config = loadConfig(this.props?.skyfiApiKey, undefined, env);
    const alertStore = new DurableAlertStoreClient(this.env.ALERT_STORE);
    this.server = createMcpServer(config, { alertStore });
  }
}

function createDefaultMcpHandler(env: WorkerEnv) {
  return createAgentMcpHandler({
    namespace: env.MCP_OBJECT,
    getPropsForInit: (request) => {
      const skyfiApiKey = request.headers.get("x-skyfi-api-key") ?? undefined;
      return skyfiApiKey ? { skyfiApiKey } : undefined;
    },
  });
}

export default {
  fetch: createWorkerFetch({
    createMcpHandler: createDefaultMcpHandler,
  }),
};
