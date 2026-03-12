import { DurableAlertStoreClient } from "./alerts_object.js";
import type { AlertStoreLike } from "./tools/alerts.js";
import type { WorkerEnv } from "./worker.js";

function resolveMonitorId(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "unknown";
  }
  const payload = body as Record<string, unknown>;
  const rawId = payload.notification_id ?? payload.notificationId;
  return typeof rawId === "string" && rawId.length > 0 ? rawId : "unknown";
}

async function handleAoiWebhook(
  request: Request,
  alertStore: AlertStoreLike,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  await alertStore.add(resolveMonitorId(body), (body ?? {}) as Record<string, unknown>);
  return Response.json({ received: true });
}

export function createWorkerFetch(options?: {
  createAlertStore?: (env: WorkerEnv) => AlertStoreLike;
  createMcpHandler?: (
    env: WorkerEnv,
  ) => (request: Request, ctx: ExecutionContext) => Promise<Response>;
}) {
  return async function fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const alertStore =
      options?.createAlertStore?.(env) ?? new DurableAlertStoreClient(env.ALERT_STORE);

    if (url.pathname === "/mcp") {
      const mcpHandler = options?.createMcpHandler?.(env);
      if (!mcpHandler) {
        throw new Error("MCP handler factory is required");
      }
      return mcpHandler(request, ctx);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/webhooks/aoi" && request.method === "POST") {
      return handleAoiWebhook(request, alertStore);
    }

    return new Response("Not found", { status: 404 });
  };
}
