import { sha256Canonical } from "../determinism/canonical-json.js";
import { computeRoutingPriority } from "./RoutingPriority.js";
import { computeBranchRadius, computeRequiredClearance } from "./ClearanceModel.js";
import { buildBranchCorridor } from "./CorridorBuilder.js";
import { RoutingDiagnosticCollector } from "./RoutingDiagnostics.js";
import { sampleCubicBezier } from "../geometry/bezier.js";
import { intersectSegments } from "../geometry/segments.js";
import { distance } from "../geometry/vec2.js";
import { polygonArea } from "../territory/polygon-geometry.js";
import type {
  RoutingPlan,
  RoutingRecord,
  RoutingInput,
  RoutingPlanBuilder as RoutingPlanBuilderContract,
  ObstacleClearanceRecord,
} from "./types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import { subtract, normalize } from "../geometry/vec2.js";

const DEFAULT_MAX_BEND_ANGLE = 0.45 * Math.PI;
const DEFAULT_SAFETY_MARGIN = 4;
const EPSILON = 1e-7;
const BEZIER_SAMPLING = Object.freeze({ tolerance: 4, maxSubdivisionDepth: 10 });
const DISCOVERY_THRESHOLD_MULTIPLIER = 3;

/**
 * Compute the minimum distance between two sampled polylines using
 * segment-to-segment distance (via intersectSegments + point-to-segment).
 */
const polylineMinSegmentDistance = (
  polyA: readonly Vec2[],
  polyB: readonly Vec2[],
): number => {
  if (polyA.length < 2 || polyB.length < 2) return Infinity;

  let minDist = Infinity;

  for (let ai = 0; ai < polyA.length - 1; ai += 1) {
    const a0 = polyA[ai]!;
    const a1 = polyA[ai + 1]!;
    for (let bj = 0; bj < polyB.length - 1; bj += 1) {
      const b0 = polyB[bj]!;
      const b1 = polyB[bj + 1]!;

      // Check for segment intersection first
      const seg = intersectSegments(a0, a1, b0, b1, { epsilon: EPSILON });
      if (seg.kind === "PROPER" || seg.kind === "COLLINEAR_OVERLAP") {
        return 0; // intersecting -> distance is zero
      }

      // Point-to-segment distances
      // Distance from a0 to segment b0-b1
      const dA0 = pointToSegmentDistance(a0, b0, b1);
      // Distance from a1 to segment b0-b1
      const dA1 = pointToSegmentDistance(a1, b0, b1);
      // Distance from b0 to segment a0-a1
      const dB0 = pointToSegmentDistance(b0, a0, a1);
      // Distance from b1 to segment a0-a1
      const dB1 = pointToSegmentDistance(b1, a0, a1);

      const candidates = [dA0, dA1, dB0, dB1];
      for (const c of candidates) {
        if (c < minDist) minDist = c;
      }
    }
  }

  return minDist;
};

/**
 * Point-to-segment distance (clamped orthogonal projection).
 */
const pointToSegmentDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const denom = abx * abx + aby * aby;
  if (denom <= EPSILON) return distance(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / denom;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return distance(p, { x: projX, y: projY });
};

/**
 * Builds a complete routing plan from an approved SkeletonPlan.
 */
