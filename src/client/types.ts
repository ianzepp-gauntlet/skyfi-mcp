/**
 * SkyFi API domain types — derived from https://app.skyfi.com/platform-api/redoc
 *
 * These types model the SkyFi Platform API's request/response contracts. They are
 * intentionally kept as plain data shapes (no methods, no logic) so they can be
 * safely shared across the client, tool, and test layers without pulling in any
 * runtime dependencies.
 *
 * TRADE-OFFS:
 * - Fields with open-ended server extensions use `[key: string]: unknown` index
 *   signatures. This is permissive but avoids silent data loss when the API adds
 *   new fields that callers don't yet model.
 * - `PricingResponse` is typed as `Record<string, unknown>` because the pricing
 *   matrix structure varies by provider and is passed through to the MCP caller
 *   verbatim rather than being decomposed here.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────
// String literal unions rather than TypeScript enums: they produce simpler
// compiled output and are directly comparable to API-returned strings without
// a reverse-lookup step.

/** Satellite capture modality. DAY = panchromatic/optical, SAR = radar. */
export type ProductType = "DAY" | "MULTISPECTRAL" | "SAR";

/**
 * Spatial resolution tier. Maps loosely to ground sample distance (GSD):
 * LOW ≥ 10 m, MEDIUM ~3–10 m, HIGH ~1–3 m, VERY HIGH ~0.5–1 m, ULTRA HIGH < 0.5 m.
 */
export type Resolution =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "VERY HIGH"
  | "SUPER HIGH"
  | "ULTRA HIGH";

/** Cloud storage provider for imagery delivery. */
export type DeliveryDriver = "S3" | "GS" | "AZURE";

/** Whether an order requested existing imagery or a new satellite capture. */
export type OrderType = "ARCHIVE" | "TASKING";

/** Lifecycle state of an order on the SkyFi platform. */
export type OrderStatus =
  | "CREATED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

// ── Shared ────────────────────────────────────────────────────────────────────

/**
 * Cloud storage destination for imagery delivery.
 *
 * The required fields differ by `DeliveryDriver`: S3 needs `accessKeyId` /
 * `secretAccessKey` / `region`, GCS needs a service account, etc. The index
 * signature captures driver-specific keys without requiring a discriminated union.
 */
