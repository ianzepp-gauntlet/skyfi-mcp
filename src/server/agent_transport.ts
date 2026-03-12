import type { Agent } from "agents";
import {
  InitializeRequestSchema,
  JSONRPCMessageSchema,
  isJSONRPCNotification,
  isJSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";

const MCP_HTTP_METHOD_HEADER = "cf-mcp-method";
const MCP_MESSAGE_HEADER = "cf-mcp-message";
const MAXIMUM_MESSAGE_SIZE_BYTES = 4 * 1024 * 1024;
const CF_MCP_AGENT_EVENT = "cf_mcp_agent_event";

type AgentGetter = (
  namespace: DurableObjectNamespace<any>,
  name: string,
  options?: { props?: Record<string, unknown> },
) => Promise<any>;

async function getDefaultAgentByName(
  namespace: DurableObjectNamespace<any>,
  name: string,
  options?: { props?: Record<string, unknown> },
) {
  const mod = await import("agents");
  return (mod.getAgentByName as any)(namespace, name, options);
}

export interface AgentMcpHandlerOptions<
  T extends Agent<Cloudflare.Env> = Agent<Cloudflare.Env>,
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  namespace: DurableObjectNamespace<T>;
  getPropsForInit?: (request: Request) => Props | undefined;
  getAgent?: AgentGetter;
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
): Response {
  return Response.json(
    {
      error: { code, message },
      id: null,
      jsonrpc: "2.0",
    },
    { status },
  );
}

function cloneHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function parseJsonValue(text: string): unknown {
  return JSON["parse"](text);
}

/**
 * Streamable HTTP MCP handler for Cloudflare Agents with request-derived props.
 *
 * This mirrors the built-in `McpAgent.serve()` transport, but lets the caller
 * attach props on the initialization request so per-session credentials can be
 * persisted inside the Durable Object.
 */
export function createAgentMcpHandler<
  T extends Agent<Cloudflare.Env> = Agent<Cloudflare.Env>,
  Props extends Record<string, unknown> = Record<string, unknown>,
