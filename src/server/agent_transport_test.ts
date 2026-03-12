import { describe, expect, test } from "bun:test";
import { createAgentMcpHandler } from "./agent_transport.js";

describe("createAgentMcpHandler", () => {
  test("binds request header props on initialization", async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const socket = {
      accept() {},
      addEventListener() {},
      close() {},
    };

    const handler = createAgentMcpHandler({
      namespace: {
        newUniqueId: () => ({ toString: () => "session-1" }),
      } as never,
      getPropsForInit: (request) => ({
        skyfiApiKey: request.headers.get("x-skyfi-api-key") ?? undefined,
      }),
      getAgent: async (_namespace, _name, options) => {
        seen.push(options?.props);
        return {
          getInitializeRequest: async () => undefined,
          setInitializeRequest: async () => undefined,
          fetch: async () =>
            new Response(null, {
              status: 101,
              webSocket: socket as any,
            }),
        } as never;
      },
    });

    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "x-skyfi-api-key": "header-key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      }),
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(500);
    expect(seen).toEqual([{ skyfiApiKey: "header-key" }]);
  });
});
