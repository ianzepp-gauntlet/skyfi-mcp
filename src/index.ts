/**
 * SkyFi MCP Server — entry point.
 *
 * Bootstraps the application by wiring together configuration loading, MCP
 * server construction, and the HTTP transport, then exports a Bun-compatible
 * server object.
 *
 * Architecture:
 * - Config is resolved lazily, once per MCP session, via the factory passed to
 *   `createApp`. This allows the API key to be supplied per-request via the
 *   `x-skyfi-api-key` header rather than fixed at startup.
 * - The MCP server itself is also created per session inside `createApp` (via
 *   `createMcpServer`), so each connected client gets an isolated server
 *   instance bound to its own credentials.
 * - Port defaults to 3000 but can be overridden via the `PORT` env var, which
 *   is the standard convention for container and platform deployments.
 *
 * The server listens at `/mcp` (MCP protocol) and `/health` (liveness probe).
 * See `src/server/transport.ts` for all route definitions.
 */

import { loadConfig } from "./config/index.js";
import { createMcpServer } from "./server/mcp.js";
import { createApp } from "./server/transport.js";

const port = parseInt(process.env.PORT ?? "3000", 10);

const app = createApp((headerApiKey) => {
  // WHY: Config is resolved inside the factory so the per-request API key
  // header is incorporated. If config resolution fails (e.g. no API key found),
  // the error surfaces as an MCP session initialization failure rather than
  // preventing the server from starting entirely.
  const config = loadConfig(headerApiKey);
  return createMcpServer(config);
});

console.log(`SkyFi MCP server listening on http://localhost:${port}/mcp`);

/**
 * Bun HTTP server export.
 * Bun picks up `port` and `fetch` from this default export automatically.
 */
export default {
  port,
  fetch: app.fetch,
};
