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
 * - Responses are parsed eagerly into memory. Streaming or large payloads
 *   are not a current concern given archive search page sizes (≤ 100 results).
 * - 204 and 205 "No Content" responses return `undefined as T`. Callers that
 *   care about the response type (e.g. `deleteNotification`) should declare
 *   their return type as `Promise<void>` to make this explicit.
 * - Any other 2xx response with an empty body throws rather than returning
 *   `undefined as T`. This makes unexpected empty bodies visible as errors
 *   instead of propagating as phantom `undefined` values through typed callers.
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
  OrderRedeliveryRequest,
  OrderTaskingRequest,
  PassPredictionRequest,
  PricingRequest,
  PricingResponse,
  WhoAmI,
  DeliverableType,
} from "./types";
import { parseJson } from "../lib/json.js";

function feasibilityDebugEnabled(): boolean {
  const value = process.env.SKYFI_DEBUG_FEASIBILITY?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function logFeasibilityDebug(
  phase: string,
  feasibilityId: string,
  result: FeasibilityResponse,
): void {
  if (!feasibilityDebugEnabled()) return;

  console.error(
    "[feasibility-debug]",
    JSON.stringify({
      phase,
      feasibilityId,
      status: result.status,
      opportunityCount: result.opportunities?.length ?? 0,
      providers: (result.providerScores ?? []).map((providerScore) => ({
        provider:
          typeof providerScore.provider === "string"
            ? providerScore.provider
            : undefined,
        status:
          typeof providerScore.status === "string"
            ? providerScore.status
            : undefined,
        opportunityCount: Array.isArray(providerScore.opportunities)
          ? providerScore.opportunities.length
          : 0,
      })),
    }),
  );
}

function inferFeasibilityStatus(record: Record<string, unknown>): string | undefined {
  if (typeof record.status === "string") {
    return record.status;
  }

  const overallScore = record.overallScore;
  if (overallScore === null || overallScore === undefined) {
    return "STARTED";
  }
  if (typeof overallScore !== "object" || Array.isArray(overallScore)) {
    return undefined;
  }

  const providerScore = (overallScore as Record<string, unknown>).providerScore;
  if (
    !providerScore ||
    typeof providerScore !== "object" ||
    Array.isArray(providerScore)
  ) {
    return "COMPLETE";
  }

  const providerScores = (providerScore as Record<string, unknown>).providerScores;
  if (Array.isArray(providerScores)) {
    const statuses = providerScores
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).status
          : undefined,
      )
      .filter((status): status is string => typeof status === "string");

    if (statuses.includes("PENDING")) return "PENDING";
    if (statuses.includes("PROCESSING")) return "PROCESSING";
    if (statuses.includes("STARTED")) return "STARTED";
    if (statuses.includes("ERROR")) return "ERROR";
    if (statuses.includes("COMPLETE")) return "COMPLETE";
  }

  // The current OpenAPI schema models a feasibility task response without a
  // required top-level status. Treat null/absent overallScore as still running,
  // otherwise assume the task is complete and inspectable.
  return "COMPLETE";
}

