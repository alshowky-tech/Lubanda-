import { computeRequiredClearance } from "../routing/ClearanceModel.js";
import { pointSegmentDistance, intersectSegments } from "../geometry/segments.js";
import { distance } from "../geometry/vec2.js";
import type { Vec2 } from "../geometry/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { RoutingRecord } from "../routing/types.js";
import type {
  CollisionRecord,
  CollisionSeverity,
  CollisionIndexEntry,
  CollisionPolicy,
  ResolutionScope,
} from "./types.js";

const EPSILON = 1e-7;

/**
 * Narrow-phase check: measure minimum distance between two sampled polylines.
 * Uses segment intersection detection and point-to-segment distance.
 * If any segment pair intersects, distance is 0 (penetration).
 */
const polylineMinDistance = (polyA: readonly Vec2[], polyB: readonly Vec2[]): number => {
  if (polyA.length < 2 || polyB.length < 2) return Infinity;

  let minDist = Infinity;

  for (let ai = 0; ai < polyA.length - 1; ai += 1) {
    const a0 = polyA[ai]!;
    const a1 = polyA[ai + 1]!;
    for (let bj = 0; bj < polyB.length - 1; bj += 1) {
      const b0 = polyB[bj]!;
      const b1 = polyB[bj + 1]!;

      // Check segment intersection first (crossing = penetration)
      const seg = intersectSegments(a0, a1, b0, b1, { epsilon: EPSILON });
      if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") {
        return 0;
      }

      // Distance from a0 to segment b0-b1
      const dA0 = pointSegmentDistance(a0, b0, b1);
      // Distance from a1 to segment b0-b1
      const dA1 = pointSegmentDistance(a1, b0, b1);
      // Distance from b0 to segment a0-a1
      const dB0 = pointSegmentDistance(b0, a0, a1);
      // Distance from b1 to segment a0-a1
      const dB1 = pointSegmentDistance(b1, a0, a1);

      const candidates = [dA0, dA1, dB0, dB1];
      for (const c of candidates) {
        if (c < minDist) {
          minDist = c;
          if (minDist <= EPSILON) return 0; // early exit on contact
        }
      }
    }
  }

  return minDist;
};

/**
 * Find the closest pair of points between two polylines.
 * Returns the two closest points and their distance.
 */
const findClosestPoints = (
  polyA: readonly Vec2[],
  polyB: readonly Vec2[],
): { pointA: Vec2; pointB: Vec2; distance: number } => {
  let bestDist = Infinity;
  let bestA: Vec2 = polyA[0]!;
  let bestB: Vec2 = polyB[0]!;

  for (let ai = 0; ai < polyA.length - 1; ai += 1) {
    const a0 = polyA[ai]!;
    const a1 = polyA[ai + 1]!;
    for (let bj = 0; bj < polyB.length - 1; bj += 1) {
      const b0 = polyB[bj]!;
      const b1 = polyB[bj + 1]!;

      const dA0 = pointSegmentDistance(a0, b0, b1);
      if (dA0 < bestDist) {
        bestDist = dA0;
        bestA = a0;
        // Project a0 onto segment b0-b1 for closest point on B
        bestB = projectPointOnSegment(a0, b0, b1);
      }

      const dB0 = pointSegmentDistance(b0, a0, a1);
      if (dB0 < bestDist) {
        bestDist = dB0;
        bestB = b0;
        bestA = projectPointOnSegment(b0, a0, a1);
      }
    }
  }

  return { pointA: bestA, pointB: bestB, distance: bestDist };
};

/**
 * Project a point onto a line segment, returning the closest point on the segment.
 */
const projectPointOnSegment = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const denom = abx * abx + aby * aby;
  if (denom <= EPSILON) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / denom;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
};

/**
 * Determine if two branches are adjacent (parent-child) and within the
 * junction exemption zone.
 */
const isAdjacentExempt = (
  branchIdA: SkeletonBranchId,
  branchIdB: SkeletonBranchId,
  routingRecordA: RoutingRecord,
  routingRecordB: RoutingRecord,
  adjacentJunctionRadius: number,
): boolean => {
  const areAdjacent =
    (routingRecordA.parentBranchId === branchIdB) ||
    (routingRecordB.parentBranchId === branchIdA);
  if (!areAdjacent) return false;

  // Adjacent branches may share geometry only within a bounded junction region
  const parentIsA = routingRecordB.parentBranchId === branchIdA;
  const parentRecord = parentIsA ? routingRecordA : routingRecordB;
  const childRecord = parentIsA ? routingRecordB : routingRecordA;

  // Check if the child's start point is within the junction radius of the parent
  const junctionDist = distance(childRecord.corridorPolygon.points[0]!, parentRecord.corridorPolygon.points[0]!);
  return junctionDist <= adjacentJunctionRadius;
};

/**
 * Test a single branch against the collision index for branch–branch collisions.
 * Uses broad phase (spatial index query on envelope bounds) then narrow phase
 * (curve-to-curve distance via sampled polylines).
 */
