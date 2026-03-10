/**
 * In-memory AOI alert store.
 *
 * Receives webhook payloads from the SkyFi platform (via `POST /webhooks/aoi`)
 * and makes them available to MCP tool handlers (`get_aoi_alerts`). This is the
 * bridge between the HTTP transport layer (which receives webhooks) and the MCP
 * session layer (which serves tool calls).
 *
 * The store is instantiated once at the app level and shared across all MCP
 * sessions, because webhook deliveries are not session-scoped — the SkyFi
 * platform posts to a single endpoint regardless of which MCP client created
 * the monitor.
 *
 * Alerts are keyed by monitor ID and stored in reverse chronological order
 * (newest first). A configurable maximum per monitor prevents unbounded growth.
 *
 * TRADE-OFFS:
 * - In-memory only: alerts are lost on process restart. This is acceptable for
 *   the PoC; a SQLite or PostgreSQL backend can be added later without changing
 *   the tool interface.
 * - No deduplication: if SkyFi retries a webhook delivery, the same alert may
 *   appear twice. This is harmless for display purposes.
 */

/** A single AOI alert received via webhook. */
export interface AoiAlert {
  /** Monitor/notification ID this alert belongs to. */
  monitorId: string;
  /** The raw webhook payload from SkyFi. */
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp when the alert was received. */
  receivedAt: string;
}

/**
 * In-memory store for AOI webhook alerts.
 *
 * Thread-safe in single-threaded JS runtimes (Bun, Workers, Node). The store
 * is designed to be instantiated once and passed to both the transport layer
 * (for writes) and the MCP server factory (for reads via tool handlers).
 */
export class AlertStore {
  private alerts = new Map<string, AoiAlert[]>();
  private maxPerMonitor: number;

  /**
   * @param maxPerMonitor - Maximum alerts to retain per monitor ID.
   *   Oldest alerts are dropped when this limit is exceeded. Default: 100.
   */
  constructor(maxPerMonitor = 100) {
    this.maxPerMonitor = maxPerMonitor;
  }

  /**
   * Record an incoming webhook alert.
   *
   * @param monitorId - The monitor/notification ID from the webhook payload.
   * @param payload - The full webhook payload body.
   * @param now - Current time as ISO string (injectable for testing).
   */
  add(monitorId: string, payload: Record<string, unknown>, now?: string): void {
    const alert: AoiAlert = {
      monitorId,
      payload,
      receivedAt: now ?? new Date().toISOString(),
    };

    const existing = this.alerts.get(monitorId) ?? [];
    // Prepend (newest first) and trim to max.
    existing.unshift(alert);
    if (existing.length > this.maxPerMonitor) {
      existing.length = this.maxPerMonitor;
    }
    this.alerts.set(monitorId, existing);
  }

  /**
   * Retrieve alerts for a specific monitor.
   *
   * @param monitorId - The monitor to query.
   * @param limit - Maximum number of alerts to return (default: 25).
   * @returns Alerts in reverse chronological order (newest first).
   */
  get(monitorId: string, limit = 25): AoiAlert[] {
    const existing = this.alerts.get(monitorId) ?? [];
    return existing.slice(0, limit);
  }

  /**
   * Retrieve all stored alerts across all monitors.
   *
   * @param limit - Maximum total alerts to return (default: 50).
   * @returns Alerts sorted by receivedAt descending (newest first).
   */
  getAll(limit = 50): AoiAlert[] {
    const all: AoiAlert[] = [];
    for (const alerts of this.alerts.values()) {
      all.push(...alerts);
    }
    all.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return all.slice(0, limit);
  }

  /**
   * Remove all alerts for a specific monitor.
   * Useful when a monitor is deleted.
   */
  clear(monitorId: string): void {
    this.alerts.delete(monitorId);
  }

  /** Total number of alerts across all monitors. */
  get size(): number {
    let total = 0;
    for (const alerts of this.alerts.values()) {
      total += alerts.length;
    }
    return total;
  }
}
