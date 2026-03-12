import type { AoiAlert, AlertStoreLike } from "./tools/alerts.js";

const ALERTS_PREFIX = "alerts:";
const ALERTS_PATH = "/alerts";

function alertKey(monitorId: string): string {
  return `${ALERTS_PREFIX}${monitorId}`;
}

function parseAlertList(value: unknown): AoiAlert[] {
  return Array.isArray(value) ? (value as AoiAlert[]) : [];
}

/**
 * Shared Durable Object store for AOI webhook alerts.
 *
 * This object is intentionally global rather than session-scoped so webhook
 * deliveries and MCP sessions can observe the same alert history.
 */
export class SkyFiAlertStore {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === ALERTS_PATH) {
      const body = (await request.json()) as {
        monitorId?: string;
        payload?: Record<string, unknown>;
        receivedAt?: string;
      };

      if (!body.monitorId || !body.payload) {
        return Response.json(
          { error: "monitorId and payload are required" },
          { status: 400 },
        );
      }

      await this.add(body.monitorId, body.payload, body.receivedAt);
      return Response.json({ stored: true });
    }

    if (request.method === "GET" && url.pathname === ALERTS_PATH) {
      const monitorId = url.searchParams.get("monitor_id");
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? parseInt(limitParam, 10) : undefined;
      const alerts = monitorId
        ? await this.get(monitorId, limit)
        : await this.getAll(limit);
      return Response.json({ alerts });
    }

    if (
      request.method === "DELETE" &&
      url.pathname.startsWith(`${ALERTS_PATH}/`)
    ) {
      const monitorId = decodeURIComponent(
        url.pathname.slice(`${ALERTS_PATH}/`.length),
      );
      await this.clear(monitorId);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  async add(
    monitorId: string,
    payload: Record<string, unknown>,
    now?: string,
  ): Promise<void> {
    const alerts = await this.readAlerts(monitorId);
    alerts.unshift({
      monitorId,
      payload,
      receivedAt: now ?? new Date().toISOString(),
    });
    if (alerts.length > 100) {
      alerts.length = 100;
    }
    await this.state.storage.put(alertKey(monitorId), alerts);
  }

  async get(monitorId: string, limit = 25): Promise<AoiAlert[]> {
    const alerts = await this.readAlerts(monitorId);
    return alerts.slice(0, limit);
  }

  async getAll(limit = 50): Promise<AoiAlert[]> {
    const stored = await this.state.storage.list<AoiAlert[]>({
      prefix: ALERTS_PREFIX,
    });
    const alerts: AoiAlert[] = [];
    for (const value of stored.values()) {
      alerts.push(...parseAlertList(value));
    }
    alerts.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return alerts.slice(0, limit);
  }

  async clear(monitorId: string): Promise<void> {
    await this.state.storage.delete(alertKey(monitorId));
  }

  private async readAlerts(monitorId: string): Promise<AoiAlert[]> {
    const stored = await this.state.storage.get<AoiAlert[]>(
      alertKey(monitorId),
    );
    return parseAlertList(stored);
  }
}

/**
 * Client wrapper that exposes the durable alert store through the same
 * interface the tool layer already expects.
 */
export class DurableAlertStoreClient implements AlertStoreLike {
  constructor(
    private namespace: DurableObjectNamespace<any>,
    private objectName = "global",
  ) {}

  async add(
    monitorId: string,
    payload: Record<string, unknown>,
    now?: string,
  ): Promise<void> {
    const response = await this.stub().fetch("https://alerts.internal/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monitorId, payload, receivedAt: now }),
    });
    if (!response.ok) {
      throw new Error(`Failed to store alert: ${response.status}`);
    }
  }

  async get(monitorId: string, limit = 25): Promise<AoiAlert[]> {
    const response = await this.stub().fetch(
      `https://alerts.internal/alerts?monitor_id=${encodeURIComponent(monitorId)}&limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to load alerts: ${response.status}`);
    }
    const body = (await response.json()) as { alerts?: AoiAlert[] };
    return parseAlertList(body.alerts);
  }

  async getAll(limit = 50): Promise<AoiAlert[]> {
    const response = await this.stub().fetch(
      `https://alerts.internal/alerts?limit=${limit}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to load alerts: ${response.status}`);
    }
    const body = (await response.json()) as { alerts?: AoiAlert[] };
    return parseAlertList(body.alerts);
  }

  async clear(monitorId: string): Promise<void> {
    const response = await this.stub().fetch(
      `https://alerts.internal/alerts/${encodeURIComponent(monitorId)}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to clear alerts: ${response.status}`);
    }
  }

  private stub() {
    const namespace = this.namespace as any;
    return namespace.get(namespace.idFromName(this.objectName));
  }
}
