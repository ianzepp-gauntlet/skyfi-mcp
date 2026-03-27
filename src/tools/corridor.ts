/**
 * Corridor geometry helpers for long linear assets such as pipelines and roads.
 *
 * The main exported entry point is `chunkRouteToCorridorPolygons()`, which:
 *  1. projects geographic coordinates into a local planar space
 *  2. simplifies dense input centerlines so callers can pass raw OSRM-like routes
 *  3. splits the route into bounded-length chunks
 *  4. builds one SkyFi-safe convex polygon per chunk
 *  5. converts those chunk polygons back to WKT
 *
 * The convex polygon requirement is deliberate: live testing against SkyFi
 * showed that raw offset-path rings around bends can produce invalid or
 * unacceptable AOIs, while convex hulls of the corridor offsets are accepted.
 */
export interface RoutePoint {
  lat: number;
  lon: number;
}

interface XYPoint {
  x: number;
  y: number;
}

export interface CorridorChunk {
  chunkIndex: number;
  routePoints: RoutePoint[];
  polygonPoints: RoutePoint[];
  wktPolygon: string;
  lengthMeters: number;
}

/** Earth radius used for the local equirectangular projection. */
const EARTH_RADIUS_METERS = 6_371_000;
/** Minimum spacing used to ignore numerically-zero subsegments. */
const MIN_POINT_SPACING_METERS = 0.01;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function distanceMeters(a: XYPoint, b: XYPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Distance from a point to a line segment in projected meters.
 *
 * Used by the route simplifier to decide whether a dense intermediate point
 * materially changes the shape of the centerline.
 */
function perpendicularDistanceMeters(
  point: XYPoint,
  lineStart: XYPoint,
  lineEnd: XYPoint,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distanceMeters(point, lineStart);
  }

  const t =
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
    lengthSquared;
  const projected = {
    x: lineStart.x + Math.max(0, Math.min(1, t)) * dx,
    y: lineStart.y + Math.max(0, Math.min(1, t)) * dy,
  };
  return distanceMeters(point, projected);
}

function normalize(x: number, y: number): XYPoint {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / magnitude, y: y / magnitude };
}

/**
 * Project lat/lon into a local planar coordinate frame.
 *
 * The chunker only needs local geometric consistency over the route extent,
 * not global map projection fidelity. A local equirectangular projection is
 * sufficient and keeps the implementation lightweight.
 */
function projectPoint(
  point: RoutePoint,
  originLatDeg: number,
  originLonDeg: number,
  cosOriginLat: number,
): XYPoint {
  return {
    x: EARTH_RADIUS_METERS * toRadians(point.lon - originLonDeg) * cosOriginLat,
    y: EARTH_RADIUS_METERS * toRadians(point.lat - originLatDeg),
  };
}

/** Inverse of `projectPoint()` back into decimal-degree lat/lon coordinates. */
function unprojectPoint(
  point: XYPoint,
  originLatDeg: number,
  originLonDeg: number,
  cosOriginLat: number,
): RoutePoint {
  return {
    lat: originLatDeg + toDegrees(point.y / EARTH_RADIUS_METERS),
    lon:
      originLonDeg +
      toDegrees(point.x / (EARTH_RADIUS_METERS * Math.max(cosOriginLat, 1e-9))),
  };
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(8)).toString();
}

/**
 * Extract a distance-bounded sub-polyline from a projected route.
 *
 * This lets the caller split a long route by traveled distance rather than by
 * raw point count, while still interpolating exact start/end points at chunk
 * boundaries.
 */
function lineSubstring(
  points: XYPoint[],
  startDistanceMeters: number,
  endDistanceMeters: number,
): XYPoint[] {
  if (points.length < 2) {
    throw new Error("Route must contain at least two points");
  }

  const result: XYPoint[] = [];
  let traversed = 0;

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    const segmentLength = distanceMeters(start, end);
    if (segmentLength < MIN_POINT_SPACING_METERS) {
      continue;
    }

    const segmentStartDistance = traversed;
    const segmentEndDistance = traversed + segmentLength;

    if (segmentEndDistance <= startDistanceMeters) {
      traversed = segmentEndDistance;
      continue;
    }
    if (segmentStartDistance >= endDistanceMeters) {
      break;
    }

    const overlapStart = Math.max(startDistanceMeters, segmentStartDistance);
    const overlapEnd = Math.min(endDistanceMeters, segmentEndDistance);
    if (overlapStart >= overlapEnd) {
      traversed = segmentEndDistance;
      continue;
    }

    const startRatio = (overlapStart - segmentStartDistance) / segmentLength;
    const endRatio = (overlapEnd - segmentStartDistance) / segmentLength;
    const interpolatedStart = {
      x: start.x + (end.x - start.x) * startRatio,
      y: start.y + (end.y - start.y) * startRatio,
    };
    const interpolatedEnd = {
      x: start.x + (end.x - start.x) * endRatio,
      y: start.y + (end.y - start.y) * endRatio,
    };

    if (result.length === 0) {
      result.push(interpolatedStart);
    } else {
      const last = result[result.length - 1];
      if (last && distanceMeters(last, interpolatedStart) >= MIN_POINT_SPACING_METERS) {
        result.push(interpolatedStart);
      }
    }

    const last = result[result.length - 1];
    if (last && distanceMeters(last, interpolatedEnd) >= MIN_POINT_SPACING_METERS) {
      result.push(interpolatedEnd);
    }

    traversed = segmentEndDistance;
  }

  if (result.length < 2) {
    throw new Error("Chunking produced an invalid corridor segment");
  }

  return result;
}

