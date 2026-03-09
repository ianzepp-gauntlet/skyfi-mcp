// SkyFi API types — derived from https://app.skyfi.com/platform-api/redoc

// ── Enums ──

export type ProductType = "DAY" | "MULTISPECTRAL" | "SAR";
export type Resolution = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "ULTRA_HIGH";
export type DeliveryDriver = "S3" | "GS" | "AZURE";
export type OrderType = "ARCHIVE" | "TASKING";
export type OrderStatus = "CREATED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

// ── Shared ──

export interface DeliveryParams {
  bucket: string;
  path?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  [key: string]: unknown;
}

// ── Auth ──

export interface WhoAmI {
  id: string;
  email: string;
  name: string;
  apiKey: string;
  isDemoAccount: boolean;
}

// ── Archives (Search) ──

export interface ArchiveSearchRequest {
  aoi: string; // WKT polygon
  fromDate: string; // ISO 8601
  toDate: string; // ISO 8601
  maxCloudCoveragePercent?: number;
  maxOffNadirAngle?: number;
  resolutions?: string[];
  productTypes?: string[];
  providers?: string[];
  openData?: boolean;
  pageSize?: number;
}

export interface Archive {
  archiveId: string;
  provider: string;
  constellation: string;
  productType: string;
  platformResolution: number;
  resolution: string;
  captureTimestamp: string;
  cloudCoveragePercent: number;
  offNadirAngle: number;
  footprint: string;
  minSquareKms: number;
  maxSquareKms: number;
  priceForOneSquareKm: number;
  totalAreaSquareKm: number;
  deliveryTimeHours: number;
  thumbnailUrls: string[];
  gsd: number;
}

export interface ArchiveSearchResponse {
  total: number;
  archives: Archive[];
  next_page?: string;
}

// ── Pricing ──

export interface PricingRequest {
  aoi?: string; // WKT polygon
}

export type PricingResponse = Record<string, unknown>;

// ── Feasibility ──

export interface FeasibilityRequest {
  aoi: string;
  window_start: string;
  window_end: string;
  product_type: ProductType;
  resolution: Resolution;
}

export interface FeasibilityOpportunity {
  provider_window_id: string;
  [key: string]: unknown;
}

export interface FeasibilityResponse {
  feasibility_id: string;
  status: string;
  opportunities?: FeasibilityOpportunity[];
  message?: string;
}

export interface PassPredictionRequest {
  aoi: string;
  window_start: string;
  window_end: string;
}

// ── Orders ──

export interface OrderArchiveRequest {
  aoi: string;
  archiveId: string;
  deliveryDriver: DeliveryDriver;
  deliveryParams: DeliveryParams;
  metadata?: Record<string, string>;
  webhook_url?: string;
}

export interface OrderTaskingRequest {
  aoi: string;
  window_start: string;
  window_end: string;
  product_type: ProductType;
  resolution: Resolution;
  priorityItem?: boolean;
  maxCloudCoveragePercent?: number;
  maxOffNadirAngle?: number;
  deliveryDriver: DeliveryDriver;
  deliveryParams: DeliveryParams;
  metadata?: Record<string, string>;
  webhook_url?: string;
  requiredProvider?: string;
  provider_window_id?: string;
}

export interface Order {
  id: string;
  orderType: OrderType;
  status: OrderStatus;
  aoi: string;
  archiveId?: string;
  deliveryDriver: string;
  deliveryParams: DeliveryParams;
  metadata?: Record<string, string>;
  createdAt: string;
  [key: string]: unknown;
}

export interface OrderListRequest {
  orderType?: OrderType;
  pageNumber?: number;
  pageSize?: number;
  sort_columns?: string[];
  sort_directions?: string[];
}

export interface OrderListResponse {
  total: number;
  orders: Order[];
}

// ── Notifications (AOI Monitoring) ──

export interface NotificationCreateRequest {
  aoi: string;
  webhookUrl: string;
  gsdMin?: number;
  gsdMax?: number;
  productType?: string;
}

export interface Notification {
  id: string;
  ownerId: string;
  aoi: string;
  webhookUrl: string;
  gsdMin?: number;
  gsdMax?: number;
  productType?: string;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: Notification[];
  total?: number;
}