export const testBranchAgainstIndex = (
  branchId: SkeletonBranchId,
  entry: CollisionIndexEntry,
  index: { readonly entries: readonly CollisionIndexEntry[]; readonly query: (bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }) => readonly CollisionIndexEntry[] },
  policy: CollisionPolicy,
): readonly CollisionRecord[] => {
  if (!policy.checkBranchBranch) return [];

  const collisions: CollisionRecord[] = [];

  // Broad phase: query spatial index with this branch's envelope bounds
  const candidates = index.query(entry.envelopeBounds);

  for (const candidate of candidates) {
    if (candidate.branchId === branchId) continue;

    // Adjacent exemption
    if (isAdjacentExempt(
      branchId, candidate.branchId,
      entry.routingRecord, candidate.routingRecord,
      policy.adjacentJunctionRadius,
    )) continue;

    // Narrow phase: measure minimum curve-to-curve distance
    const minDist = polylineMinDistance(entry.sampledCurve, candidate.sampledCurve);

    // Required clearance uses the canonical formula from routing's ClearanceModel
    const requiredClearance = computeRequiredClearance(
      entry.routingRecord.branchRadius,
      candidate.routingRecord.branchRadius,
      entry.routingRecord.safetyMargin,
      candidate.routingRecord.safetyMargin,
    );

    if (minDist < requiredClearance - EPSILON) {
      const deficit = Math.max(0, requiredClearance - minDist);
      const { pointA, pointB } = findClosestPoints(entry.sampledCurve, candidate.sampledCurve);

      const severity: CollisionSeverity = minDist <= EPSILON ? "PENETRATION" : "CLEARANCE_DEFICIT";
      const resolution: ResolutionScope = deficit > requiredClearance * 0.5
        ? "BEND_PATH"
        : "LOCAL_RELAXATION";

      collisions.push({
        branchIdA: branchId,
        branchIdB: candidate.branchId,
        collisionClass: "BRANCH_BRANCH",
        closestPointA: pointA,
        closestPointB: pointB,
        measuredDistance: Math.round(minDist * 1000) / 1000,
        requiredClearance: Math.round(requiredClearance * 1000) / 1000,
        clearanceDeficit: Math.round(deficit * 1000) / 1000,
        severity,
        recommendedResolution: resolution,
      });
    }
  }

  return collisions;
};

/**
 * Test a branch for self-collision.
 * A long curve MUST be tested against non-adjacent portions of itself (LCS-GEO-004).
 */
export const testSelfCollision = (
  entry: CollisionIndexEntry,
  policy: CollisionPolicy,
): readonly CollisionRecord[] => {
  if (!policy.checkSelfCollision) return [];
  if (entry.sampledCurve.length < 8) return [];

  const collisions: CollisionRecord[] = [];
  const samples = entry.sampledCurve;

  // Measure approximate curve length
  let curveLength = 0;
  for (let i = 1; i < samples.length; i += 1) {
    curveLength += distance(samples[i - 1]!, samples[i]!);
  }

  if (curveLength < policy.selfCollisionMinimumLength) return [];

  // Test non-adjacent portions: split curve into segments and test
  // segments separated by at least 1/3 of the curve
  const third = Math.floor(samples.length / 3);
  if (third < 2) return [];

  const firstThird = samples.slice(0, third);
  const lastThird = samples.slice(third * 2);

  const minDist = polylineMinDistance(firstThird, lastThird);

  // Self-collision uses the branch's own envelope radius as required clearance
  const ownClearance = entry.envelopeRadius * 2;

  if (minDist < ownClearance - EPSILON) {
    const deficit = Math.max(0, ownClearance - minDist);
    const { pointA, pointB } = findClosestPoints(firstThird, lastThird);

    collisions.push({
      branchIdA: entry.branchId,
      branchIdB: entry.branchId,
      collisionClass: "SELF_INTERSECTION",
      closestPointA: pointA,
      closestPointB: pointB,
      measuredDistance: Math.round(minDist * 1000) / 1000,
      requiredClearance: Math.round(ownClearance * 1000) / 1000,
      clearanceDeficit: Math.round(deficit * 1000) / 1000,
      severity: minDist <= EPSILON ? "PENETRATION" : "CLEARANCE_DEFICIT",
      recommendedResolution: "BEND_PATH",
    });
  }

  return collisions;
};

/**
 * Test a branch for boundary violations against a template polygon.
 */
export const testBoundaryContainment = (
  entry: CollisionIndexEntry,
  templatePoints: readonly Vec2[],
  policy: CollisionPolicy,
): readonly CollisionRecord[] => {
  if (!policy.checkBranchBoundary) return [];
  if (templatePoints.length < 3) return [];

  const collisions: CollisionRecord[] = [];

  // Check each sampled curve point against the template boundary
  for (const point of entry.sampledCurve) {
    if (!isInsidePolygon(point, templatePoints)) {
      collisions.push({
        branchIdA: entry.branchId,
        branchIdB: null,
        collisionClass: "BRANCH_BOUNDARY",
        closestPointA: point,
        closestPointB: nearestBoundaryPoint(point, templatePoints),
        measuredDistance: 0,
        requiredClearance: entry.envelopeRadius,
        clearanceDeficit: entry.envelopeRadius,
        severity: "PENETRATION",
        recommendedResolution: "SHIFT_JUNCTION",
      });
      break; // one boundary violation per branch is sufficient
    }
  }

  return collisions;
};

/**
 * Point-in-polygon test using ray casting.
 */
const isInsidePolygon = (point: Vec2, polygon: readonly Vec2[]): boolean => {
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    if (
      ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)
    ) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Find the nearest point on a polygon boundary to a given point.
 */
const nearestBoundaryPoint = (point: Vec2, polygon: readonly Vec2[]): Vec2 => {
  let bestDist = Infinity;
  let bestPoint = polygon[0]!;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const proj = projectPointOnSegment(point, a, b);
    const d = distance(point, proj);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = proj;
    }
  }

  return bestPoint;
};
