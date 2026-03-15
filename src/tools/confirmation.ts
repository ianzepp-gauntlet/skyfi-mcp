/**
 * Human-in-the-loop confirmation store for satellite imagery orders.
 *
 * This module implements the two-step "prepare then confirm" ordering pattern
 * that prevents an AI from accidentally placing paid orders without explicit
 * human approval:
 *
 *  1. `orders_prepare` validates parameters, fetches pricing, and calls
 *     `ConfirmationStore.store()` to persist the order details. It returns a
 *     short-lived token and the pricing to the AI, which presents them to the
 *     user for review.
 *  2. After the user approves, the AI calls `orders_confirm` with the token.
 *     `ConfirmationStore.consume()` validates and retrieves the pending order,
 *     and the order is submitted to the SkyFi API.
 *
 * The store is ephemeral (in-memory, per-session) and tokens expire after a
 * configurable TTL. This means a user cannot accidentally confirm an order
 * they reviewed much earlier — they must go through the preparation step again
 * if the token has expired.
 *
 * Architecture:
 * - `ConfirmationStore` is instantiated once per call to `registerOrderTools`
 *   (i.e. once per MCP session). Tokens are not shared across sessions.
 * - TTL enforcement is lazy: expired tokens are purged on each `store` or
 *   `consume` call rather than on a timer. This avoids needing a background
 *   interval and keeps the class stateless with respect to time (it accepts
 *   an injectable `now` parameter for deterministic testing).
 *
 * TRADE-OFFS:
 * - Tokens are cryptographically random UUIDs, making them unguessable, but
 *   they are transmitted in plaintext within the MCP session. This is acceptable
 *   because the session itself is already authenticated.
 * - The store does not persist across process restarts. If the server restarts
 *   between prepare and confirm, the user must re-run prepare. This is
 *   intentional: a crashed server is a good reason to re-verify pricing.
 */

import type {
  OrderArchiveRequest,
  OrderTaskingRequest,
} from "../client/types.js";

/**
 * A pending order awaiting confirmation, stored between `orders_prepare` and
 * `orders_confirm` tool calls.
 *
 * All fields needed to place the actual API call are captured here so that
 * `orders_confirm` does not need to re-fetch or reconstruct anything — the
 * presence of a valid token is sufficient proof that the user reviewed and
 * approved the details stored here.
 */
/**
 * A pending order awaiting confirmation. Uses a discriminated union so that
 * narrowing on `type` also narrows `params` — no `as` casts needed at the
 * consumption site.
 */
export type PendingOrder = PendingArchiveOrder | PendingTaskingOrder;

interface PendingOrderBase {
  /** JSON-stringified pricing data shown to the user during the prepare step. */
  pricingSummary: string;
  /** Unix timestamp (ms) when this pending order was stored; used for TTL checks. */
  createdAt: number;
}

export interface PendingArchiveOrder extends PendingOrderBase {
  type: "archive";
  params: OrderArchiveRequest;
}

export interface PendingTaskingOrder extends PendingOrderBase {
  type: "tasking";
  params: OrderTaskingRequest;
}

type MaybePromise<T> = T | Promise<T>;

export interface ConfirmationStoreLike {
  store(
    order: Omit<PendingOrder, "createdAt">,
    now?: number,
  ): MaybePromise<string>;
  consume(token: string, now?: number): MaybePromise<PendingOrder | undefined>;
  restore(token: string, order: PendingOrder, now?: number): MaybePromise<void>;
}

/**
 * Single-use token store for the two-step order confirmation flow.
 *
 * Tokens are issued by `store()` and invalidated on first use by `consume()`.
 * Expired tokens are removed lazily on each mutation to avoid background timers.
 */
export class ConfirmationStore implements ConfirmationStoreLike {
  private pending = new Map<string, PendingOrder>();
  /** Maximum age of a pending order in milliseconds before it is considered expired. */
  private ttlMs: number;

  /**
   * @param ttlMs - Token time-to-live in milliseconds (default: 5 minutes).
   *   After this duration, tokens are rejected and the user must re-run
   *   `orders_prepare` to get a fresh token.
   */
  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Remove all tokens whose age exceeds the configured TTL.
   *
   * Called lazily before each `store` and `consume` so that expired entries
   * don't accumulate indefinitely without requiring a background timer.
   *
   * @param now - Current time in ms (injectable for deterministic testing).
   */
  cleanExpired(now = Date.now()) {
    for (const [token, order] of this.pending) {
      if (now - order.createdAt > this.ttlMs) {
        this.pending.delete(token);
      }
    }
  }

  /**
   * Persist a pending order and return a single-use confirmation token.
   *
   * The token is a cryptographically random UUID. Calling this method also
   * purges any expired tokens from prior interactions.
   *
   * @param order - Order details and pricing summary to store; `createdAt` is
   *   set automatically to the current time.
   * @param now - Current time in ms (injectable for deterministic testing).
   * @returns A UUID token to be returned to the AI for presentation to the user.
   */
  store(order: Omit<PendingOrder, "createdAt">, now = Date.now()): string {
    this.cleanExpired(now);
    const token = crypto.randomUUID();
    this.pending.set(token, { ...order, createdAt: now } as PendingOrder);
    return token;
  }

  /**
   * Retrieve and invalidate a pending order by its confirmation token.
   *
   * This is a single-use operation: once consumed, the token is deleted and
   * cannot be reused. This prevents double-submission if an AI calls
   * `orders_confirm` more than once with the same token.
   *
   * @param token - The token issued by a prior `store` call.
   * @param now - Current time in ms (injectable for deterministic testing).
   * @returns The pending order, or `undefined` if the token is invalid or expired.
   */
  consume(token: string, now = Date.now()): PendingOrder | undefined {
    this.cleanExpired(now);
    const order = this.pending.get(token);
    if (!order) return undefined;
    // WHY: Delete immediately after retrieval — the token is single-use by design.
    this.pending.delete(token);
    return order;
  }

  /**
   * Restore a token that was previously consumed when downstream work fails.
   *
   * This keeps the happy path single-use while allowing the caller to retry a
   * transient upstream failure without forcing a new prepare step.
   */
  restore(token: string, order: PendingOrder, now = Date.now()): void {
    this.cleanExpired(now);
    if (now - order.createdAt > this.ttlMs) return;
    this.pending.set(token, order);
  }

  /**
   * Number of non-expired pending orders currently in the store.
   *
   * NOTE: This count may include orders that are technically expired but have
   * not yet been purged by a `store` or `consume` call. It is intended for
   * testing and diagnostics, not for authoritative capacity checks.
   */
  get size(): number {
    return this.pending.size;
  }
}
