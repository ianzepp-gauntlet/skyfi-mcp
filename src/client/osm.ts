const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "skyfi-mcp-server/0.1.0";

export interface GeocodingResult {
  displayName: string;
  lat: number;
  lon: number;
  boundingBox: [number, number, number, number]; // [south, north, west, east]
  type: string;
  importance: number;
}

export async function resolveLocation(query: string): Promise<GeocodingResult[]> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Nominatim search failed (${res.status}): ${await res.text()}`);
  }

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
 * Convert a bounding box [south, north, west, east] to a WKT POLYGON string
 * suitable for the SkyFi API.
 */
export function bboxToWkt(bbox: [number, number, number, number]): string {
  const [south, north, west, east] = bbox;
  return `POLYGON((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south}))`;
}
