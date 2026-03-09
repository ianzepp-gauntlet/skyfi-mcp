/**
 * Unit tests for the `createApp` HTTP transport factory.
 *
 * These tests verify the transport layer's behavior without requiring a real
 * SkyFi API key or a running MCP client. The factory pattern makes this easy:
 * the `McpServerFactory` argument is replaced with a spy function that captures
 * what it was called with.
 *
 * Coverage focus: the per-request API key propagation path — ensuring that the
 * `x-skyfi-api-key` header is correctly extracted from the inbound HTTP request
 * and forwarded to the server factory so each session gets its own credentials.
 */

import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApp } from "./transport.js";

describe("createApp", () => {
  test("passes request API key header to the server factory", async () => {
    // Spy on which API keys the factory receives across calls.
    const seenHeaders: Array<string | undefined> = [];
    const app = createApp((headerApiKey) => {
      seenHeaders.push(headerApiKey);
      return new McpServer({ name: "test-server", version: "0.1.0" });
    });

    // WHY: Use accept: "text/event-stream" to trigger the stateless fallback
    // path (GET /mcp without a session ID), which still calls the factory.
    // This exercises the header extraction without needing to complete a full
    // MCP initialization handshake.
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
  });
});
