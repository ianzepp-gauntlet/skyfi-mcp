import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { CorridorChunk, RoutePoint } from "./corridor.js";
import {
  chunkRouteToCorridorPolygons,
  corridorPolygonToWkt,
} from "./corridor.js";

const EARTH_RADIUS_METERS = 6_371_000;
const i70DenverToVailFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/i70_denver_vail.json", import.meta.url),
    "utf8",
  ),
) as {
  distance_meters: number;
  point_count_sampled: number;
  route: RoutePoint[];
};
const i81ScrantonToKnoxvilleFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/i81_scranton_knoxville.json", import.meta.url),
    "utf8",
  ),
) as {
  distance_meters: number;
  point_count_sampled: number;
  route: RoutePoint[];
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const averageLat = toRadians((a.lat + b.lat) / 2);
  const dx = EARTH_RADIUS_METERS * toRadians(b.lon - a.lon) * Math.cos(averageLat);
  const dy = EARTH_RADIUS_METERS * toRadians(b.lat - a.lat);
  return Math.hypot(dx, dy);
}

function routeLengthMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index++) {
    total += distanceMeters(points[index]!, points[index + 1]!);
  }
  return total;
}

function makeEastboundRoute(lengthMeters: number): RoutePoint[] {
  const lonDelta =
    (lengthMeters / (EARTH_RADIUS_METERS * Math.cos(toRadians(30)))) *
    (180 / Math.PI);
  return [
    { lat: 30, lon: -97 },
    { lat: 30, lon: -97 + lonDelta },
  ];
}

function expectClosedPolygon(chunk: CorridorChunk) {
  const first = chunk.polygonPoints[0];
  const last = chunk.polygonPoints[chunk.polygonPoints.length - 1];
  expect(first).toBeDefined();
  expect(last).toBeDefined();
  expect(first).toEqual(last);
}

function expectChunkWktMatchesPolygonPoints(chunk: CorridorChunk) {
  expect(chunk.wktPolygon).toBe(corridorPolygonToWkt(chunk.polygonPoints));
}

function expectNonDegeneratePolygon(chunk: CorridorChunk) {
  expect(chunk.polygonPoints.length).toBeGreaterThanOrEqual(4);
  expect(new Set(chunk.polygonPoints.map((point) => `${point.lat}:${point.lon}`)).size).toBeGreaterThanOrEqual(4);
}

function runLongRouteAssertions(
  fixture: { point_count_sampled: number; route: RoutePoint[] },
  expectedChunkRange: { min: number; max: number },
) {
  const chunks = chunkRouteToCorridorPolygons({
    route: fixture.route,
    corridorWidthMeters: 1000,
    maxChunkLengthMeters: 10000,
  });

  expect(fixture.point_count_sampled).toBeGreaterThan(100);
  expect(chunks.length).toBeGreaterThan(expectedChunkRange.min);
  expect(chunks.length).toBeLessThan(expectedChunkRange.max);
  expect(chunks.every((chunk) => chunk.lengthMeters <= 10000.5)).toBe(true);
  expect(chunks.every((chunk) => chunk.routePoints.length >= 2)).toBe(true);
  expect(chunks.every((chunk) => chunk.polygonPoints.length >= 4)).toBe(true);

  const chunkLengthSum = chunks.reduce((sum, chunk) => sum + chunk.lengthMeters, 0);
  const sampledLength = routeLengthMeters(fixture.route);
  expect(Math.abs(chunkLengthSum - sampledLength) / sampledLength).toBeLessThan(
    0.003,
  );

  for (let index = 0; index < chunks.length - 1; index++) {
    const currentEnd =
      chunks[index]!.routePoints[chunks[index]!.routePoints.length - 1]!;
    const nextStart = chunks[index + 1]!.routePoints[0]!;
    expect(distanceMeters(currentEnd, nextStart)).toBeLessThan(1);
  }

  expect(chunks.some((chunk) => chunk.routePoints.length > 4)).toBe(true);
  expect(chunks.every((chunk) => chunk.polygonPoints.length <= 25)).toBe(true);
  expect(chunks.every((chunk) => chunk.wktPolygon.startsWith("POLYGON(("))).toBe(true);
}

