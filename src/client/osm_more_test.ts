import { afterEach, describe, expect, test } from "bun:test";
import { resolveLocation } from "./osm.js";

const originalFetch = globalThis.fetch;

describe("resolveLocation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("parses geocoder response into normalized numbers", async () => {
    globalThis.fetch = ((async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("nominatim.openstreetmap.org/search");
      expect(String(url)).toContain("q=Austin");
      expect(String(url)).toContain("limit=5");
      expect(init?.headers).toEqual({ "User-Agent": "skyfi-mcp-server/0.1.0" });
      return new Response(
        JSON.stringify([
          {
            display_name: "Austin",
            lat: "30.2",
            lon: "-97.7",
            boundingbox: ["30.1", "30.4", "-98", "-97.5"],
            type: "city",
            importance: 0.9,
          },
        ]),
        { status: 200 }
      );
    }) as unknown) as typeof fetch;

    const result = await resolveLocation("Austin");
    expect(result[0].lat).toBe(30.2);
    expect(result[0].lon).toBe(-97.7);
    expect(result[0].boundingBox).toEqual([30.1, 30.4, -98, -97.5]);
  });

  test("throws enriched error on non-ok responses", async () => {
    globalThis.fetch = ((async () => new Response("ratelimited", { status: 429 })) as unknown) as typeof fetch;

    await expect(resolveLocation("Austin")).rejects.toThrow(
      "Nominatim search failed (429): ratelimited"
    );
  });
});
