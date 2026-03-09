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

export class SkyFiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: SkyFiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        "X-Skyfi-Api-Key": this.apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SkyFi API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Auth ──

  async whoami(): Promise<WhoAmI> {
    return this.request("GET", "/auth/whoami");
  }

  // ── Archives (Search) ──

  async searchArchives(params: ArchiveSearchRequest): Promise<ArchiveSearchResponse> {
    return this.request("POST", "/archives", params);
  }

  async getArchivesPage(page: string): Promise<ArchiveSearchResponse> {
    return this.request("GET", "/archives", undefined, { page });
  }

  async getArchive(archiveId: string): Promise<Archive> {
    return this.request("GET", `/archives/${archiveId}`);
  }

  // ── Pricing ──

  async getPricing(params?: PricingRequest): Promise<PricingResponse> {
    return this.request("POST", "/pricing", params ?? {});
  }

  // ── Feasibility ──

  async checkFeasibility(params: FeasibilityRequest): Promise<FeasibilityResponse> {
    return this.request("POST", "/feasibility", params);
  }

  async getFeasibilityStatus(feasibilityId: string): Promise<FeasibilityResponse> {
    return this.request("GET", `/feasibility/${feasibilityId}`);
  }

  async getPassPrediction(params: PassPredictionRequest): Promise<unknown> {
    return this.request("POST", "/feasibility/pass-prediction", params);
  }

  /**
   * Poll feasibility until terminal status or timeout.
   */
  async pollFeasibility(
    feasibilityId: string,
    opts?: { intervalMs?: number; timeoutMs?: number }
  ): Promise<FeasibilityResponse> {
    const interval = opts?.intervalMs ?? 3000;
    const timeout = opts?.timeoutMs ?? 60000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await this.getFeasibilityStatus(feasibilityId);
      if (result.status !== "PENDING" && result.status !== "PROCESSING") {
        return result;
      }
      await new Promise((r) => setTimeout(r, interval));
    }

    return this.getFeasibilityStatus(feasibilityId);
  }

  // ── Orders ──

  async listOrders(params?: OrderListRequest): Promise<OrderListResponse> {
    return this.request("GET", "/orders", undefined, {
      orderType: params?.orderType,
      pageNumber: params?.pageNumber,
      pageSize: params?.pageSize,
    });
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.request("GET", `/orders/${orderId}`);
  }

  async createArchiveOrder(params: OrderArchiveRequest): Promise<Order> {
    return this.request("POST", "/order-archive", params);
  }

  async createTaskingOrder(params: OrderTaskingRequest): Promise<Order> {
    return this.request("POST", "/order-tasking", params);
  }

  // ── Notifications (AOI Monitoring) ──

  async createNotification(params: NotificationCreateRequest): Promise<Notification> {
    return this.request("POST", "/notifications", params);
  }

  async listNotifications(
    pageNumber?: number,
    pageSize?: number
  ): Promise<NotificationListResponse> {
    return this.request("GET", "/notifications", undefined, { pageNumber, pageSize });
  }

  async getNotification(notificationId: string): Promise<Notification> {
    return this.request("GET", `/notifications/${notificationId}`);
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await this.request("DELETE", `/notifications/${notificationId}`);
  }
}
