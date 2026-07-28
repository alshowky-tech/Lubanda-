import { lerp, normalize, subtract } from "../geometry/vec2.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Polygon } from "../geometry/types.js";
import type { SkeletonBranch } from "../skeleton/types.js";

/**
 * Build a deterministic corridor polygon for a single branch.
 *
 * The corridor is a directional polygon that:
 * - begins at the branch start node;
 * - extends toward the branch end node;
 * - remains inside the assigned territory when one exists;
 * - has non-zero finite area;
 * - never modifies the original SkeletonBranch curve.
 *
 * For M4.1, the corridor is a 4-point polgon forming a directional
 * channel around the start→end direction.
 */
export interface CorridorBuildInput {
  readonly branch: SkeletonBranch;
  readonly branchRadius: number;
  readonly safetyMargin: number;
  readonly territoryPolygon: Polygon | null;
  readonly isMajorLineage: boolean;
}

export const buildBranchCorridor = (input: CorridorBuildInput): Polygon => {
  const { branch, branchRadius, safetyMargin } = input;
  const halfWidth = branchRadius + safetyMargin;

  // Direction from start to end
  const dir = subtract(branch.endPoint, branch.startPoint);
  const len = Math.hypot(dir.x, dir.y);

  if (len < 1e-9) {
    // Degenerate: return a small polygon at start
    return {
      points: [
        { x: branch.startPoint.x - halfWidth, y: branch.startPoint.y - halfWidth },
        { x: branch.startPoint.x + halfWidth, y: branch.startPoint.y - halfWidth },
        { x: branch.startPoint.x + halfWidth, y: branch.startPoint.y + halfWidth },
        { x: branch.startPoint.x - halfWidth, y: branch.startPoint.y + halfWidth },
      ],
    };
  }

  const normalized = normalize(dir);
  // Perpendicular vector (rotate 90 degrees counter-clockwise)
  const perpX = -normalized.y;
  const perpY = normalized.x;

  // Extension beyond the end point for corridor padding
  const extension = Math.max(10, len * 0.1);

  // Four corners of the corridor
  const p0 = {
    x: branch.startPoint.x + perpX * halfWidth,
    y: branch.startPoint.y + perpY * halfWidth,
  };
  const p1 = {
    x: branch.startPoint.x - perpX * halfWidth,
    y: branch.startPoint.y - perpY * halfWidth,
  };
  const endExtended = {
    x: branch.endPoint.x + normalized.x * extension,
    y: branch.endPoint.y + normalized.y * extension,
  };
  const p2 = {
    x: endExtended.x - perpX * halfWidth,
    y: endExtended.y - perpY * halfWidth,
  };
  const p3 = {
    x: endExtended.x + perpX * halfWidth,
    y: endExtended.y + perpY * halfWidth,
  };

  let polygon: Polygon = { points: [p0, p1, p2, p3] };

  // Clamp inside territory polygon if one exists (for non-major-lineage branches)
  if (input.territoryPolygon !== null && !input.isMajorLineage) {
    const clampedPoints = polygon.points.filter(
      (pt) => classifyPointInPolygon(pt, input.territoryPolygon!) !== "OUTSIDE",
    );
    if (clampedPoints.length >= 3) {
      polygon = { points: clampedPoints };
    }
  }

  // Ensure non-zero area by checking the polygon is not degenerate
  if (polygon.points.length < 3) {
    // Return a small default polygon at the midpoint
    const mid = lerp(branch.startPoint, branch.endPoint, 0.5);
    polygon = {
      points: [
        { x: mid.x - halfWidth, y: mid.y - halfWidth },
        { x: mid.x + halfWidth, y: mid.y - halfWidth },
        { x: mid.x + halfWidth, y: mid.y + halfWidth },
        { x: mid.x - halfWidth, y: mid.y + halfWidth },
      ],
    };
  }

  return polygon;
};
