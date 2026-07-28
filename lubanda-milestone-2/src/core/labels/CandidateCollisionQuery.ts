import { boundsOverlap } from "../geometry/bounds.js";
import { distance } from "../geometry/vec2.js";
import { pointSegmentDistance, intersectSegments } from "../geometry/segments.js";
import type { Vec2, Bounds, Polygon } from "../geometry/types.js";
import type { CollisionIndex } from "../collision/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { CandidateCollisionQuery, LabelPlacement } from "./types.js";

const EPSILON = 1e-7;

/**
 * Read-only CandidateCollisionQuery wrapping a CollisionIndex.
 */
export class DefaultCandidateCollisionQuery implements CandidateCollisionQuery {
  readonly #index: CollisionIndex;
  readonly #templatePolygon: Polygon;

  constructor(index: CollisionIndex, templatePolygon: Polygon) {
    this.#index = index;
    this.#templatePolygon = templatePolygon;
  }

  overlapsFixedBranch(
    candidateBranchId: SkeletonBranchId,
    bounds: Bounds,
    anchor: Vec2,
    anchorRadius: number,
  ): boolean {
    const candidates = this.#index.query(bounds);
    for (const entry of candidates) {
      if (!boundsOverlap(entry.envelopeBounds, bounds)) continue;

      if (entry.branchId === candidateBranchId) {
        // Self-anchor exemption: sample the INTERSECTION of candidate AABB
        // and branch envelope AABB. Only if ALL sampled points of the
        // intersecting region are inside the anchor circle, exempt.
        const overlapMinX = Math.max(bounds.minX, entry.envelopeBounds.minX);
        const overlapMinY = Math.max(bounds.minY, entry.envelopeBounds.minY);
        const overlapMaxX = Math.min(bounds.maxX, entry.envelopeBounds.maxX);
        const overlapMaxY = Math.min(bounds.maxY, entry.envelopeBounds.maxY);

        // Uniform grid sampling of the overlap rectangle (3×3 = 9 points)
        // This is deterministic and adequately dense for AABB-overlap testing.
        const xSamples = 3;
        const ySamples = 3;
        let allInside = true;
        for (let xi = 0; xi < xSamples; xi += 1) {
          const px = overlapMinX + (overlapMaxX - overlapMinX) * (xi / (xSamples - 1));
          for (let yi = 0; yi < ySamples; yi += 1) {
            const py = overlapMinY + (overlapMaxY - overlapMinY) * (yi / (ySamples - 1));
            if (distance({ x: px, y: py }, anchor) > anchorRadius + EPSILON) {
              allInside = false;
            }
          }
        }
        if (allInside) continue; // exempted — the entire overlap is within the attachment zone
        // Otherwise the overlap extends outside the anchor circle → real collision
      }

      return true;
    }
    return false;
  }

  overlapsFixedLabel(
    bounds: Bounds,
    fixedPlacements: readonly LabelPlacement[],
  ): boolean {
    for (const fp of fixedPlacements) {
      if (boundsOverlap(bounds, fp.bounds)) return true;
    }
    return false;
  }

  isBoundsInsideBoundary(bounds: Bounds): boolean {
    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    return corners.every((c) => this.isPointInsideBoundary(c));
  }

  isPointInsideBoundary(point: Vec2): boolean {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return false;
    let inside = false;
    let j = pts.length - 1;
    for (let i = 0; i < pts.length; j = i, i += 1) {
      const xi = pts[i]!.x, yi = pts[i]!.y;
      const xj = pts[j]!.x, yj = pts[j]!.y;
      if (
        (yi > point.y) !== (yj > point.y) &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  leaderCrossesFixedObstacle(a: Vec2, b: Vec2): boolean {
    for (const entry of this.#index.entries) {
      const samples = entry.sampledCurve;
      for (let i = 0; i < samples.length - 1; i += 1) {
        const s0 = samples[i]!, s1 = samples[i + 1]!;
        const seg = intersectSegments(a, b, s0, s1, { epsilon: EPSILON });
        if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") return true;
      }
    }
    return false;
  }

  minClearanceToFixedBranches(point: Vec2): number {
    let minDist = Infinity;
    for (const entry of this.#index.entries) {
      for (const sp of entry.sampledCurve) {
        const d = distance(point, sp);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  boundaryClearance(point: Vec2): number {
    const pts = this.#templatePolygon.points;
    if (pts.length < 3) return 0;
    let minDist = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const d = pointSegmentDistance(point, a, b);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  minBoundsBoundaryClearance(bounds: Bounds): number {
    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    let minClear = Infinity;
    for (const corner of corners) {
      const d = this.boundaryClearance(corner);
      if (d < minClear) minClear = d;
    }
    return minClear;
  }
}
