import { classifyPointInPolygon } from "../geometry/polygon.js";
import { intersectSegments } from "../geometry/segments.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import { roundDeterministic } from "../determinism/numeric.js";

export const signedPolygonArea = (polygon: Polygon): number => {
  let twiceArea = 0;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const current = polygon.points[index] as Vec2;
    const next = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
};

export const polygonArea = (polygon: Polygon): number =>
  Math.abs(signedPolygonArea(polygon));

export const polygonCentroid = (polygon: Polygon): Vec2 => {
  const signedArea = signedPolygonArea(polygon);
  if (Math.abs(signedArea) <= Number.EPSILON) {
    return {
      x:
        polygon.points.reduce((sum, point) => sum + point.x, 0) /
        polygon.points.length,
      y:
        polygon.points.reduce((sum, point) => sum + point.y, 0) /
        polygon.points.length,
    };
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const current = polygon.points[index] as Vec2;
    const next = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    const factor = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * factor;
    y += (current.y + next.y) * factor;
  }
  return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
};

const compareVertex = (left: Vec2, right: Vec2): number =>
  left.y - right.y || left.x - right.x;

export const canonicalizePolygon = (
  polygon: Polygon,
  decimalPlaces: number,
): Polygon => {
  if (polygon.points.length < 3) return { points: [] };
  let points = polygon.points.map((point) => ({
    x: roundDeterministic(point.x, decimalPlaces),
    y: roundDeterministic(point.y, decimalPlaces),
  }));
  if (signedPolygonArea({ points }) < 0) points = [...points].reverse();
  let first = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (compareVertex(points[index] as Vec2, points[first] as Vec2) < 0) {
      first = index;
    }
  }
  return Object.freeze({
    points: Object.freeze([...points.slice(first), ...points.slice(0, first)]),
  });
};

export const isFinitePolygon = (polygon: Polygon): boolean =>
  polygon.points.length >= 3 &&
  polygon.points.every(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

export const isSimplePolygon = (polygon: Polygon, epsilon: number): boolean => {
  if (!isFinitePolygon(polygon)) return false;
  for (let left = 0; left < polygon.points.length; left += 1) {
    const leftStart = polygon.points[left] as Vec2;
    const leftEnd = polygon.points[(left + 1) % polygon.points.length] as Vec2;
    for (let right = left + 1; right < polygon.points.length; right += 1) {
      if (
        right === left ||
        right === (left + 1) % polygon.points.length ||
        left === (right + 1) % polygon.points.length
      ) {
        continue;
      }
      const rightStart = polygon.points[right] as Vec2;
      const rightEnd = polygon.points[(right + 1) % polygon.points.length] as Vec2;
      const result = intersectSegments(leftStart, leftEnd, rightStart, rightEnd, {
        epsilon,
      });
      if (result.kind !== "NONE") return false;
    }
  }
  return polygonArea(polygon) > epsilon;
};

export const isConvexPolygon = (polygon: Polygon, epsilon: number): boolean => {
  if (!isSimplePolygon(polygon, epsilon)) return false;
  let sign = 0;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const a = polygon.points[index] as Vec2;
    const b = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    const c = polygon.points[(index + 2) % polygon.points.length] as Vec2;
    const cross =
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= epsilon) continue;
    const currentSign = Math.sign(cross);
    if (sign !== 0 && currentSign !== sign) return false;
    sign = currentSign;
  }
  return true;
};

export const clipPolygonByHalfPlane = (
  polygon: Polygon,
  normal: Vec2,
  offset: number,
  epsilon: number,
): Polygon => {
  const result: Vec2[] = [];
  const value = (point: Vec2): number =>
    normal.x * point.x + normal.y * point.y - offset;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index] as Vec2;
    const end = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    const startValue = value(start);
    const endValue = value(end);
    const startInside = startValue <= epsilon;
    const endInside = endValue <= epsilon;
    if (startInside) result.push(start);
    if (startInside !== endInside) {
      const denominator = startValue - endValue;
      if (Math.abs(denominator) > epsilon) {
        const ratio = startValue / denominator;
        result.push({
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        });
      }
    }
  }
  return { points: result };
};

export const insetConvexPolygon = (
  polygon: Polygon,
  margin: number,
  epsilon: number,
): Polygon => {
  let result = signedPolygonArea(polygon) < 0
    ? { points: [...polygon.points].reverse() }
    : polygon;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index] as Vec2;
    const end = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    result = clipPolygonByHalfPlane(
      result,
      { x: dy, y: -dx },
      dy * start.x - dx * start.y - margin * length,
      epsilon,
    );
    if (result.points.length < 3) return { points: [] };
  }
  return result;
};

export const polygonContainsPolygon = (
  container: Polygon,
  candidate: Polygon,
): boolean =>
  candidate.points.every(
    (point) => classifyPointInPolygon(point, container) !== "OUTSIDE",
  );

export const intersectConvexPolygons = (
  left: Polygon,
  right: Polygon,
  epsilon: number,
): Polygon => {
  const clip = signedPolygonArea(right) < 0
    ? { points: [...right.points].reverse() }
    : right;
  let result = left;
  for (let index = 0; index < clip.points.length; index += 1) {
    const start = clip.points[index] as Vec2;
    const end = clip.points[(index + 1) % clip.points.length] as Vec2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    result = clipPolygonByHalfPlane(
      result,
      { x: dy, y: -dx },
      dy * start.x - dx * start.y,
      epsilon,
    );
    if (result.points.length < 3) return { points: [] };
  }
  return result;
};

export const circlePolygon = (
  center: Vec2,
  radius: number,
  vertexCount: number,
): Polygon => ({
  points: Array.from({ length: vertexCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / vertexCount;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  }),
});
