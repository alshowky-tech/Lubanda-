import { boundsOverlap, expandBounds } from "../geometry/bounds.js";
import { intersectSegments } from "../geometry/segments.js";
import { distance } from "../geometry/vec2.js";
import type { Vec2, Bounds, Polygon } from "../geometry/types.js";
import type { CollisionIndex } from "../collision/types.js";
import type { CandidateCollisionQuery } from "./types.js";

const EPSILON = 1e-7;

/**
 * Read-only CandidateCollisionQuery wrapping a CollisionIndex.
 */
export class DefaultCandidateCollisionQuery implements CandidateCollisionQuery {
  readonly #index: CollisionIndex;
  readonly #templatePolygon: Polygon;

  constructor(
    index: CollisionIndex,
    templatePolygon: Polygon,
  ) {
    this.#index = index;
    this.#templatePolygon = templatePolygon;
  }

  overlapsFixedObstacle(
    bounds: Bounds,
    excludeAnchor?: Vec2,
    anchorRadius?: number,
  ): boolean {
    if (!this.#insidePolygonBounds(bounds, this.#templatePolygon)) return true;

    const candidates = this.#index.query(bounds);
    for (const entry of candidates) {
      if (boundsOverlap(entry.envelopeBounds, bounds)) {
        if (excludeAnchor && anchorRadius && anchorRadius > 0) {
          const exemptionBounds = expandBounds(
            { minX: excludeAnchor.x, maxX: excludeAnchor.x, minY: excludeAnchor.y, maxY: excludeAnchor.y },
            anchorRadius,
          );
          if (boundsOverlap(exemptionBounds, bounds)) continue;
        }
        return true;
      }
    }

    return false;
  }

  minClearanceToFixedBranches(point: Vec2): number {
    let minDist = Infinity;
    for (const entry of this.#index.entries) {
      for (const samplePt of entry.sampledCurve) {
        const d = distance(point, samplePt);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  leaderCrossesFixedObstacle(a: Vec2, b: Vec2): boolean {
    for (const entry of this.#index.entries) {
      const samples = entry.sampledCurve;
      for (let i = 0; i < samples.length - 1; i += 1) {
        const s0 = samples[i]!;
        const s1 = samples[i + 1]!;
        const seg = intersectSegments(a, b, s0, s1, { epsilon: EPSILON });
        if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") return true;
      }
    }
    return false;
  }

  isInsideBoundary(point: Vec2, margin = 0): boolean {
    return this.#pointInsidePolygon(point, this.#templatePolygon, margin);
  }

  #insidePolygonBounds(bounds: Bounds, polygon: Polygon): boolean {
    const corners: Vec2[] = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    for (const corner of corners) {
      if (!this.#pointInsidePolygon(corner, polygon, 0)) return false;
    }
    return true;
  }

  #pointInsidePolygon(point: Vec2, polygon: Polygon, margin: number): boolean {
    if (polygon.points.length < 3) return false;
    let inside = false;
    let j = polygon.points.length - 1;
    for (let i = 0; i < polygon.points.length; j = i, i += 1) {
      const xi = polygon.points[i]!.x;
      const yi = polygon.points[i]!.y;
      const xj = polygon.points[j]!.x;
      const yj = polygon.points[j]!.y;
      if (
        yi + margin > point.y !== yj + margin > point.y &&
        point.x < ((xj - xi) * (point.y - (yi + margin))) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }
}
