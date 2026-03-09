import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createApp(mcpServer: McpServer): Hono {
  const app = new Hono();

  // Map of session ID → transport
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  app.all("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    // For existing sessions, reuse the transport
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      return transport.handleRequest(c.req.raw);
    }

    // For new sessions (POST without session ID = initialization)
    if (c.req.method === "POST" && !sessionId) {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
      });

      await mcpServer.connect(transport);
      return transport.handleRequest(c.req.raw);
    }

    // Invalid session
    if (sessionId && !transports.has(sessionId)) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fallback: stateless transport for GET/DELETE without session
    const transport = new WebStandardStreamableHTTPServerTransport({});
    await mcpServer.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // AOI webhook receiver (placeholder for Phase 4)
  app.post("/webhooks/aoi", async (c) => {
    const body = await c.req.json();
    console.log("[webhook] AOI notification received:", JSON.stringify(body));
    return c.json({ received: true });
  });

  return app;
}
