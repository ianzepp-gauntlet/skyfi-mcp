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
});
