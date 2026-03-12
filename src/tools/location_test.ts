import { afterEach, describe, expect, test } from "bun:test";
import { registerLocationTools } from "./location.js";
import { createToolHarness } from "./test_harness.js";

const originalFetch = globalThis.fetch;

function parseToolJson(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("registerLocationTools", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns no-results message when geocoder returns empty array", async () => {
    const harness = createToolHarness();
    registerLocationTools(harness.server as any);

    globalThis.fetch = (async () =>
      new Response("[]", { status: 200 })) as unknown as typeof fetch;

    const result: any = await harness.invoke("location_resolve", {
      query: "unknown place",
    });
    expect(result.content[0].text).toContain("No results found");
  });

  test("maps location results and includes WKT polygon", async () => {
    const harness = createToolHarness();
    registerLocationTools(harness.server as any);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          {
            display_name: "Austin, Texas, United States",
            lat: "30.2672",
            lon: "-97.7431",
            boundingbox: ["30.1", "30.4", "-98.0", "-97.5"],
            type: "city",
            importance: 0.9,
          },
        ]),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = parseToolJson(
      await harness.invoke("location_resolve", { query: "Austin" }),
    );
    expect(result.query).toBe("Austin");
    expect(result.results[0].name).toContain("Austin");
    expect(result.results[0].wktPolygon).toBe(
      "POLYGON((-98 30.1, -97.5 30.1, -97.5 30.4, -98 30.4, -98 30.1))",
    );
  });
});
