/**
 * SkyFi Platform API client.
 *
 * This module provides a typed HTTP client for the SkyFi Platform API
 * (https://app.skyfi.com/platform-api/redoc). It is the single boundary
 * between this MCP server and the upstream SkyFi service — all network calls
 * originate from this class.
 *
 * Architecture:
 * - `SkyFiClient` wraps every API endpoint in a typed method, handling auth
 *   headers, JSON serialization, query-string construction, and error mapping.
 * - A single private `request<T>` method centralizes the fetch-call pattern so
 *   each endpoint method only needs to express the HTTP verb, path, and payload.
 * - `pollFeasibility` is the only method with non-trivial control flow: it
 *   exists here rather than in a tool because polling is an inherent property
 *   of the feasibility API's asynchronous design.
 *
 * TRADE-OFFS:
 * - The client does not retry on transient failures. The MCP layer will surface
 *   errors directly to the AI caller, which can decide to retry.
 * - Responses are parsed eagerly with `JSON.parse`. Streaming or large payloads
 *   are not a current concern given archive search page sizes (≤ 100 results).
 * - 204 and 205 "No Content" responses return `undefined as T`. Callers that
 *   care about the response type (e.g. `deleteNotification`) should declare
 *   their return type as `Promise<void>` to make this explicit.
 */

import type { SkyFiConfig } from "../config";
import type {
  ArchiveSearchRequest,
  ArchiveSearchResponse,
  Archive,
  FeasibilityRequest,
  FeasibilityResponse,
  NotificationCreateRequest,
  Notification,
  NotificationListResponse,
  Order,
  OrderArchiveRequest,
  OrderListRequest,
  OrderListResponse,
  OrderTaskingRequest,
  PassPredictionRequest,
  PricingRequest,
  PricingResponse,
  WhoAmI,
} from "./types";

/**
 * Typed HTTP client for the SkyFi Platform API.
 *
 * Instantiate once per configuration context (i.e. per API key). The
 * `SkyFiConfig` is captured at construction time and used for every request.
 */
export class SkyFiClient {
  private baseUrl: string;
  private apiKey: string;

