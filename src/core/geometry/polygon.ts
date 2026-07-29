import { assertFiniteVec2 } from "./finite.js";
import type { NumericPolicy } from "./numeric-policy.js";
import { DEFAULT_NUMERIC_POLICY, assertNumericPolicy } from "./numeric-policy.js";
import { pointOnSegment } from "./segments.js";
import type { Polygon, Vec2 } from "./types.js";

export type PointPolygonRelation = "INSIDE" | "BOUNDARY" | "OUTSIDE";

export const classifyPointInPolygon = (
  point: Vec2,
  polygon: Polygon,
  policy: NumericPolicy = DEFAULT_NUMERIC_POLICY,
): PointPolygonRelation => {
  assertNumericPolicy(policy);
  assertFiniteVec2(point);
  if (polygon.points.length < 3) throw new RangeError("Polygon needs at least 3 points");
  for (const vertex of polygon.points) assertFiniteVec2(vertex, "polygon vertex");

  let inside = false;
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index] as Vec2;
    const end = polygon.points[(index + 1) % polygon.points.length] as Vec2;
    if (pointOnSegment(point, start, end, policy)) return "BOUNDARY";
    const crosses =
      (start.y > point.y) !== (end.y > point.y) &&
      point.x <
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside ? "INSIDE" : "OUTSIDE";
};

