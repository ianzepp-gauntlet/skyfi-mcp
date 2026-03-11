/**
 * HTTP transport layer for the SkyFi MCP server.
 *
 * This module creates the Hono web application that exposes the MCP protocol
 * over HTTP. It handles three distinct concerns:
 *
 *  1. Session management — mapping inbound `mcp-session-id` headers to
 *     per-session MCP server + transport pairs, so that a single process can
 *     serve multiple concurrent MCP clients.
 *  2. API key propagation — extracting the `x-skyfi-api-key` header from the
 *     initial request and passing it to the server factory, enabling a shared
 *     server to authenticate each caller with their own SkyFi API key.
 *  3. Supplementary endpoints — a health check and an AOI webhook receiver.
 *
 * Architecture:
 * - All MCP traffic is routed through a single `/mcp` endpoint (any method)
 *   to match the Streamable HTTP transport spec from the MCP SDK.
 * - The factory function pattern (`McpServerFactory`) decouples transport from
 *   server construction, making both layers independently testable.
 * - Session state is held in a `Map` local to the `createApp` closure. This
 *   is intentionally process-local — no distributed session store is needed
 *   because each deployment instance handles its own sessions.
 * - Environment bindings are threaded through the factory so Cloudflare Workers
 *   can pass `c.env` (Worker env bindings) and Bun can fall through to
 *   `process.env` via the config layer.
 *
 * TRADE-OFFS:
 * - Sessions are held in memory indefinitely until the `onsessionclosed`
 *   callback fires. If a client disconnects without cleanly closing the session,
 *   its entry remains in the map. This is acceptable for the expected low
 *   number of concurrent MCP clients.
 * - The AOI webhook endpoint at `/webhooks/aoi` is a placeholder that logs
 *   and acknowledges all payloads. Real fanout logic is deferred to Phase 4.
 */

import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AlertStore } from "../tools/alerts.js";

/**
 * Holds the live MCP server and its bound transport for an active session.
 *
 * Both references are needed: the transport handles inbound HTTP requests,
 * and the server must be closed when the session ends to release any resources
 * it holds (e.g. open tool registrations).
 */
