import type { OrderArchiveRequest, OrderTaskingRequest } from "../client/types.js";

export interface PendingOrder {
  type: "archive" | "tasking";
  params: OrderArchiveRequest | OrderTaskingRequest;
  pricingSummary: string;
  createdAt: number;
}

export class ConfirmationStore {
  private pending = new Map<string, PendingOrder>();
  private ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** Remove all expired tokens. */
  cleanExpired(now = Date.now()) {
    for (const [token, order] of this.pending) {
      if (now - order.createdAt > this.ttlMs) {
        this.pending.delete(token);
      }
    }
  }

  /** Store a pending order and return its confirmation token. */
  store(order: Omit<PendingOrder, "createdAt">, now = Date.now()): string {
    this.cleanExpired(now);
    const token = crypto.randomUUID();
    this.pending.set(token, { ...order, createdAt: now });
    return token;
  }

  /** Consume a token — returns the pending order and deletes the token, or undefined if invalid/expired. */
  consume(token: string, now = Date.now()): PendingOrder | undefined {
    this.cleanExpired(now);
    const order = this.pending.get(token);
    if (!order) return undefined;
    this.pending.delete(token);
    return order;
  }

  /** Number of active (non-expired) pending orders. */
  get size(): number {
    return this.pending.size;
  }
}