describe("corridor geometry helpers", () => {
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

  test("rejects routes with fewer than two points", () => {
    expect(() =>
      chunkRouteToCorridorPolygons({
        route: [{ lat: 30, lon: -97 }],
        corridorWidthMeters: 1000,
        maxChunkLengthMeters: 10000,
      }),
    ).toThrow("Route must contain at least two GPS points");
  });

  test("rejects non-positive corridor width", () => {
    expect(() =>
      chunkRouteToCorridorPolygons({
        route: makeEastboundRoute(1000),
        corridorWidthMeters: 0,
        maxChunkLengthMeters: 10000,
      }),
    ).toThrow("corridorWidthMeters must be greater than 0");
  });

  test("rejects non-positive max chunk length", () => {
    expect(() =>
      chunkRouteToCorridorPolygons({
        route: makeEastboundRoute(1000),
        corridorWidthMeters: 1000,
        maxChunkLengthMeters: -1,
      }),
    ).toThrow("maxChunkLengthMeters must be greater than 0");
  });

  test("rejects a route with no non-zero-length segments", () => {
    expect(() =>
      chunkRouteToCorridorPolygons({
        route: [
          { lat: 30, lon: -97 },
          { lat: 30, lon: -97 },
          { lat: 30, lon: -97 },
        ],
        corridorWidthMeters: 1000,
        maxChunkLengthMeters: 10000,
      }),
    ).toThrow("Route must contain at least one non-zero-length segment");
  });

  test("returns a single chunk when the route is shorter than the chunk limit", () => {
    const chunks = chunkRouteToCorridorPolygons({
      route: makeEastboundRoute(3500),
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.lengthMeters).toBeGreaterThan(3000);
    expect(chunks[0]!.lengthMeters).toBeLessThan(4000);
    expect(chunks[0]!.routePoints).toHaveLength(2);
    expect(chunks[0]!.polygonPoints).toHaveLength(5);
    expectClosedPolygon(chunks[0]!);
    expectChunkWktMatchesPolygonPoints(chunks[0]!);
  });

  test("chunks a long straight route into multiple corridor polygons", () => {
    const chunks = chunkRouteToCorridorPolygons({
      route: makeEastboundRoute(33000),
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });

    expect(chunks.length).toBe(4);
    for (const chunk of chunks) {
      expect(chunk.wktPolygon.startsWith("POLYGON((")).toBe(true);
      expect(chunk.lengthMeters).toBeLessThanOrEqual(10000.5);
      expect(chunk.routePoints.length).toBeGreaterThanOrEqual(2);
      expect(chunk.polygonPoints.length).toBeGreaterThanOrEqual(5);
      expectClosedPolygon(chunk);
      expectChunkWktMatchesPolygonPoints(chunk);
    }
    expect(chunks[3]!.lengthMeters).toBeLessThan(4000);
  });

  test("preserves total route coverage across chunks within a small tolerance", () => {
    const route = makeEastboundRoute(47500);
    const chunks = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 12000,
    });

    const chunkLengthSum = chunks.reduce((sum, chunk) => sum + chunk.lengthMeters, 0);
    expect(chunkLengthSum).toBeCloseTo(routeLengthMeters(route), 0);
  });

  test("keeps adjacent chunk boundaries continuous along a straight route", () => {
    const chunks = chunkRouteToCorridorPolygons({
      route: makeEastboundRoute(28000),
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });

    expect(chunks.length).toBeGreaterThan(2);
    for (let index = 0; index < chunks.length - 1; index++) {
      const currentEnd =
        chunks[index]!.routePoints[chunks[index]!.routePoints.length - 1]!;
      const nextStart = chunks[index + 1]!.routePoints[0]!;
      expect(distanceMeters(currentEnd, nextStart)).toBeLessThan(0.5);
    }
  });

  test("handles duplicate intermediate points without producing empty chunks", () => {
    const route = [
      { lat: 30, lon: -97 },
      { lat: 30, lon: -96.95 },
      { lat: 30, lon: -96.95 },
      { lat: 30, lon: -96.9 },
    ];

    const chunks = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 5000,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.routePoints.length).toBeGreaterThanOrEqual(2);
      expect(chunk.lengthMeters).toBeGreaterThan(0);
      expectClosedPolygon(chunk);
    }
  });

  test("builds wider polygons when corridor width increases", () => {
    const route = makeEastboundRoute(3000);
    const narrow = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 500,
      maxChunkLengthMeters: 10000,
    })[0]!;
    const wide = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 1500,
      maxChunkLengthMeters: 10000,
    })[0]!;

    const narrowLatSpan =
      Math.max(...narrow.polygonPoints.map((point) => point.lat)) -
      Math.min(...narrow.polygonPoints.map((point) => point.lat));
    const wideLatSpan =
      Math.max(...wide.polygonPoints.map((point) => point.lat)) -
      Math.min(...wide.polygonPoints.map((point) => point.lat));

    expect(wideLatSpan).toBeGreaterThan(narrowLatSpan);
  });

  test("produces sensible polygons for a route with a right-angle turn", () => {
    const route = [
      { lat: 30, lon: -97 },
      { lat: 30, lon: -96.96 },
      { lat: 30.03, lon: -96.96 },
    ];

    const chunks = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 20000,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.routePoints.length).toBe(3);
    expectClosedPolygon(chunks[0]!);
    expectChunkWktMatchesPolygonPoints(chunks[0]!);
    expectNonDegeneratePolygon(chunks[0]!);
  });

  test("splits a multi-segment route across chunk boundaries without losing bends", () => {
    const route = [
      { lat: 30, lon: -97 },
      { lat: 30, lon: -96.9 },
      { lat: 30.04, lon: -96.9 },
      { lat: 30.04, lon: -96.8 },
    ];

    const chunks = chunkRouteToCorridorPolygons({
      route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 12000,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((chunk) => chunk.routePoints.length > 2)).toBe(true);
    expect(chunks.every((chunk) => chunk.polygonPoints.length >= 4)).toBe(true);
    expect(chunks.every((chunk) => chunk.polygonPoints.length <= chunk.routePoints.length * 2 + 1)).toBe(true);
    expect(chunks.every((chunk) => corridorPolygonToWkt(chunk.polygonPoints) === chunk.wktPolygon)).toBe(true);
  });

  test("assigns monotonically increasing chunk indexes", () => {
    const chunks = chunkRouteToCorridorPolygons({
      route: makeEastboundRoute(26000),
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 8000,
    });

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3]);
  });

  test("chunks the I-70 Denver-to-Vail fixture into many corridor segments", () => {
    runLongRouteAssertions(i70DenverToVailFixture, { min: 10, max: 20 });
  });

  test("chunks the I-81 Scranton-to-Knoxville fixture into many corridor segments", () => {
    runLongRouteAssertions(i81ScrantonToKnoxvilleFixture, { min: 80, max: 130 });
  });

  test("the I-81 fixture spans substantially more chunks than the I-70 fixture", () => {
    const i70Chunks = chunkRouteToCorridorPolygons({
      route: i70DenverToVailFixture.route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });
    const i81Chunks = chunkRouteToCorridorPolygons({
      route: i81ScrantonToKnoxvilleFixture.route,
      corridorWidthMeters: 1000,
      maxChunkLengthMeters: 10000,
    });

    expect(i81Chunks.length).toBeGreaterThan(i70Chunks.length * 5);
    expect(routeLengthMeters(i81ScrantonToKnoxvilleFixture.route)).toBeGreaterThan(
      routeLengthMeters(i70DenverToVailFixture.route) * 5,
    );
  });
});