export class DeterministicRoutingPlanBuilder implements RoutingPlanBuilderContract {
  async build(input: RoutingInput): Promise<RoutingPlan> {
    const diagnostics = new RoutingDiagnosticCollector();
    const skeletonPlan = input.skeletonPlan;

    diagnostics.add("ROUTING_PLAN_CREATION", "ROUTING_START", "INFO", "Routing plan creation started");

    // Pre-sample all non-trunk branch curves for obstacle discovery
    const sampledCurves = new Map<SkeletonBranchId, readonly Vec2[]>();
    for (const branch of skeletonPlan.branches) {
      if (branch.generation > 0) {
        sampledCurves.set(branch.id, sampleCubicBezier(branch.curve, BEZIER_SAMPLING));
      }
    }

    // Pre-compute priorities
    const priorityMap = new Map<SkeletonBranchId, number>();
    for (const branch of skeletonPlan.branches) {
      if (branch.generation > 0) {
        priorityMap.set(branch.id, computeRoutingPriority(branch));
      }
    }

    diagnostics.add(
      "PRIORITY_ASSIGNMENT",
      "PRIORITY_COMPUTED",
      "INFO",
      `Assigned priorities to ${priorityMap.size} branches`,
    );

    const records: RoutingRecord[] = [];

    for (const branch of skeletonPlan.branches) {
      if (branch.generation === 0) continue;

      const branchRadius = computeBranchRadius(branch.genealogyDepth);
      const safetyMargin = DEFAULT_SAFETY_MARGIN;
      const preferredDirection = computeDirection(branch);
      const isMajorLineage = branch.generation === 1 && branch.parentBranchId === null;

      let territoryPolygon: Polygon | null = null;
      if (branch.territoryId !== null) {
        const tPoly = input.territoryPolygons.get(branch.territoryId);
        if (tPoly) territoryPolygon = tPoly;
      }

      // Discover obstacles using full sampled-Bezier broad phase + segment-to-segment narrow phase
      const branchSamples = sampledCurves.get(branch.id) ?? [];
      const obstacleData = discoverObstacles(
        branch,
        branchSamples,
        skeletonPlan.branches,
        sampledCurves,
        branchRadius,
        safetyMargin,
      );

      diagnostics.add(
        "OBSTACLE_DISCOVERY",
        "OBSTACLES_FOUND",
        "INFO",
        `Found ${obstacleData.clearances.length} obstacles for branch ${branch.id}`,
        branch.id,
        { obstacleCount: obstacleData.clearances.length },
        obstacleData.clearances.map((c) => c.obstacleBranchId).slice(0, 10),
      );

      // Build obstacle IDs list and clearance records
      const obstacleBranchIds: SkeletonBranchId[] = obstacleData.clearances.map((c) => c.obstacleBranchId);

      // requiredClearance = maximum pairwise required clearance across all obstacles
      let requiredClearance = computeRequiredClearance(branchRadius, branchRadius, safetyMargin, safetyMargin);
      for (const oc of obstacleData.clearances) {
        if (oc.requiredClearance > requiredClearance) {
          requiredClearance = oc.requiredClearance;
        }
      }

      // Build corridor
      const corridor = buildBranchCorridor({
        branch,
        branchRadius,
        safetyMargin,
        territoryPolygon,
        isMajorLineage,
      });

      const corridorValid = corridor.points.length >= 3 && polygonArea(corridor) > 0;
      const status = corridorValid
        ? (branch.childrenBranchIds.length === 0 ? "TERMINAL" as const : "ROUTABLE" as const)
        : "BLOCKED" as const;

      if (!corridorValid) {
        diagnostics.add(
          "CORRIDOR_CREATION",
          "CORRIDOR_FAILED",
          "ERROR",
          `Corridor failed for branch ${branch.id}`,
          branch.id,
          { area: polygonArea(corridor) },
        );
      } else {
        diagnostics.add(
          "CORRIDOR_CREATION",
          "CORRIDOR_BUILT",
          "INFO",
          `Corridor built for branch ${branch.id}`,
          branch.id,
          { corridorPoints: corridor.points.length },
        );
      }

      const record: RoutingRecord = {
        branchId: branch.id,
        parentBranchId: branch.parentBranchId,
        startNodeId: branch.startNodeId,
        endNodeId: branch.endNodeId,
        ownerPersonId: branch.ownerPersonId,
        territoryId: branch.territoryId,
        generation: branch.generation,
        genealogyDepth: branch.genealogyDepth,
        preferredDirection,
        maximumBendAngle: DEFAULT_MAX_BEND_ANGLE,
        branchRadius,
        safetyMargin,
        requiredClearance,
        routingPriority: priorityMap.get(branch.id) ?? 999,
        corridorPolygon: Object.freeze({
          points: Object.freeze(corridor.points.map((p) => Object.freeze({ x: p.x, y: p.y }))),
        }),
        obstacleBranchIds: Object.freeze([...obstacleBranchIds]),
        obstacleClearances: Object.freeze(obstacleData.clearances.map((c) =>
          Object.freeze({ ...c }),
        )),
        status,
        diagnostics: diagnostics.snapshot(),
      };

      records.push(record);
    }

    records.sort((left, right) => {
      if (left.routingPriority !== right.routingPriority) {
        return left.routingPriority - right.routingPriority;
      }
      return String(left.branchId).localeCompare(String(right.branchId));
    });

    const maxGeneration = Math.max(...records.map((r) => r.generation), 0);

    const canonicalRepr = {
      schemaVersion: "1.0",
      engineVersion: "0.2.0",
      skeletonPlanFingerprint: skeletonPlan.deterministicFingerprint,
      records: records.map((r) => ({
        branchId: r.branchId,
        routingPriority: r.routingPriority,
        branchRadius: r.branchRadius,
        requiredClearance: r.requiredClearance,
        obstacleCount: r.obstacleClearances.length,
        corridorPointCount: r.corridorPolygon.points.length,
        status: r.status,
      })),
      metadata: {
        algorithm: "GLOBAL_ROUTING_FOUNDATION",
        recordCount: records.length,
        maximumGeneration: maxGeneration,
      },
    };

    const deterministicFingerprint = await sha256Canonical(canonicalRepr);

    return Object.freeze({
      schemaVersion: "1.0",
      engineVersion: "0.2.0",
      skeletonPlanFingerprint: skeletonPlan.deterministicFingerprint,
      records: Object.freeze(records),
      metadata: Object.freeze({
        algorithm: "GLOBAL_ROUTING_FOUNDATION",
        recordCount: records.length,
        maximumGeneration: maxGeneration,
      }),
      deterministicFingerprint,
    });
  }
}

