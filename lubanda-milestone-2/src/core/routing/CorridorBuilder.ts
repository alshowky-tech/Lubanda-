import { normalize, subtract } from "../geometry/vec2.js";
import { clipPolygonByHalfPlane } from "../territory/polygon-geometry.js";
import { signedPolygonArea, isConvexPolygon } from "../territory/polygon-geometry.js";
import type { Polygon } from "../geometry/types.js";
import type { SkeletonBranch } from "../skeleton/types.js";

export interface CorridorBuildInput {
  readonly branch: SkeletonBranch;
  readonly branchRadius: number;
  readonly safetyMargin: number;
  readonly territoryPolygon: Polygon | null;
  readonly isMajorLineage: boolean;
}

/**
 * Return a polygon with CCW winding. If the polygon is CW, reverse it.
 */
const ensureCCW = (polygon: Polygon): Polygon => {
  if (signedPolygonArea(polygon) < 0) {
    return { points: [...polygon.points].reverse() };
  }
  return polygon;
};

/**
 * Build a deterministic corridor polygon for a single branch.
 *
 * The corridor is a directional polygon that:
 * - begins at the branch start node;
 * - extends toward the branch end node;
 * - is clipped to the assigned territory using proper half-plane clipping;
 * - has non-zero finite area;
 * - never modifies the original SkeletonBranch curve.
 *
 * When the corridor cannot be contained within the territory, or the
 * territory is not convex, the polygon is returned with < 3 points,
 * signalling a routing failure.
 */
export const buildBranchCorridor = (input: CorridorBuildInput): Polygon => {
  const { branch, branchRadius, safetyMargin } = input;
  const halfWidth = branchRadius + safetyMargin;
  const epsilon = 1e-7;

  const dir = subtract(branch.endPoint, branch.startPoint);
  const len = Math.hypot(dir.x, dir.y);

  if (len < 1e-9) {
    return { points: [] }; // degenerate — signal failure
  }

  const normalized = normalize(dir);
  const perpX = -normalized.y;
  const perpY = normalized.x;

  const extension = Math.max(10, len * 0.1);
  const endExtended = {
    x: branch.endPoint.x + normalized.x * extension,
    y: branch.endPoint.y + normalized.y * extension,
  };

  // Four corners of the raw directional corridor
  let polygon: Polygon = {
    points: [
      {
        x: branch.startPoint.x + perpX * halfWidth,
        y: branch.startPoint.y + perpY * halfWidth,
      },
      {
        x: branch.startPoint.x - perpX * halfWidth,
        y: branch.startPoint.y - perpY * halfWidth,
      },
      {
        x: endExtended.x - perpX * halfWidth,
        y: endExtended.y - perpY * halfWidth,
      },
      {
        x: endExtended.x + perpX * halfWidth,
        y: endExtended.y + perpY * halfWidth,
      },
    ],
  };

  // Clip inside territory polygon using proper half-plane clipping
  if (input.territoryPolygon !== null && !input.isMajorLineage) {
    // Normalize territory winding to CCW for consistent half-plane normals
    const territory = ensureCCW(input.territoryPolygon);

    // Convexity check: reject unsupported concave territories explicitly
    if (!isConvexPolygon(territory, epsilon)) {
      return { points: [] }; // concave not supported
    }

    for (let i = 0; i < territory.points.length; i += 1) {
      const start = territory.points[i]!;
      const end = territory.points[(i + 1) % territory.points.length]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      polygon = clipPolygonByHalfPlane(
        polygon,
        { x: dy, y: -dx },
        dy * start.x - dx * start.y,
        epsilon,
      );
      if (polygon.points.length < 3) return { points: [] }; // clipped away entirely
    }
  }

  // Final area check: if degenerate after clipping, signal failure
  if (polygon.points.length < 3) return { points: [] };

  return polygon;
};
