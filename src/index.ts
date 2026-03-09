import { loadConfig } from "./config/index.js";
import { createMcpServer } from "./server/mcp.js";
import { createApp } from "./server/transport.js";

const port = parseInt(process.env.PORT ?? "3000", 10);

const config = loadConfig();
const mcpServer = createMcpServer(config);
const app = createApp(mcpServer);

console.log(`SkyFi MCP server listening on http://localhost:${port}/mcp`);

export default {
  port,
  fetch: app.fetch,
};