/**
 * Approximate the corridor offset direction at one route vertex.
 *
 * For interior vertices this blends the normals of the incoming and outgoing
 * segments so turns expand on both sides of the centerline before the final
 * convex hull is computed.
 */
function computeVertexNormal(
  previous: XYPoint | undefined,
  current: XYPoint,
  next: XYPoint | undefined,
): XYPoint {
  if (!previous && !next) {
    return { x: 0, y: 0 };
  }

  if (!previous && next) {
    const direction = normalize(next.x - current.x, next.y - current.y);
    return { x: -direction.y, y: direction.x };
  }

  if (previous && !next) {
    const direction = normalize(current.x - previous.x, current.y - previous.y);
    return { x: -direction.y, y: direction.x };
  }

  const incoming = normalize(current.x - previous!.x, current.y - previous!.y);
  const outgoing = normalize(next!.x - current.x, next!.y - current.y);
  const normalA = { x: -incoming.y, y: incoming.x };
  const normalB = { x: -outgoing.y, y: outgoing.x };
  const combined = normalize(normalA.x + normalB.x, normalA.y + normalB.y);

  if (combined.x === 0 && combined.y === 0) {
    return normalB;
  }

  const dot = combined.x * normalB.x + combined.y * normalB.y;
  const scale = Math.abs(dot) < 0.25 ? 4 : 1 / dot;
  return { x: combined.x * scale, y: combined.y * scale };
}

function cross(origin: XYPoint, a: XYPoint, b: XYPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Remove near-identical projected points before hull construction. */
function dedupePoints(points: XYPoint[]): XYPoint[] {
  const seen = new Set<string>();
  const result: XYPoint[] = [];
  for (const point of points) {
    const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

/**
 * Simplify a dense projected centerline while preserving meaningful bends.
 *
 * Callers may provide very granular route data, for example from OSRM. The
 * chunker should absorb that density internally instead of forcing callers to
 * pre-downsample. This implementation is an iterative Douglas-Peucker pass.
 */
function simplifyProjectedRoute(
  points: XYPoint[],
  toleranceMeters: number,
): XYPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let maxDistance = 0;
    let maxIndex = -1;

    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = perpendicularDistanceMeters(
        points[index]!,
        points[startIndex]!,
        points[endIndex]!,
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }

    if (maxIndex !== -1 && maxDistance > toleranceMeters) {
      keep[maxIndex] = true;
      stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
    }
  }

  const simplified = points.filter((_, index) => keep[index]);
  return simplified.length >= 2 ? simplified : [points[0]!, points[points.length - 1]!];
}

/**
 * Compute the convex hull of the offset corridor sample points.
 *
 * This intentionally discards concavity from the raw offset path. SkyFi's AOI
 * validator expects simple convex polygons in practice, so the hull is safer
 * than preserving the exact bent corridor outline.
 */
function convexHull(points: XYPoint[]): XYPoint[] {
  const uniquePoints = dedupePoints(points).sort((a, b) =>
    a.x === b.x ? a.y - b.y : a.x - b.x,
  );

  if (uniquePoints.length < 3) {
    return uniquePoints;
  }

  const lower: XYPoint[] = [];
  for (const point of uniquePoints) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: XYPoint[] = [];
  for (let index = uniquePoints.length - 1; index >= 0; index--) {
    const point = uniquePoints[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Build one convex corridor polygon around a route chunk.
 *
 * The polygon is generated by offsetting each route vertex to both sides and
 * then taking the convex hull of those offsets. The result is a simple,
 * closed polygon that is more likely to be accepted by SkyFi than the raw
 * offset polyline ring for bend-heavy chunks.
 */
function buildCorridorPolygon(points: XYPoint[], widthMeters: number): XYPoint[] {
  const halfWidth = widthMeters / 2;
  const offsetPoints: XYPoint[] = [];

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) {
      continue;
    }
    const normal = computeVertexNormal(
      points[index - 1],
      point,
      points[index + 1],
    );
    offsetPoints.push({
      x: point.x + normal.x * halfWidth,
      y: point.y + normal.y * halfWidth,
    });
    offsetPoints.push({
      x: point.x - normal.x * halfWidth,
      y: point.y - normal.y * halfWidth,
    });
  }

  const hull = convexHull(offsetPoints);
  const firstHullPoint = hull[0];
  if (!firstHullPoint) {
    throw new Error("Corridor polygon requires at least one offset point");
  }

  return [...hull, firstHullPoint];
}

/** Sum polyline segment lengths in projected meters. */
function totalLengthMeters(points: XYPoint[]): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    total += distanceMeters(start, end);
  }
  return total;
}

