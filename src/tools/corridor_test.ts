import { describe, expect, test } from "bun:test";
import {
  chunkRouteToCorridorPolygons,
  corridorPolygonToWkt,
} from "./corridor.js";

describe("corridor geometry helpers", () => {
  test("chunks a route into multiple corridor polygons", () => {
    const chunks = chunkRouteToCorridorPolygons({
      route: [
        { lat: 30, lon: -97 },
        { lat: 30, lon: -96.7 },
      ],
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.wktPolygon.startsWith("POLYGON((")).toBe(true);
      expect(chunk.lengthMeters).toBeLessThanOrEqual(10000.5);
      expect(chunk.routePoints.length).toBeGreaterThanOrEqual(2);
      expect(chunk.polygonPoints.length).toBeGreaterThanOrEqual(5);
    }
  });

  test("creates a closed WKT polygon from corridor points", () => {
    const wkt = corridorPolygonToWkt([
      { lat: 30, lon: -97 },
      { lat: 30, lon: -96.99 },
      { lat: 30.01, lon: -96.99 },
      { lat: 30.01, lon: -97 },
      { lat: 30, lon: -97 },
    ]);

    expect(wkt).toBe(
      "POLYGON((-97 30, -96.99 30, -96.99 30.01, -97 30.01, -97 30))",
    );
  });
});
