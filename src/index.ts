/**
 * SkyFi MCP Server — Bun entry point.
 *
 * This is the local development / self-hosted entry point that runs on Bun
 * (or Node.js). It differs from the Cloudflare Workers entry point
 * (`src/worker.ts`) in two ways:
 *
 *  1. It loads the optional `~/.skyfi/config.json` file for local developer
 *     convenience via `loadLocalConfig()`.
 *  2. It binds to a TCP port for direct HTTP serving.
 *
 * The core application (Hono routes, MCP server, tools) is shared with the
 * Workers entry point — only the bootstrap and config sourcing differ.
 *
 * @see src/worker.ts — Cloudflare Workers entry point (no filesystem, no port).
 */

import { loadConfig } from "./config/index.js";
import { loadLocalConfig } from "./config/local.js";
import { createMcpServer } from "./server/mcp.js";
import { createApp } from "./server/transport.js";
import { AlertStore } from "./tools/alerts.js";

const port = parseInt(process.env.PORT ?? "3000", 10);
const alertStore = new AlertStore();
const publicBaseUrl = process.env.SKYFI_MCP_PUBLIC_BASE_URL?.trim();
const defaultAoiWebhookUrl = publicBaseUrl
  ? new URL("/webhooks/aoi", `${publicBaseUrl.replace(/\/+$/, "")}/`).toString()
  : undefined;

const app = createApp(
  (headerApiKey, env) => {
    const localConfig = loadLocalConfig();
    const config = loadConfig(headerApiKey, localConfig, env);
    return createMcpServer(config, {
      alertStore,
      defaultAoiWebhookUrl,
    });
  },
  { alertStore },
);

console.log(`SkyFi MCP server listening on http://localhost:${port}/mcp`);

/**
 * Bun HTTP server export.
 * Bun picks up `port` and `fetch` from this default export automatically.
 */
export default {
  port,
  fetch: app.fetch,
};