  /**
   * @param config - API key and base URL. Trailing slashes on `baseUrl` are
   *   stripped so path segments can always start with `/`.
   */
  constructor(config: SkyFiConfig) {
    // WHY: Strip trailing slash so all path segments can unconditionally start
    // with "/" without risking a double-slash in constructed URLs.
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  // ── Core HTTP layer ────────────────────────────────────────────────────────

  /**
   * Execute an authenticated HTTP request against the SkyFi API.
   *
   * Handles all cross-cutting concerns: authentication header injection,
   * query-string construction, JSON serialization/deserialization, and
   * HTTP error mapping.
   *
   * @param method - HTTP verb ("GET", "POST", "DELETE", etc.).
   * @param path - API path starting with "/" (appended to `baseUrl`).
   * @param body - Request body, serialized to JSON when present.
   * @param query - Key-value pairs appended as query parameters; `undefined`
   *   values are silently omitted so callers can spread optional params without
   *   filtering first.
   * @returns Parsed JSON response body, or `undefined` for 204/205 responses.
   * @throws {Error} When the server returns a non-2xx status, with the status
   *   code and response body in the message for diagnosability.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        // WHY: Omit undefined values rather than serializing them as the string
        // "undefined", which would be misinterpreted by the server.
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        "X-Skyfi-Api-Key": this.apiKey,
        // WHY: Only set Content-Type when there is a body — some servers reject
        // GET/DELETE requests that include a Content-Type header with no body.
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `SkyFi API ${method} ${path} failed (${res.status}): ${text}`,
      );
    }

    // EDGE: 204 No Content and 205 Reset Content both indicate success with no
    // body. Return undefined rather than attempting to parse an empty response.
    if (res.status === 204 || res.status === 205) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) {
      throw new Error(
        `SkyFi API ${method} ${path} returned empty body (${res.status})`,
      );
    }

    return JSON.parse(text) as T;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Verify the configured API key and retrieve the associated account identity.
   *
   * Useful as a connectivity/authentication smoke test before performing
   * operations that consume credits.
   */
  async whoami(): Promise<WhoAmI> {
    return this.request("GET", "/auth/whoami");
  }

  // ── Archives (Search) ─────────────────────────────────────────────────────

  /**
   * Submit an imagery catalog search with spatial and temporal filters.
   *
   * Returns the first page of matching scenes. To retrieve subsequent pages,
   * use the `next_page` cursor from the response with `getArchivesPage` —
   * do not re-submit the same search body with an incremented page offset.
   *
   * @param params - Spatial AOI, date range, and optional quality/type filters.
   */
  async searchArchives(
    params: ArchiveSearchRequest,
  ): Promise<ArchiveSearchResponse> {
    return this.request("POST", "/archives", params);
  }

  /**
   * Retrieve a subsequent page of archive search results using an opaque cursor.
   *
   * The `page` cursor is the `next_page` value from a prior `searchArchives` or
   * `getArchivesPage` response. Using this endpoint avoids re-executing the
   * search query and maintains consistent result ordering across pages.
   *
   * @param page - Opaque pagination cursor from `ArchiveSearchResponse.next_page`.
   */
  async getArchivesPage(page: string): Promise<ArchiveSearchResponse> {
    return this.request("GET", "/archives", undefined, { page });
  }

  /**
   * Fetch the full metadata record for a single archived scene.
   *
   * @param archiveId - The `archiveId` from a prior search result.
   */
  async getArchive(archiveId: string): Promise<Archive> {
    return this.request("GET", `/archives/${archiveId}`);
  }

  // ── Pricing ───────────────────────────────────────────────────────────────

  /**
   * Retrieve the pricing matrix for satellite imagery.
   *
   * Without an AOI, returns global pricing rates by product type, resolution,
   * and provider. Supplying an AOI may return area-specific rates.
   *
   * @param params - Optional AOI filter for area-specific pricing.
   */
  async getPricing(params?: PricingRequest): Promise<PricingResponse> {
    // WHY: POST an empty object rather than omitting the body entirely — the
    // SkyFi pricing endpoint requires a JSON body even for parameter-free calls.
    return this.request("POST", "/pricing", params ?? {});
  }

  // ── Feasibility ───────────────────────────────────────────────────────────

  /**
   * Submit a tasking feasibility check.
   *
   * Feasibility analysis is asynchronous: this call enqueues the check and
   * returns immediately with a `PENDING` status and a `feasibility_id`. Callers
   * must poll via `getFeasibilityStatus` or use the convenience `pollFeasibility`
   * wrapper to wait for a terminal result.
   *
   * @param params - AOI, capture window, product type, and resolution constraints.
   * @returns Initial feasibility record with `status: "PENDING"`.
   */
  async checkFeasibility(
    params: FeasibilityRequest,
  ): Promise<FeasibilityResponse> {
    return this.request("POST", "/feasibility", params);
  }

  /**
   * Fetch the current status of a previously submitted feasibility check.
   *
   * @param feasibilityId - ID from a prior `checkFeasibility` response.
   */
  async getFeasibilityStatus(
    feasibilityId: string,
  ): Promise<FeasibilityResponse> {
    return this.request("GET", `/feasibility/${feasibilityId}`);
  }

  /**
   * Query upcoming satellite overpasses for an AOI and time window.
   *
   * Unlike `checkFeasibility`, pass prediction does not apply product or
   * resolution constraints — it returns all expected passes regardless of
   * capture capability.
   *
   * @param params - AOI and time window for the pass prediction.
   */
  async getPassPrediction(params: PassPredictionRequest): Promise<unknown> {
    return this.request("POST", "/feasibility/pass-prediction", params);
  }

  /**
   * Poll a feasibility check until it reaches a terminal status or times out.
   *
   * Abstracts the polling loop that the SkyFi API requires: submitters call
   * `checkFeasibility`, then must repeatedly call `getFeasibilityStatus` until
   * the status is no longer PENDING or PROCESSING. This method encapsulates
   * that loop so tool implementations stay linear.
   *
   * EDGE: If the timeout is reached before a terminal status, the final
   * (non-terminal) status is returned rather than throwing. Callers can inspect
   * the status field to detect this case.
   *
   * @param feasibilityId - Feasibility check to poll.
   * @param opts.intervalMs - How long to wait between polls (default 3 s).
   * @param opts.timeoutMs - Maximum total wall time to poll (default 30 s).
   * @returns The last fetched feasibility response (terminal or timed-out).
   */
  async pollFeasibility(
    feasibilityId: string,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<FeasibilityResponse> {
    const interval = opts?.intervalMs ?? 3000;
    const timeout = opts?.timeoutMs ?? 30000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.getFeasibilityStatus(feasibilityId);
      if (result.status !== "PENDING" && result.status !== "PROCESSING") {
        return result;
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    // WHY: Return the last observed status rather than throwing, so the MCP
    // tool can surface a "still processing" message to the AI caller instead
    // of an opaque error.
    return this.getFeasibilityStatus(feasibilityId);
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  /**
   * List the caller's orders with optional type filtering and pagination.
   *
   * @param params - Optional filters and pagination controls.
   */
  async listOrders(params?: OrderListRequest): Promise<OrderListResponse> {
    return this.request("GET", "/orders", undefined, {
      orderType: params?.orderType,
      pageNumber: params?.pageNumber,
      pageSize: params?.pageSize,
    });
  }

  /**
   * Fetch full details for a single order by ID.
   *
   * @param orderId - UUID of the order to retrieve.
   */
  async getOrder(orderId: string): Promise<Order> {
    return this.request("GET", `/orders/${orderId}`);
  }

  /**
   * Purchase an existing archived scene.
   *
   * Immediately charges the account and initiates delivery. Callers should
   * go through the `prepare_order` / `confirm_order` tool pair rather than
   * calling this method directly from MCP tools, to enforce human-in-the-loop
   * approval before funds are committed.
   *
   * @param params - Archive ID, AOI sub-region, and delivery destination.
   */
  async createArchiveOrder(params: OrderArchiveRequest): Promise<Order> {
    return this.request("POST", "/order-archive", params);
  }

  /**
   * Commission a new satellite capture (tasking order).
   *
   * Schedules a future collect rather than purchasing existing imagery.
   * Same human-in-the-loop caution applies as for `createArchiveOrder`.
   *
   * @param params - AOI, capture window, quality constraints, and delivery destination.
   */
  async createTaskingOrder(params: OrderTaskingRequest): Promise<Order> {
    return this.request("POST", "/order-tasking", params);
  }

  // ── Notifications (AOI Monitoring) ────────────────────────────────────────

  /**
   * Create an AOI monitor that fires webhook callbacks when new imagery arrives.
   *
   * The monitor persists on the SkyFi platform until explicitly deleted via
   * `deleteNotification`. The returned `Notification.id` is the handle needed
   * for subsequent get/delete calls.
   *
   * @param params - Monitored AOI, webhook URL, and optional quality filters.
   */
  async createNotification(
    params: NotificationCreateRequest,
  ): Promise<Notification> {
    return this.request("POST", "/notifications", params);
  }

  /**
   * List AOI monitors belonging to the authenticated account.
   *
   * @param pageNumber - Zero-based page index.
   * @param pageSize - Maximum monitors to return per page.
   */
  async listNotifications(
    pageNumber?: number,
    pageSize?: number,
  ): Promise<NotificationListResponse> {
    return this.request("GET", "/notifications", undefined, {
      pageNumber,
      pageSize,
    });
  }

  /**
   * Fetch a single AOI monitor by its ID.
   *
   * @param notificationId - UUID of the monitor to retrieve.
   */
  async getNotification(notificationId: string): Promise<Notification> {
    return this.request("GET", `/notifications/${notificationId}`);
  }

  /**
   * Delete an AOI monitor, stopping future webhook callbacks for its AOI.
   *
   * The SkyFi API returns 204 No Content on success; this method returns
   * `void` to make that explicit.
   *
   * @param notificationId - UUID of the monitor to delete.
   */
  async deleteNotification(notificationId: string): Promise<void> {
    await this.request("DELETE", `/notifications/${notificationId}`);
  }
}