export interface DeliveryParams {
  /** Target bucket name in the cloud storage provider. */
  bucket: string;
  /** Key prefix / directory path within the bucket. */
  path?: string;
  /** AWS access key ID (S3 only). */
  accessKeyId?: string;
  /** AWS secret access key (S3 only). */
  secretAccessKey?: string;
  /** AWS region (S3 only). */
  region?: string;
  [key: string]: unknown;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Identity of the authenticated API caller, returned by GET /auth/whoami. */
export interface WhoAmI {
  id: string;
  email: string;
  name: string;
  /** The API key associated with this account — useful for verifying key identity. */
  apiKey: string;
  /** Demo accounts have limited access; useful for gating purchase-side tools. */
  isDemoAccount: boolean;
}

// ── Archives (Search) ─────────────────────────────────────────────────────────

/**
 * Parameters for a spatial/temporal imagery catalog search.
 *
 * `aoi`, `fromDate`, and `toDate` are mandatory for the initial query.
 * Subsequent pages are fetched using a cursor from `ArchiveSearchResponse.next_page`
 * rather than by re-submitting this request body.
 */
export interface ArchiveSearchRequest {
  /** Area of interest expressed as a WKT POLYGON string. */
  aoi: string;
  /** Earliest acceptable capture timestamp (ISO 8601 date). */
  fromDate: string;
  /** Latest acceptable capture timestamp (ISO 8601 date). */
  toDate: string;
  /** Exclude imagery with more cloud cover than this percentage. */
  maxCloudCoveragePercent?: number;
  /** Exclude imagery taken at a steeper off-nadir angle than this (degrees). */
  maxOffNadirAngle?: number;
  /** Restrict to specific resolution tiers (e.g. ["HIGH", "VERY_HIGH"]). */
  resolutions?: string[];
  /** Restrict to specific product modalities (e.g. ["DAY", "SAR"]). */
  productTypes?: string[];
  /** Restrict to specific data providers. */
  providers?: string[];
  /** If true, only return open/free datasets. */
  openData?: boolean;
  /** Number of results to return per page (default 25 on the server side). */
  pageSize?: number;
}

/**
 * A single imagery scene from the SkyFi archive catalog.
 *
 * Represents a historical satellite capture available for purchase. The
 * `archiveId` is what gets passed to `OrderArchiveRequest` to actually buy it.
 */
export interface Archive {
  /** Unique identifier used to reference this scene in order and pricing calls. */
  archiveId: string;
  /** Satellite data provider (e.g. "Maxar", "Planet"). */
  provider: string;
  /** Satellite constellation name within the provider's fleet. */
  constellation: string;
  /** Capture modality: DAY, MULTISPECTRAL, or SAR. */
  productType: string;
  /** Nominal sensor resolution in meters. */
  platformResolution: number;
  /** Human-readable resolution tier label (e.g. "VERY_HIGH"). */
  resolution: string;
  /** UTC timestamp when the scene was captured (ISO 8601). */
  captureTimestamp: string;
  /** Percentage of the scene obscured by cloud cover (0–100). */
  cloudCoveragePercent: number;
  /** Sensor look angle from nadir at capture time (degrees). */
  offNadirAngle: number;
  /** Scene boundary expressed as a WKT geometry string. */
  footprint: string;
  /** Minimum orderable area for this scene in km². */
  minSquareKms: number;
  /** Maximum orderable area for this scene in km². */
  maxSquareKms: number;
  /** Per-km² price in USD. */
  priceForOneSquareKm: number;
  /** Area of the scene that overlaps the requested AOI, in km². */
  totalAreaSquareKm: number;
  /** Estimated delivery time after purchase (hours). */
  deliveryTimeHours: number;
  /** Preview thumbnail URLs for display purposes. */
  thumbnailUrls: string[];
  /** Ground sample distance in meters — the true pixel resolution on the ground. */
  gsd: number;
}

/**
 * Paginated response from the archive search endpoint.
 *
 * `next_page` is an opaque cursor — pass it back as the `page` query parameter
 * to retrieve the following page rather than reconstructing the original request.
 */
export interface ArchiveSearchResponse {
  /** Total number of matching scenes across all pages. */
  total: number;
  /** Scenes in the current page. */
  archives: Archive[];
  /** Opaque cursor for the next page; absent when there are no more results. */
  next_page?: string;
}

// ── Pricing ───────────────────────────────────────────────────────────────────

/**
 * Optional filter for a pricing matrix request.
 * Without `aoi`, the server returns a global pricing table.
 */
export interface PricingRequest {
  /** WKT POLYGON to get area-specific pricing (may differ from global rates). */
  aoi?: string;
}

/**
 * Pricing matrix response.
 *
 * The structure varies by provider and is intentionally left as a generic map
 * so it can be forwarded verbatim to the MCP caller for display.
 */
export type PricingResponse = Record<string, unknown>;

// ── Feasibility ───────────────────────────────────────────────────────────────

/**
 * Parameters for a tasking feasibility check.
 *
 * Feasibility determines whether any satellites will have a viable collection
 * opportunity over the AOI within the requested capture window.
 */
export interface FeasibilityRequest {
  /** Target area as WKT POLYGON. */
  aoi: string;
  /** Start of the desired capture window (ISO 8601 datetime). */
  startDate: string;
  /** End of the desired capture window (ISO 8601 datetime). */
  endDate: string;
  /** Required product type for the capture. */
  productType: ProductType;
  /** Required resolution tier for the capture. */
  resolution: Resolution;
}

/**
 * A single collection opportunity identified during feasibility analysis.
 *
 * `provider_window_id` is used as input to `OrderTaskingRequest` to target a
 * specific satellite pass rather than letting the provider choose.
 */
export interface FeasibilityOpportunity {
  /** Opaque identifier for this specific satellite pass. */
  providerWindowId: string;
  [key: string]: unknown;
}

/**
 * Current state of a feasibility check, either in-progress or resolved.
 *
 * Feasibility analysis is asynchronous — the server queues the request and
 * clients must poll until `status` reaches a terminal state (not PENDING/PROCESSING).
 */
export interface FeasibilityResponse {
  /** Unique ID for this feasibility check, used for status polling. */
  feasibility_id: string;
  /**
   * Current state of the analysis.
   * Terminal states: COMPLETED, FAILED, NO_OPPORTUNITIES.
   * Polling states: PENDING, PROCESSING.
   */
  status: string;
  /** Available capture opportunities, populated once status is COMPLETED. */
  opportunities?: FeasibilityOpportunity[];
  /** Human-readable explanation, particularly useful on failure or NO_OPPORTUNITIES. */
  message?: string;
}

/**
 * Parameters for a satellite pass prediction query.
 * Returns upcoming overpass times for the AOI, without a resolution constraint.
 */
export interface PassPredictionRequest {
  /** Target area as WKT POLYGON. */
  aoi: string;
  /** Start of the prediction window (ISO 8601 datetime). */
  fromDate: string;
  /** End of the prediction window (ISO 8601 datetime). */
  toDate: string;
}

// ── Orders ────────────────────────────────────────────────────────────────────

/**
 * Parameters to purchase an existing archived scene.
 *
 * The `archiveId` comes from a prior archive catalog search. The AOI is the
 * specific sub-region within the scene to purchase and deliver — it doesn't
 * need to match the full scene footprint.
 */
export interface OrderArchiveRequest {
  /** Sub-region of the archived scene to purchase, as WKT POLYGON. */
  aoi: string;
  /** ID of the archived scene to purchase (from `Archive.archiveId`). */
  archiveId: string;
  /** Cloud storage provider to deliver the imagery to. */
  deliveryDriver: DeliveryDriver;
  /** Destination bucket and path details for the chosen delivery driver. */
  deliveryParams: DeliveryParams;
  /** Arbitrary key-value metadata attached to the order for caller's use. */
  metadata?: Record<string, string>;
  /** URL to receive a webhook notification when the order status changes. */
  webhookUrl?: string;
}

/**
 * Parameters to commission a new satellite capture (tasking order).
 *
 * Unlike archive orders, tasking schedules a future collect. The platform
 * selects a satellite pass from those available within the requested window,
 * unless `providerWindowId` is specified to target a particular opportunity
 * returned by a prior feasibility check.
 */
export interface OrderTaskingRequest {
  /** Target area to capture, as WKT POLYGON. */
  aoi: string;
  /** Earliest acceptable collection time (ISO 8601 datetime). */
  windowStart: string;
  /** Latest acceptable collection time (ISO 8601 datetime). */
  windowEnd: string;
  /** Required product type for the new capture. */
  productType: ProductType;
  /** Required resolution tier for the new capture. */
  resolution: Resolution;
  /** If true, expedites scheduling at a potential premium cost. */
  priorityItem?: boolean;
  /** Reject captures with more cloud cover than this percentage. */
  maxCloudCoveragePercent?: number;
  /** Reject captures at a steeper off-nadir angle than this (degrees). */
  maxOffNadirAngle?: number;
  /** Cloud storage provider to deliver the imagery to. */
  deliveryDriver: DeliveryDriver;
  /** Destination bucket and path details for the chosen delivery driver. */
  deliveryParams: DeliveryParams;
  /** Arbitrary key-value metadata attached to the order. */
  metadata?: Record<string, string>;
  /** URL to receive a webhook notification when the order status changes. */
  webhookUrl?: string;
  /** Pin the collection to a specific provider (e.g. "Maxar"). */
  requiredProvider?: string;
  /** Pin the collection to a specific satellite pass from a feasibility result. */
  providerWindowId?: string;
}

/**
 * A SkyFi order, covering both archive purchases and tasking commissions.
 *
 * The `orderType` field distinguishes which variant this is. Archive orders
 * will have `archiveId` populated; tasking orders will not.
 */
export interface Order {
  /** Unique order identifier. */
  id: string;
  /** Whether this is an existing-imagery purchase or a new capture commission. */
  orderType: OrderType;
  /** Current lifecycle state of the order. */
  status: OrderStatus;
  /** The AOI purchased or commissioned, as WKT POLYGON. */
  aoi: string;
  /** The purchased archive scene ID (archive orders only). */
  archiveId?: string;
  /** Cloud storage provider used for delivery. */
  deliveryDriver: string;
  /** Delivery destination details. */
  deliveryParams: DeliveryParams;
  /** Caller-supplied metadata attached at order creation. */
  metadata?: Record<string, string>;
  /** UTC timestamp when the order was created (ISO 8601). */
  createdAt: string;
  [key: string]: unknown;
}

/** Query parameters for listing orders with optional filtering and pagination. */
export interface OrderListRequest {
  /** Filter to only return orders of this type. */
  orderType?: OrderType;
  /** Zero-based page index. */
  pageNumber?: number;
  /** Maximum results to return per page (server max: 100). */
  pageSize?: number;
  /** Column names to sort by (server-defined sort keys). */
  sort_columns?: string[];
  /** Sort direction for each column in `sort_columns` ("asc" or "desc"). */
  sort_directions?: string[];
}

/** Paginated list of orders. */
export interface OrderListResponse {
  /** Total order count across all pages. */
  total: number;
  /** Orders in the current page. */
  orders: Order[];
}

// ── Notifications (AOI Monitoring) ────────────────────────────────────────────

/**
 * Parameters to create an AOI monitor (SkyFi "notification").
 *
 * Once created, the platform will POST to `webhookUrl` whenever new imagery
 * matching the filter criteria becomes available for the specified AOI.
 */
export interface NotificationCreateRequest {
  /** The geographic area to monitor, as WKT POLYGON. */
  aoi: string;
  /** URL that receives HTTP POST callbacks when new imagery is available. */
  webhookUrl: string;
  /** Only notify for imagery with GSD >= this value (meters). */
  gsdMin?: number;
  /** Only notify for imagery with GSD <= this value (meters). */
  gsdMax?: number;
  /** Restrict notifications to a specific product type (DAY, MULTISPECTRAL, SAR). */
  productType?: string;
}

/**
 * A persisted AOI monitor record returned by the SkyFi notification endpoints.
 *
 * The `id` is what callers use to delete the monitor when monitoring is no
 * longer needed.
 */
export interface Notification {
  /** Unique notification/monitor ID (UUID). */
  id: string;
  /** ID of the account that owns this monitor. */
  ownerId: string;
  /** The monitored geographic area, as WKT POLYGON. */
  aoi: string;
  /** Webhook URL receiving new-imagery callbacks. */
  webhookUrl: string;
  /** Minimum GSD filter (meters), if set at creation. */
  gsdMin?: number;
  /** Maximum GSD filter (meters), if set at creation. */
  gsdMax?: number;
  /** Product type filter, if set at creation. */
  productType?: string;
  /** UTC timestamp when this monitor was created (ISO 8601). */
  createdAt: string;
}

/** Paginated list of AOI monitors. */
export interface NotificationListResponse {
  /** Active monitors in the current page. */
  notifications: Notification[];
  /**
   * Total monitor count.
   * NOTE: The SkyFi API may omit this field on some responses; callers should
   * fall back to `notifications.length` when it is absent.
   */
  total?: number;
}
