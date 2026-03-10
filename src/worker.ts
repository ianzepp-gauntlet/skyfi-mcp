/**
 * SkyFi MCP Server — Cloudflare Workers entry point.
 *
 * This is the production deployment entry point for Cloudflare Workers. It
 * differs from the Bun entry point (`src/index.ts`) in two ways:
 *
 *  1. No filesystem access — there is no `~/.skyfi/config.json` loading.
 *     API keys come from the `x-skyfi-api-key` request header or from
 *     Worker environment bindings (set via `wrangler secret put`).
 *  2. No port binding — Workers receive requests through Cloudflare's edge
 *     network rather than listening on a TCP port.
 *
 * The core application (Hono routes, MCP server, tools) is shared with the
 * Bun entry point — only the bootstrap and config sourcing differ.
 *
 * Environment bindings are threaded to the config layer via the Hono context
 * (`c.env`), which the transport layer passes through the server factory.
 *
 * @see src/index.ts — Bun/Node.js entry point (filesystem config, TCP port).
 */

import { loadConfig } from "./config/index.js";
import { createMcpServer } from "./server/mcp.js";
import { createApp } from "./server/transport.js";

const app = createApp((headerApiKey, env) => {
  const config = loadConfig(headerApiKey, undefined, env);
  return createMcpServer(config);
});

export default {
  fetch: app.fetch,
};
