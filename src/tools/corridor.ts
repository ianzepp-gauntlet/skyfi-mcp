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

const EARTH_RADIUS_METERS = 6_371_000;
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

function normalize(x: number, y: number): XYPoint {
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / magnitude, y: y / magnitude };
}

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

export function corridorPolygonToWkt(points: RoutePoint[]): string {
  const coordinates = points.map(
    (point) => `${formatCoordinate(point.lon)} ${formatCoordinate(point.lat)}`,
  );
  return `POLYGON((${coordinates.join(", ")}))`;
}

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
  const routeLengthMeters = totalLengthMeters(projectedRoute);

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
      projectedRoute,
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
