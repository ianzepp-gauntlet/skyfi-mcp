import type {
  ConfirmationStoreLike,
  PendingOrder,
} from "./tools/confirmation.js";

const CONFIRMATION_PREFIX = "confirm:";
const CONFIRMATION_PATH = "/confirmations";

export interface ConfirmationStoreNamespace {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
}

function confirmationKey(token: string): string {
  return `${CONFIRMATION_PREFIX}${token}`;
}

function isPendingOrder(value: unknown): value is PendingOrder {
  return !!value && typeof value === "object" && "type" in value && "params" in value;
}

/**
 * Shared Durable Object store for confirmation tokens.
 *
 * Unlike the in-memory store, this survives across MCP session boundaries so
 * prepare/confirm can still work when the client transport does not reuse the
 * exact same in-memory server instance.
 */
export class SkyFiConfirmationStore {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === CONFIRMATION_PATH) {
      const body = (await request.json()) as {
        token?: string;
        order?: PendingOrder;
      };
      if (!body.token || !body.order || !isPendingOrder(body.order)) {
        return Response.json(
          { error: "token and order are required" },
          { status: 400 },
        );
      }

      await this.state.storage.put(confirmationKey(body.token), body.order);
      return Response.json({ stored: true });
    }

    if (request.method === "POST" && url.pathname === `${CONFIRMATION_PATH}/consume`) {
      const body = (await request.json()) as {
        token?: string;
        now?: number;
        ttlMs?: number;
      };
      if (!body.token) {
        return Response.json({ error: "token is required" }, { status: 400 });
      }

      const stored = await this.state.storage.get<PendingOrder>(
        confirmationKey(body.token),
      );
      if (!stored || !isPendingOrder(stored)) {
        return Response.json({ order: null });
      }

      const now = body.now ?? Date.now();
      const ttlMs = body.ttlMs ?? 5 * 60 * 1000;
      if (now - stored.createdAt > ttlMs) {
        await this.state.storage.delete(confirmationKey(body.token));
        return Response.json({ order: null });
      }

      await this.state.storage.delete(confirmationKey(body.token));
      return Response.json({ order: stored });
    }

    if (request.method === "DELETE" && url.pathname.startsWith(`${CONFIRMATION_PATH}/`)) {
      const token = decodeURIComponent(url.pathname.slice(`${CONFIRMATION_PATH}/`.length));
      await this.state.storage.delete(confirmationKey(token));
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

/**
 * Durable Object backed confirmation-store client.
 */
export class DurableConfirmationStoreClient implements ConfirmationStoreLike {
  constructor(
    private namespace: ConfirmationStoreNamespace,
    private ttlMs = 5 * 60 * 1000,
    private objectName = "global",
  ) {}

  async store(order: Omit<PendingOrder, "createdAt">, now = Date.now()): Promise<string> {
    const token = crypto.randomUUID();
    const record: PendingOrder = { ...order, createdAt: now } as PendingOrder;
    const response = await this.stub().fetch(
      "https://confirmations.internal/confirmations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, order: record }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to store confirmation token: ${response.status}`);
    }
    return token;
  }

  async consume(
    token: string,
    now = Date.now(),
  ): Promise<PendingOrder | undefined> {
    const response = await this.stub().fetch(
      "https://confirmations.internal/confirmations/consume",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, now, ttlMs: this.ttlMs }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to consume confirmation token: ${response.status}`);
    }

    const body = (await response.json()) as { order?: PendingOrder | null };
    const order = body.order ?? undefined;
    if (!order) return undefined;
    if (now - order.createdAt > this.ttlMs) {
      return undefined;
    }
    return order;
  }

  async restore(token: string, order: PendingOrder, now = Date.now()): Promise<void> {
    if (now - order.createdAt > this.ttlMs) return;
    const response = await this.stub().fetch(
      "https://confirmations.internal/confirmations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, order }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to restore confirmation token: ${response.status}`);
    }
  }

  private stub() {
    return this.namespace.get(this.namespace.idFromName(this.objectName));
  }
}
