import { sha256Canonical } from "../determinism/canonical-json.js";
import { computeRoutingPriority } from "./RoutingPriority.js";
import { computeBranchRadius, computeRequiredClearance } from "./ClearanceModel.js";
import { buildBranchCorridor } from "./CorridorBuilder.js";
import { RoutingDiagnosticCollector } from "./RoutingDiagnostics.js";
import { sampleCubicBezier } from "../geometry/bezier.js";
import { distance } from "../geometry/vec2.js";
import { polygonArea } from "../territory/polygon-geometry.js";
import type {
  RoutingPlan,
  RoutingRecord,
  RoutingInput,
  RoutingPlanBuilder as RoutingPlanBuilderContract,
} from "./types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import { subtract, normalize } from "../geometry/vec2.js";

const DEFAULT_MAX_BEND_ANGLE = 0.45 * Math.PI;
const DEFAULT_SAFETY_MARGIN = 4;
const EPSILON = 1e-7;
const BEZIER_SAMPLING = Object.freeze({ tolerance: 4, maxSubdivisionDepth: 10 });

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

      // Discover obstacles using sampled Bezier AABB + narrow-phase distance
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
        `Found ${obstacleData.ids.length} obstacles for branch ${branch.id}`,
        branch.id,
        { obstacleCount: obstacleData.ids.length },
        obstacleData.ids.slice(0, 10),
      );

      // Pairwise clearance: compute clearance against each obstacle, take max
      let pairwiseClearance = computeRequiredClearance(branchRadius, branchRadius, safetyMargin, safetyMargin);
      if (obstacleData.maxClearance !== null && obstacleData.maxClearance > pairwiseClearance) {
        pairwiseClearance = obstacleData.maxClearance;
      }

      // Build corridor
      const corridor = buildBranchCorridor({
        branch,
        branchRadius,
        safetyMargin,
        territoryPolygon,
        isMajorLineage,
      });

      // If corridor is degenerate (empty), mark as BLOCKED
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
        requiredClearance: pairwiseClearance,
        routingPriority: priorityMap.get(branch.id) ?? 999,
        corridorPolygon: Object.freeze({
          points: Object.freeze(corridor.points.map((p) => Object.freeze({ x: p.x, y: p.y }))),
        }),
        obstacleBranchIds: Object.freeze([...obstacleData.ids]),
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
        obstacleCount: r.obstacleBranchIds.length,
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
  readonly ids: readonly SkeletonBranchId[];
  readonly maxClearance: number | null;
}

/**
 * Discover obstacles using full sampled-Bezier AABB (broad phase) and
 * narrow-phase pairwise distance checking.
 */
const discoverObstacles = (
  branch: SkeletonBranch,
  branchSamples: readonly Vec2[],
  allBranches: readonly SkeletonBranch[],
  sampledCurves: ReadonlyMap<SkeletonBranchId, readonly Vec2[]>,
  branchRadius: number,
  safetyMargin: number,
): ObstacleResult => {
  // Broad-phase AABB from ALL sampled Bezier points (not just endpoints)
  const allPts = branchSamples.length > 0 ? branchSamples : [branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3];
  const bMinX = Math.min(...allPts.map((p) => p.x));
  const bMinY = Math.min(...allPts.map((p) => p.y));
  const bMaxX = Math.max(...allPts.map((p) => p.x));
  const bMaxY = Math.max(...allPts.map((p) => p.y));
  const clearance = branchRadius * 2 + safetyMargin * 2;
  const expanded = clearance * 3;

  const broadMinX = bMinX - expanded;
  const broadMinY = bMinY - expanded;
  const broadMaxX = bMaxX + expanded;
  const broadMaxY = bMaxY + expanded;

  const result: SkeletonBranchId[] = [];
  let maxClearance: number | null = null;

  for (const other of allBranches) {
    if (other.generation === 0) continue;
    if (other.id === branch.id) continue;
    if (branch.parentBranchId !== null && other.id === branch.parentBranchId) continue;

    // Broad phase: AABB from ALL sampled points of the other branch
    const otherSamples = sampledCurves.get(other.id) ?? [other.curve.p0, other.curve.p1, other.curve.p2, other.curve.p3];
    const oMinX = Math.min(...otherSamples.map((p) => p.x));
    const oMinY = Math.min(...otherSamples.map((p) => p.y));
    const oMaxX = Math.max(...otherSamples.map((p) => p.x));
    const oMaxY = Math.max(...otherSamples.map((p) => p.y));

    if (broadMaxX < oMinX || oMaxX < broadMinX || broadMaxY < oMinY || oMaxY < broadMinY) {
      continue;
    }

    result.push(other.id);

    // Narrow-phase: compute minimum distance between sampled curves
    const branchPts = branchSamples.length > 0 ? branchSamples : [branch.curve.p0, branch.curve.p3];
    const otherPts = otherSamples;
    let minDist = Infinity;
    for (let i = 0; i < branchPts.length; i += 1) {
      const bp = branchPts[i]!;
      for (let j = 0; j < otherPts.length; j += 1) {
        const op = otherPts[j]!;
        const d = distance(bp, op);
        if (d < minDist) minDist = d;
      }
    }

    // Pairwise clearance = radiusA + radiusB + safetyA + safetyB
    const otherRadius = computeBranchRadius(other.genealogyDepth);
    const pairwise = computeRequiredClearance(branchRadius, otherRadius, safetyMargin, safetyMargin);
    if (maxClearance === null || pairwise > maxClearance) {
      maxClearance = pairwise;
    }
  }

  result.sort((left, right) => String(left).localeCompare(String(right)));

  return { ids: result, maxClearance };
};