interface SessionContext {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

/**
 * Factory function that creates an `McpServer` for a new session.
 *
 * Receives the optional API key extracted from the HTTP request header and
 * the runtime environment bindings so the server can be constructed with
 * per-caller credentials. Returns a fully configured server that is not yet
 * connected to a transport.
 *
 * @param headerApiKey - API key from the `x-skyfi-api-key` request header.
 * @param env - Runtime environment bindings. On Cloudflare Workers this is
 *   `c.env` from the Hono context; on Bun/Node it can be omitted (the config
 *   layer falls through to `process.env`).
 */
type McpServerFactory = (
  headerApiKey?: string,
  env?: Record<string, string>,
) => McpServer;

type TransportFactoryOptions = {
  sessionIdGenerator?: () => string;
  onsessioninitialized?: (id: string) => void;
  onsessionclosed?: (id: string) => void;
};

type TransportFactory = (
  options: TransportFactoryOptions,
) => WebStandardStreamableHTTPServerTransport;

interface CreateAppOptions {
  /**
   * Session handling mode.
   *
   * - `stateful`: supports MCP session creation and resumption via an in-memory map.
   * - `stateless`: creates a fresh transport per request and rejects resumed sessions.
   */
  sessionMode?: "stateful" | "stateless";
  transportFactory?: TransportFactory;
  sessionIdGenerator?: () => string;
  /**
   * Shared alert store for persisting inbound AOI webhook payloads.
   * When provided, `POST /webhooks/aoi` writes alerts here instead of just logging.
   */
  alertStore?: AlertStore;
}

/**
 * HTTP header name for the caller-supplied SkyFi API key.
 *
 * Clients pass their SkyFi credentials via this header rather than in the MCP
 * protocol payload, since MCP has no built-in authentication mechanism.
 */
const INBOUND_API_KEY_HEADER = "x-skyfi-api-key";

/**
 * Create the Hono application that serves the SkyFi MCP server over HTTP.
 *
 * The returned app exposes three routes:
 * - `ALL /mcp` — MCP protocol endpoint (Streamable HTTP transport)
 * - `GET /health` — Simple liveness probe
 * - `POST /webhooks/aoi` — AOI change notification receiver (Phase 4 placeholder)
 *
 * @param createServer - Factory called once per new MCP session. Receives the
 *   API key from the request header and the runtime env bindings so per-session
 *   credentials can be bound at server construction time.
 * @returns A Hono application whose `fetch` handler is compatible with both
 *   Bun's `export default { fetch }` and Cloudflare Workers' module format.
 */
export function createApp(
  createServer: McpServerFactory,
  options: CreateAppOptions = {},
): Hono {
  const app = new Hono();
  const sessionMode = options.sessionMode ?? "stateful";
  const transportFactory =
    options.transportFactory ??
    ((transportOptions: TransportFactoryOptions) =>
      new WebStandardStreamableHTTPServerTransport(transportOptions));

  // Sessions are stored in a closure-local Map rather than a module-level
  // singleton so that each call to createApp (e.g. in tests) gets an isolated
  // session namespace.
  const sessions = new Map<string, SessionContext>();

  app.all("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    const headerApiKey = c.req.header(INBOUND_API_KEY_HEADER);

    // Thread runtime env bindings through to the factory. On Cloudflare
    // Workers, c.env contains Worker bindings (secrets, KV, etc.). On Bun,
    // c.env is empty and the config layer falls through to process.env.
    const env = (c.env ?? {}) as Record<string, string>;

    if (sessionMode === "stateless" && sessionId) {
      return new Response(
        JSON.stringify({
          error:
            "MCP session resumption is not supported in this deployment. Reconnect without mcp-session-id.",
        }),
        {
          status: 501,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // PHASE 1: EXISTING SESSION RESUMPTION
    // If the request carries a known session ID, route it directly to the
    // existing transport without creating new server/transport instances.
    // This is the hot path for all non-initialization requests.
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId)!;
      return transport.handleRequest(c.req.raw);
    }

    // PHASE 2: NEW SESSION INITIALIZATION
    // A POST without a session ID is the MCP initialization handshake.
    // Create a fresh server + transport pair, register lifecycle callbacks,
    // then handle the initialization request through the new transport.
    if (c.req.method === "POST" && !sessionId) {
      const server = createServer(headerApiKey, env);
      const transport = transportFactory({
        sessionIdGenerator:
          options.sessionIdGenerator ?? (() => crypto.randomUUID()),
        onsessioninitialized: (id) => {
          // Store both server and transport so we can close the server
          // when the session ends, not just remove the map entry.
          sessions.set(id, { server, transport });
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
          // Explicitly close the server to release any registered tool
          // handlers and prevent memory leaks in long-running processes.
          void server.close();
        },
      });

      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    }

    // PHASE 3: UNKNOWN SESSION — return a structured error
    // A request that carries a session ID not in our map means the session
    // was already closed or the request was routed to the wrong process.
    if (sessionId && !sessions.has(sessionId)) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // PHASE 4: STATELESS FALLBACK
    // Callers that do not use sessions (e.g. simple one-shot MCP clients) are
    // served by a stateless transport that creates a new server per request.
    // No session map entry is created. This is also the only mode used for
    // runtimes that cannot reliably guarantee per-session affinity.
    const server = createServer(headerApiKey, env);
    const transport = transportFactory({});
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Liveness probe for load balancers and orchestrators.
  app.get("/health", (c) => c.json({ status: "ok" }));

  // AOI webhook receiver — persists alerts to the shared AlertStore.
  // The SkyFi platform POSTs here when new imagery matches an AOI monitor.
  // Payloads are stored keyed by monitor ID so MCP tool handlers can retrieve them.
  app.post("/webhooks/aoi", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    console.log("[webhook] AOI notification received:", JSON.stringify(body));

    if (options.alertStore) {
      // The SkyFi webhook payload includes a notification_id (the monitor ID).
      // Fall back to "unknown" if the field is absent, so we never lose data.
      // Use String() to ensure we always have a string key regardless of payload shape.
      const payload =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>)
          : {};
      const monitorId = String(
        payload.notification_id ?? payload.notificationId ?? "unknown",
      );
      options.alertStore.add(monitorId, body);
    }

    return c.json({ received: true });
  });

  return app;
}