function extractFeasibilityProviderScores(
  record: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const overallScore = record.overallScore;
  if (!overallScore || typeof overallScore !== "object" || Array.isArray(overallScore)) {
    return [];
  }

  const providerScore = (overallScore as Record<string, unknown>).providerScore;
  if (
    !providerScore ||
    typeof providerScore !== "object" ||
    Array.isArray(providerScore)
  ) {
    return [];
  }

  const providerScores = (providerScore as Record<string, unknown>).providerScores;
  if (!Array.isArray(providerScores)) {
    return [];
  }

  return providerScores.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function extractFeasibilityOpportunities(
  providerScores: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return providerScores.flatMap((providerScore) => {
    const provider = providerScore.provider;
    const status = providerScore.status;
    const opportunities = providerScore.opportunities;
    if (!Array.isArray(opportunities)) return [];

    return opportunities
      .filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
      .map((opportunity) => ({
        ...opportunity,
        ...(typeof provider === "string" ? { provider } : {}),
        ...(typeof status === "string" ? { status } : {}),
      }));
  });
}

function normalizeFeasibilityResponse(payload: unknown): FeasibilityResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("SkyFi feasibility response must be a JSON object");
  }

  const record = payload as Record<string, unknown>;
  const feasibilityId =
    typeof record.feasibility_id === "string"
      ? record.feasibility_id
      : typeof record.id === "string"
        ? record.id
        : undefined;
  const providerScores = extractFeasibilityProviderScores(record);
  const opportunities = extractFeasibilityOpportunities(providerScores);
  const status = inferFeasibilityStatus(record);

  if (!feasibilityId) {
    throw new Error("SkyFi feasibility response missing feasibility_id");
  }

  return {
    ...record,
    feasibility_id: feasibilityId,
    status: status ?? "COMPLETE",
    opportunities,
    providerScores,
    overallScore:
      record.overallScore && typeof record.overallScore === "object"
        ? (record.overallScore as Record<string, unknown>)
        : record.overallScore === null
          ? null
          : undefined,
    validUntil: typeof record.validUntil === "string" ? record.validUntil : undefined,
  };
}

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
   * @throws {Error} When the server returns a 2xx status with an unexpectedly
   *   empty body (i.e. not 204/205). This surfaces misconfigured endpoints or
   *   upstream regressions rather than silently returning `undefined as T`.
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

    return parseJson(text) as T;
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
   * returns immediately with a `feasibility_id` and a normalized status. Callers
   * must poll via `getFeasibilityStatus` or use the convenience `pollFeasibility`
   * wrapper to wait for a terminal result.
   *
   * @param params - AOI, capture window, product type, and resolution constraints.
   * @returns Initial feasibility record with a normalized status.
   */
  async checkFeasibility(
    params: FeasibilityRequest,
  ): Promise<FeasibilityResponse> {
    const response = await this.request<unknown>("POST", "/feasibility", params);
    const result = normalizeFeasibilityResponse(response);
    logFeasibilityDebug("submit", result.feasibility_id, result);
    return result;
  }

  /**
   * Fetch the current status of a previously submitted feasibility check.
   *
   * @param feasibilityId - ID from a prior `checkFeasibility` response.
   */
  async getFeasibilityStatus(
    feasibilityId: string,
  ): Promise<FeasibilityResponse> {
    const response = await this.request<unknown>(
      "GET",
      `/feasibility/${feasibilityId}`,
    );
    const result = normalizeFeasibilityResponse(response);
    logFeasibilityDebug("poll", feasibilityId, result);
    return result;
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
   * the status is no longer in a running state. This method encapsulates
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
      if ((result.opportunities?.length ?? 0) > 0) {
        return result;
      }
      if (
        result.status !== "PENDING" &&
        result.status !== "PROCESSING" &&
        result.status !== "STARTED"
      ) {
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
   * go through the `orders_prepare` / `orders_confirm` tool pair rather than
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

  /**
   * Re-trigger delivery for an existing order using new destination settings.
   *
   * @param orderId - UUID of the order to redeliver.
   * @param params - New delivery target and driver-specific parameters.
   */
  async redeliverOrder(
    orderId: string,
    params: OrderRedeliveryRequest,
  ): Promise<Order> {
    return this.request("POST", `/orders/${orderId}/redelivery`, params);
  }

  /**
   * Resolve the signed download URL for a specific order deliverable.
   *
   * The upstream endpoint responds with an HTTP redirect. We disable automatic
   * redirect-following so the signed target URL can be surfaced to the caller
   * instead of downloading the file body inside the MCP server.
   *
   * @param orderId - UUID of the order.
   * @param deliverableType - One of image, payload, or cog.
   * @returns The signed download URL from the redirect target.
   */
  async getOrderDeliverableUrl(
    orderId: string,
    deliverableType: DeliverableType,
  ): Promise<string> {
    const path = `/orders/${orderId}/${deliverableType}`;
    const url = new URL(`${this.baseUrl}${path}`);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Skyfi-Api-Key": this.apiKey,
      },
      redirect: "manual",
    });

    if (!res.ok && (res.status < 300 || res.status >= 400)) {
      const text = await res.text();
      throw new Error(`SkyFi API GET ${path} failed (${res.status}): ${text}`);
    }

    const redirectUrl = res.headers.get("location");
    if (redirectUrl) {
      return redirectUrl;
    }

    if (res.redirected && res.url) {
      return res.url;
    }

    throw new Error(
      `SkyFi API GET ${path} did not return a redirect location (${res.status})`,
    );
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