/** Convert a closed polygon ring into SkyFi-compatible WKT POLYGON text. */
export function corridorPolygonToWkt(points: RoutePoint[]): string {
  const coordinates = points.map(
    (point) => `${formatCoordinate(point.lon)} ${formatCoordinate(point.lat)}`,
  );
  return `POLYGON((${coordinates.join(", ")}))`;
}

/**
 * Chunk an ordered route into SkyFi-safe corridor polygons.
 *
 * Inputs:
 * - `route`: ordered centerline points
 * - `corridorWidthMeters`: full corridor width, not half-width
 * - `maxChunkLengthMeters`: maximum centerline distance per chunk
 *
 * Output chunks contain both the route subsegment and the derived polygon so
 * downstream tools can inspect or reuse them before running feasibility.
 */
export function chunkRouteToCorridorPolygons(options: {
  route: RoutePoint[];
  corridorWidthMeters: number;
  maxChunkLengthMeters: number;
}): CorridorChunk[] {
  const { route, corridorWidthMeters, maxChunkLengthMeters } = options;

  if (route.length < 2) {
    throw new Error("Route must contain at least two GPS points");
  }
  if (!Number.isFinite(corridorWidthMeters) || corridorWidthMeters <= 0) {
    throw new Error("corridorWidthMeters must be greater than 0");
  }
  if (!Number.isFinite(maxChunkLengthMeters) || maxChunkLengthMeters <= 0) {
    throw new Error("maxChunkLengthMeters must be greater than 0");
  }

  const originLat = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const originLon = route.reduce((sum, point) => sum + point.lon, 0) / route.length;
  const cosOriginLat = Math.cos(toRadians(originLat));
  const projectedRoute = route.map((point) =>
    projectPoint(point, originLat, originLon, cosOriginLat),
  );
  // Keep dense raw routes tractable without erasing meaningful shape. The
  // tolerance is tied to corridor width and chunk length so simplification stays
  // conservative for narrow or short corridors.
  const simplificationToleranceMeters = Math.max(
    5,
    Math.min(corridorWidthMeters / 4, maxChunkLengthMeters / 20, 50),
  );
  const simplifiedRoute = simplifyProjectedRoute(
    projectedRoute,
    simplificationToleranceMeters,
  );
  const routeLengthMeters = totalLengthMeters(simplifiedRoute);

  if (routeLengthMeters < MIN_POINT_SPACING_METERS) {
    throw new Error("Route must contain at least one non-zero-length segment");
  }

  const chunks: CorridorChunk[] = [];
  let startDistanceMeters = 0;

  while (startDistanceMeters < routeLengthMeters - MIN_POINT_SPACING_METERS) {
    const endDistanceMeters = Math.min(
      startDistanceMeters + maxChunkLengthMeters,
      routeLengthMeters,
    );
    const routeChunk = lineSubstring(
      simplifiedRoute,
      startDistanceMeters,
      endDistanceMeters,
    );
    const polygon = buildCorridorPolygon(routeChunk, corridorWidthMeters);
    const polygonPoints = polygon.map((point) =>
      unprojectPoint(point, originLat, originLon, cosOriginLat),
    );
    const routePoints = routeChunk.map((point) =>
      unprojectPoint(point, originLat, originLon, cosOriginLat),
    );

    chunks.push({
      chunkIndex: chunks.length,
      routePoints,
      polygonPoints,
      wktPolygon: corridorPolygonToWkt(polygonPoints),
      lengthMeters: totalLengthMeters(routeChunk),
    });

    startDistanceMeters = endDistanceMeters;
  }

  return chunks;
}
