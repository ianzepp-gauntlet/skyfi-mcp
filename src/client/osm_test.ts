/**
 * Unit tests for OSM utility functions.
 *
 * `bboxToWkt` is a pure coordinate transformation with no external dependencies,
 * so these tests are purely deterministic. They document the expected WKT output
 * format — particularly the coordinate ordering (lon lat, i.e. X Y) and the
 * closed-ring requirement (first vertex repeated at the end) that the SkyFi API
 * requires.
 */

import { test, expect, describe } from "bun:test";
import { bboxToWkt } from "./osm.js";

describe("bboxToWkt", () => {
  test("converts bounding box to WKT polygon", () => {
    // [south, north, west, east]
    const wkt = bboxToWkt([40.0, 41.0, -74.0, -73.0]);
    expect(wkt).toBe("POLYGON((-74 40, -73 40, -73 41, -74 41, -74 40))");
  });

  test("handles zero-crossing coordinates", () => {
    const wkt = bboxToWkt([-1, 1, -1, 1]);
    expect(wkt).toBe("POLYGON((-1 -1, 1 -1, 1 1, -1 1, -1 -1))");
  });
});
