/**
 * Unit tests for the `createApp` HTTP transport factory.
 *
 * These tests verify the transport layer's behavior without requiring a real
 * SkyFi API key or a running MCP client. The factory pattern makes this easy:
 * the `McpServerFactory` argument is replaced with a spy function that captures
 * what it was called with.
 *
 * Coverage focus: the per-request API key and env bindings propagation path —
 * ensuring that the `x-skyfi-api-key` header and runtime env are correctly
 * extracted from the inbound HTTP request and forwarded to the server factory.
 */

import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApp } from "./transport.js";

describe("createApp", () => {
  test("passes request API key header and env to the server factory", async () => {
    const seenHeaders: Array<string | undefined> = [];
    const seenEnvs: Array<Record<string, string> | undefined> = [];
    const app = createApp((headerApiKey, env) => {
      seenHeaders.push(headerApiKey);
      seenEnvs.push(env);
      return new McpServer({ name: "test-server", version: "0.1.0" });
    });

    await app.fetch(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "x-skyfi-api-key": "header-key",
        },
      }),
      {} as never
    );

    expect(seenHeaders).toEqual(["header-key"]);
    expect(seenEnvs.length).toBe(1);
  });

  test("rejects resumed sessions in stateless mode", async () => {
    const app = createApp(
      () => new McpServer({ name: "test-server", version: "0.1.0" }),
      { sessionMode: "stateless" }
    );

    const response = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "existing-session",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      {} as never
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error:
        "MCP session resumption is not supported in this deployment. Reconnect without mcp-session-id.",
    });
  });
  test("returns 404 for unknown session id", async () => {
    const app = createApp(
      () => new McpServer({ name: "test-server", version: "0.1.0" }),
      { sessionMode: "stateful" }
    );

    const response = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: {
          "mcp-session-id": "missing-session",
        },
      }),
      {} as never
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Session not found" });
  });

  test("health endpoint returns ok", async () => {
    const app = createApp(() => new McpServer({ name: "test-server", version: "0.1.0" }));
    const response = await app.fetch(new Request("http://localhost/health", { method: "GET" }), {} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  test("aoi webhook endpoint acknowledges payload", async () => {
    const app = createApp(() => new McpServer({ name: "test-server", version: "0.1.0" }));
    const response = await app.fetch(
      new Request("http://localhost/webhooks/aoi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "created", id: "abc" }),
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  test("stateful mode reuses initialized session transport and closes server on session close", async () => {
    const createdServers: Array<{ connect: (t: unknown) => Promise<void>; close: () => Promise<void> }> = [];
    const transportCalls: string[] = [];
    const sessionCallbacks: { initialized?: (id: string) => void; closed?: (id: string) => void } = {};
    let closeCalls = 0;

    const app = createApp(
      () => {
        const server = {
          connect: async () => undefined,
          close: async () => {
            closeCalls += 1;
          },
        };
        createdServers.push(server);
        return server as unknown as McpServer;
      },
      {
        sessionMode: "stateful",
        sessionIdGenerator: () => "session-1",
        transportFactory: (options) => {
          sessionCallbacks.initialized = options.onsessioninitialized;
          sessionCallbacks.closed = options.onsessionclosed;
          return {
            handleRequest: async (req: Request) => {
              transportCalls.push(req.headers.get("mcp-session-id") ?? "none");
              if (!req.headers.get("mcp-session-id")) {
                options.onsessioninitialized?.("session-1");
              }
              return new Response(JSON.stringify({ ok: true }), { status: 200 });
            },
          } as any;
        },
      }
    );

    const initResponse = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      {} as never
    );
    expect(initResponse.status).toBe(200);

    const resumedResponse = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: { "mcp-session-id": "session-1" },
      }),
      {} as never
    );
    expect(resumedResponse.status).toBe(200);

    sessionCallbacks.closed?.("session-1");

    expect(createdServers).toHaveLength(1);
    expect(closeCalls).toBe(1);
    expect(transportCalls).toEqual(["none", "session-1"]);

    const missingAfterClose = await app.fetch(
      new Request("http://localhost/mcp", {
        method: "GET",
        headers: { "mcp-session-id": "session-1" },
      }),
      {} as never
    );
    expect(missingAfterClose.status).toBe(404);
  });
});