const computeDirection = (branch: SkeletonBranch) => {
  const vec = subtract(branch.endPoint, branch.startPoint);
  const len = Math.hypot(vec.x, vec.y);
  if (len <= EPSILON) return Object.freeze({ x: 0, y: -1 });
  return normalize(vec);
};

interface ObstacleResult {
  readonly clearances: readonly ObstacleClearanceRecord[];
}

/**
 * Discover obstacles using full sampled-Bezier AABB (broad phase) and
 * segment-to-segment minimum distance (narrow phase).
 *
 * An obstacle is added only after narrow-phase validation passes:
 * the measured segment-to-segment distance must be <= discovery threshold.
 */
const discoverObstacles = (
  branch: SkeletonBranch,
  branchSamples: readonly Vec2[],
  allBranches: readonly SkeletonBranch[],
  sampledCurves: ReadonlyMap<SkeletonBranchId, readonly Vec2[]>,
  branchRadius: number,
  safetyMargin: number,
): ObstacleResult => {
  const allPts = branchSamples.length > 0 ? branchSamples
    : [branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3];

  // Broad-phase AABB from ALL sampled points, expanded using BOTH branches' radii
  const bMinX = Math.min(...allPts.map((p) => p.x));
  const bMinY = Math.min(...allPts.map((p) => p.y));
  const bMaxX = Math.max(...allPts.map((p) => p.x));
  const bMaxY = Math.max(...allPts.map((p) => p.y));

  const clearances: ObstacleClearanceRecord[] = [];

  for (const other of allBranches) {
    if (other.generation === 0) continue;
    if (other.id === branch.id) continue;
    if (branch.parentBranchId !== null && other.id === branch.parentBranchId) continue;

    const otherSamples = sampledCurves.get(other.id) ??
      [other.curve.p0, other.curve.p1, other.curve.p2, other.curve.p3];

    // Broad-phase AABB expanded using BOTH branches' radii and safety margins
    const otherRadius = computeBranchRadius(other.genealogyDepth);
    const expansion = (branchRadius + otherRadius + safetyMargin * 2) * DISCOVERY_THRESHOLD_MULTIPLIER;

    const oMinX = Math.min(...otherSamples.map((p) => p.x));
    const oMinY = Math.min(...otherSamples.map((p) => p.y));
    const oMaxX = Math.max(...otherSamples.map((p) => p.x));
    const oMaxY = Math.max(...otherSamples.map((p) => p.y));

    if (
      bMaxX + expansion < oMinX - expansion ||
      oMaxX + expansion < bMinX - expansion ||
      bMaxY + expansion < oMinY - expansion ||
      oMaxY + expansion < bMinY - expansion
    ) {
      continue;
    }

    // Narrow phase: segment-to-segment minimum distance
    const branchPts = branchSamples.length > 0 ? branchSamples
      : [branch.curve.p0, branch.curve.p3];
    const otherPts = otherSamples;

    const minDist = polylineMinSegmentDistance(branchPts, otherPts);

    // Pairwise required clearance
    const pairwise = computeRequiredClearance(branchRadius, otherRadius, safetyMargin, safetyMargin);

    // Discovery threshold: accept as obstacle only if distance <= pairwise * multiplier
    const discoveryThreshold = pairwise * DISCOVERY_THRESHOLD_MULTIPLIER;
    if (minDist > discoveryThreshold) continue;

    clearances.push({
      obstacleBranchId: other.id,
      requiredClearance: pairwise,
      sampledMinSegmentDistance: Math.round(minDist * 1000) / 1000,
    });
  }

  // Sort by obstacleBranchId for deterministic output
  clearances.sort((left, right) =>
    String(left.obstacleBranchId).localeCompare(String(right.obstacleBranchId)),
  );

  return { clearances: Object.freeze(clearances) };
};