>({
  namespace,
  getPropsForInit,
  getAgent: getAgentImpl = getDefaultAgentByName,
}: AgentMcpHandlerOptions<T, Props>) {
  return async function handleMcpRequest(
    request: Request,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method === "POST") {
      const acceptHeader = request.headers.get("accept");
      if (
        !acceptHeader?.includes("application/json") ||
        !acceptHeader.includes("text/event-stream")
      ) {
        return jsonRpcError(
          406,
          -32_227,
          "Not Acceptable: Client must accept both application/json and text/event-stream",
        );
      }

      const contentType = request.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        return jsonRpcError(
          415,
          -32_227,
          "Unsupported Media Type: Content-Type must be application/json",
        );
      }

      if (
        Number.parseInt(request.headers.get("content-length") ?? "0", 10) >
        MAXIMUM_MESSAGE_SIZE_BYTES
      ) {
        return jsonRpcError(
          413,
          -32_227,
          `Request body too large. Maximum size is ${MAXIMUM_MESSAGE_SIZE_BYTES} bytes`,
        );
      }

      let rawMessage: unknown;
      try {
        rawMessage = await request.json();
      } catch {
        return jsonRpcError(400, -32_700, "Parse error: Invalid JSON");
      }

      const arrayMessage = Array.isArray(rawMessage) ? rawMessage : [rawMessage];
      if (
        arrayMessage.some((message) => !JSONRPCMessageSchema.safeParse(message).success)
      ) {
        return jsonRpcError(
          400,
          -32_700,
          "Parse error: Invalid JSON-RPC message",
        );
      }

      const messages = arrayMessage.map((message) =>
        JSONRPCMessageSchema.parse(message),
      );
      const maybeInitializeRequest = messages.find((message) =>
        InitializeRequestSchema.safeParse(message).success,
      );

      let sessionId = request.headers.get("mcp-session-id");
      if (maybeInitializeRequest && sessionId) {
        return jsonRpcError(
          400,
          -32_600,
          "Invalid Request: Initialization requests must not include a sessionId",
        );
      }
      if (maybeInitializeRequest && messages.length > 1) {
        return jsonRpcError(
          400,
          -32_600,
          "Invalid Request: Only one initialization request is allowed",
        );
      }
      if (!maybeInitializeRequest && !sessionId) {
        return jsonRpcError(
          400,
          -32_227,
          "Bad Request: Mcp-Session-Id header is required",
        );
      }

      sessionId = sessionId ?? namespace.newUniqueId().toString();
      const props = maybeInitializeRequest ? getPropsForInit?.(request) : undefined;
      const agent = (await getAgentImpl(
        namespace,
        `streamable-http:${sessionId}`,
        props ? { props } : undefined,
      )) as any;
      const initialized = await agent.getInitializeRequest();

      if (maybeInitializeRequest) {
        await agent.setInitializeRequest(maybeInitializeRequest);
      } else if (!initialized) {
        return jsonRpcError(404, -32_001, "Session not found");
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const headers = cloneHeaders(request);
      const ws = (
        await agent.fetch(
          new Request(request.url, {
            headers: {
              ...headers,
              [MCP_HTTP_METHOD_HEADER]: "POST",
              [MCP_MESSAGE_HEADER]: Buffer.from(
                JSON.stringify(messages),
              ).toString("base64"),
              Upgrade: "websocket",
            },
          }),
        )
      ).webSocket;

      if (!ws) {
        await writer.close().catch(() => {});
        return jsonRpcError(
          500,
          -32_001,
          "Failed to establish WebSocket connection",
        );
      }

      ws.accept();
      ws.addEventListener("message", (event: MessageEvent) => {
        (async () => {
          const data =
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data);
          const message = parseJsonValue(data) as {
            type?: string;
            event?: string;
            close?: boolean;
          };
          if (message.type !== CF_MCP_AGENT_EVENT) {
            return;
          }
          await writer.write(encoder.encode(message.event));
          if (message.close) {
            ws.close();
            await writer.close().catch(() => {});
          }
        })().catch(() => {});
      });
      ws.addEventListener("error", () => {
        writer.close().catch(() => {});
      });
      ws.addEventListener("close", () => {
        writer.close().catch(() => {});
      });

      if (
        messages.every(
          (message) =>
            isJSONRPCNotification(message) || isJSONRPCResultResponse(message),
        )
      ) {
        ws.close();
        return new Response(null, { status: 202 });
      }

      return new Response(readable, {
        status: 200,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
          "mcp-session-id": sessionId,
        },
      });
    }

    if (request.method === "GET") {
      if (!request.headers.get("accept")?.includes("text/event-stream")) {
        return jsonRpcError(
          406,
          -32_227,
          "Not Acceptable: Client must accept text/event-stream",
        );
      }

      const sessionId = request.headers.get("mcp-session-id");
      if (!sessionId) {
        return jsonRpcError(
          400,
          -32_227,
          "Bad Request: Mcp-Session-Id header is required",
        );
      }

      const agent = (await getAgentImpl(
        namespace,
        `streamable-http:${sessionId}`,
      )) as any;
      if (!(await agent.getInitializeRequest())) {
        return jsonRpcError(404, -32_001, "Session not found");
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const headers = cloneHeaders(request);
      const ws = (
        await agent.fetch(
          new Request(request.url, {
            headers: {
              ...headers,
              [MCP_HTTP_METHOD_HEADER]: "GET",
              Upgrade: "websocket",
            },
          }),
        )
      ).webSocket;

      if (!ws) {
        await writer.close().catch(() => {});
        return new Response("Failed to establish WS to DO", { status: 500 });
      }

      ws.accept();
      ws.addEventListener("message", (event: MessageEvent) => {
        (async () => {
          const data =
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data);
          const message = parseJsonValue(data) as {
            type?: string;
            event?: string;
          };
          if (message.type !== CF_MCP_AGENT_EVENT) {
            return;
          }
          await writer.write(encoder.encode(message.event));
        })().catch(() => {});
      });
      ws.addEventListener("error", () => {
        writer.close().catch(() => {});
      });
      ws.addEventListener("close", () => {
        writer.close().catch(() => {});
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
          "mcp-session-id": sessionId,
        },
      });
    }

    if (request.method === "DELETE") {
      const sessionId = request.headers.get("mcp-session-id");
      if (!sessionId) {
        return jsonRpcError(
          400,
          -32_227,
          "Bad Request: Mcp-Session-Id header is required",
        );
      }

      const agent = (await getAgentImpl(
        namespace,
        `streamable-http:${sessionId}`,
      )) as any;
      if (!(await agent.getInitializeRequest())) {
        return jsonRpcError(404, -32_001, "Session not found");
      }

      ctx.waitUntil(agent.destroy().catch(() => {}));
      return new Response(null, { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  };
}
