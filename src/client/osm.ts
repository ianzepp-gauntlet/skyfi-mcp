/**
 * OpenStreetMap Nominatim geocoding client.
 *
 * This module provides two capabilities needed to bridge human-readable place
 * names and the WKT geometry strings that the SkyFi API expects:
 *
 *  1. `resolveLocation` — forward geocodes a place name or address into
 *     geographic coordinates and a bounding box via the Nominatim search API.
 *  2. `bboxToWkt` — converts a Nominatim bounding box into a WKT POLYGON
 *     string that can be passed directly as an `aoi` parameter.
 *
 * These two functions are intentionally kept separate so callers can use the
 * bounding box for their own purposes (e.g. display, validation) before
 * deciding to convert it to WKT.
 *
 * Architecture:
 * - Nominatim is used rather than a commercial geocoder because it is free,
 *   requires no API key, and is accurate enough for named geographic features.
 * - The User-Agent header is required by the Nominatim usage policy and must
 *   identify the application making requests.
 *
 * TRADE-OFFS:
 * - Nominatim imposes a 1 request/second rate limit for anonymous usage.
 *   No rate limiting is implemented here because MCP tool calls are low-
 *   frequency by nature. High-volume use would require a Nominatim instance
 *   or a paid geocoding provider.
 * - Results are limited to 5 and are returned sorted by Nominatim's own
 *   relevance scoring. The MCP tool presents all results to the AI, which
 *   selects the most appropriate match based on context.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * User-Agent sent with every Nominatim request.
 * Required by the Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
 */
const USER_AGENT = "skyfi-mcp-server/0.1.0";

/**
 * A normalized geocoding result from Nominatim.
 *
 * Fields are renamed from Nominatim's snake_case conventions to camelCase,
 * and numeric fields are parsed from strings to numbers, so callers don't
 * need to deal with the raw API's inconsistencies.
 */
export interface GeocodingResult {
  /** Full display name of the matched place (e.g. "Kyiv, Ukraine"). */
  displayName: string;
  /** Latitude of the place's centroid in decimal degrees (WGS 84). */
  lat: number;
  /** Longitude of the place's centroid in decimal degrees (WGS 84). */
  lon: number;
  /**
   * Axis-aligned bounding box around the matched place.
   * Order: [south, north, west, east] in decimal degrees (WGS 84).
   * This tuple order matches Nominatim's `boundingbox` field convention.
   */
  boundingBox: [number, number, number, number];
  /** OSM feature type (e.g. "city", "administrative", "park"). */
  type: string;
  /**
   * Nominatim's relevance score (0–1). Higher = more likely to be the
   * intended match. Useful for ranking multiple results when the query is
   * ambiguous.
   */
  importance: number;
}

/**
 * Geocode a place name or address using OpenStreetMap Nominatim.
 *
 * Sends a forward-geocoding query and returns up to 5 candidate results
 * sorted by Nominatim's relevance score. The caller (typically an AI via the
 * `resolve_location` MCP tool) is responsible for selecting the best match.
 *
 * @param query - Free-text place name or address (e.g. "downtown Kyiv",
 *   "Central Park New York", "Mount Everest").
 * @returns Up to 5 geocoding results, or an empty array when nothing matches.
 * @throws {Error} When the Nominatim API returns a non-200 HTTP status.
 */
export async function resolveLocation(query: string): Promise<GeocodingResult[]> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  // WHY: addressdetails=1 enriches results with structured address components,
  // which Nominatim uses internally to improve result ranking.
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Nominatim search failed (${res.status}): ${await res.text()}`);
  }

  // WHY: Nominatim returns lat/lon and boundingbox values as strings, not
  // numbers. We parse them here so callers work with numeric types throughout.
  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    boundingbox: [string, string, string, string];
    type: string;
    importance: number;
  }>;

  return data.map((item) => ({
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    boundingBox: item.boundingbox.map(Number) as [number, number, number, number],
    type: item.type,
    importance: item.importance,
  }));
}

/**
 * Convert a Nominatim bounding box to a WKT POLYGON string accepted by the SkyFi API.
 *
 * The WKT polygon is a closed rectangle whose corners are derived from the
 * four cardinal extremes of the bounding box. It follows the right-hand rule
 * (counter-clockwise exterior ring) and closes the ring by repeating the first
 * vertex.
 *
 * EDGE: The SkyFi API expects coordinates in [longitude, latitude] order inside
 * WKT (i.e. X Y = lon lat), which matches standard WKT convention. Nominatim
 * returns its bounding box as [south, north, west, east], so this function
 * re-orders the values accordingly.
 *
 * @param bbox - Bounding box as [south, north, west, east] in decimal degrees.
 * @returns WKT POLYGON string, e.g.
 *   `POLYGON((-74 40, -73 40, -73 41, -74 41, -74 40))`.
 */
export function bboxToWkt(bbox: [number, number, number, number]): string {
  const [south, north, west, east] = bbox;
  return `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
}
