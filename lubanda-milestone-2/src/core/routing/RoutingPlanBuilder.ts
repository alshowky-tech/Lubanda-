import { sha256Canonical } from "../determinism/canonical-json.js";
import { computeRoutingPriority } from "./RoutingPriority.js";
import { computeBranchRadius, computeRequiredClearance } from "./ClearanceModel.js";
import { buildBranchCorridor } from "./CorridorBuilder.js";
import { RoutingDiagnosticCollector } from "./RoutingDiagnostics.js";
import type {
  RoutingPlan,
  RoutingRecord,
  RoutingInput,
  RoutingPlanBuilder as RoutingPlanBuilderContract,
} from "./types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { Polygon } from "../geometry/types.js";
import { subtract, normalize } from "../geometry/vec2.js";

const DEFAULT_MAX_BEND_ANGLE = 0.45 * Math.PI;
const DEFAULT_SAFETY_MARGIN = 4;
const ESPILON = 1e-7;

/**
 * Builds a complete routing plan from an approved SkeletonPlan.
 *
 * Every non-trunk branch receives a routing record with:
 * - deterministic priority
 * - computed radius and clearance
 * - corridor polygon
 * - discovered obstacle branches
 */
export class DeterministicRoutingPlanBuilder implements RoutingPlanBuilderContract {
  async build(input: RoutingInput): Promise<RoutingPlan> {
    const diagnostics = new RoutingDiagnosticCollector();
    const skeletonPlan = input.skeletonPlan;

    diagnostics.add("ROUTING_PLAN_CREATION", "ROUTING_START", "INFO", "Routing plan creation started");

    // Build routing records for non-trunk branches only
    const records: RoutingRecord[] = [];

    // Pre-compute priorities for tie-breaking
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

    for (const branch of skeletonPlan.branches) {
      if (branch.generation === 0) continue; // Skip trunk segments

      const branchRadius = computeBranchRadius(branch.genealogyDepth);
      const safetyMargin = DEFAULT_SAFETY_MARGIN;
      const preferredDirection = computeDirection(branch);
      const isMajorLineage = branch.generation === 1 && branch.parentBranchId === null;

      // Territory polygon for this branch
      let territoryPolygon: Polygon | null = null;
      if (branch.territoryId !== null) {
        const tId = branch.territoryId;
        // Find the territory polygon from the skeleton plan's territory plan
        // For M4.1 we use the branch's assigned territory reference
        const tPoly = input.territoryPolygons.get(tId);
        if (tPoly) territoryPolygon = tPoly;
      }

      // Build corridor
      const corridor = buildBranchCorridor({
        branch,
        branchRadius,
        safetyMargin,
        territoryPolygon,
        isMajorLineage,
      });

      diagnostics.add(
        "CORRIDOR_CREATION",
        "CORRIDOR_BUILT",
        "INFO",
        `Corridor built for branch ${branch.id}`,
        branch.id,
        { corridorPoints: corridor.points.length },
      );

      // Discover obstacles
      const obstacleBranchIds = discoverObstacles(
        branch,
        skeletonPlan.branches,
        branchRadius,
        safetyMargin,
      );

      diagnostics.add(
        "OBSTACLE_DISCOVERY",
        "OBSTACLES_FOUND",
        "INFO",
        `Found ${obstacleBranchIds.length} obstacles for branch ${branch.id}`,
        branch.id,
        { obstacleCount: obstacleBranchIds.length },
        obstacleBranchIds.slice(0, 10),
      );

      // Compute clearance against the nearest obstacle
      const requiredClearance = computeRequiredClearance(branchRadius, branchRadius, safetyMargin, safetyMargin);

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
        status: branch.childrenBranchIds.length === 0 ? "TERMINAL" : "ROUTABLE",
        diagnostics: diagnostics.snapshot(),
      };

      records.push(record);
    }

    // Sort records by priority for deterministic output order
    records.sort((left, right) => {
      if (left.routingPriority !== right.routingPriority) {
        return left.routingPriority - right.routingPriority;
      }
      return String(left.branchId).localeCompare(String(right.branchId));
    });

    const maxGeneration = Math.max(...records.map((r) => r.generation), 0);

    // Build fingerprint
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
      })),
      metadata: {
        algorithm: "GLOBAL_ROUTING_FOUNDATION",
        recordCount: records.length,
        maximumGeneration: maxGeneration,
      },
    };

    const deterministicFingerprint = await sha256Canonical(canonicalRepr);

    const plan: RoutingPlan = Object.freeze({
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

    return plan;
  }
}

/**
 * Compute preferred direction from branch start to end (normalized).
 */
const computeDirection = (branch: SkeletonBranch) => {
  const vec = subtract(branch.endPoint, branch.startPoint);
  const len = Math.hypot(vec.x, vec.y);
  if (len <= ESPILON) return Object.freeze({ x: 0, y: -1 }); // default upward
  return normalize(vec);
};

/**
 * Discover nearby obstacle branches using expanded bounds.
 * Excludes the branch itself. For parent exclusion, allows shared geometry.
 */
const discoverObstacles = (
  branch: SkeletonBranch,
  allBranches: readonly SkeletonBranch[],
  branchRadius: number,
  safetyMargin: number,
): readonly SkeletonBranchId[] => {
  const clearance = branchRadius * 2 + safetyMargin * 2;
  const expanded = clearance * 3;

  const bounds = {
    minX: Math.min(branch.curve.p0.x, branch.curve.p3.x) - expanded,
    minY: Math.min(branch.curve.p0.y, branch.curve.p3.y) - expanded,
    maxX: Math.max(branch.curve.p0.x, branch.curve.p3.x) + expanded,
    maxY: Math.max(branch.curve.p0.y, branch.curve.p3.y) + expanded,
  };

  const result: SkeletonBranchId[] = [];

  for (const other of allBranches) {
    // Skip trunk segments
    if (other.generation === 0) continue;
    // Skip self
    if (other.id === branch.id) continue;
    // Skip direct parent (shared endpoint geometry is allowed)
    if (branch.parentBranchId !== null && other.id === branch.parentBranchId) continue;

    // AABB broad phase
    const otherMinX = Math.min(other.curve.p0.x, other.curve.p3.x);
    const otherMinY = Math.min(other.curve.p0.y, other.curve.p3.y);
    const otherMaxX = Math.max(other.curve.p0.x, other.curve.p3.x);
    const otherMaxY = Math.max(other.curve.p0.y, other.curve.p3.y);

    if (
      bounds.maxX < otherMinX ||
      otherMaxX < bounds.minX ||
      bounds.maxY < otherMinY ||
      otherMaxY < bounds.minY
    ) {
      continue;
    }

    result.push(other.id);
  }

  // Sort for deterministic output
  result.sort((left, right) => String(left).localeCompare(String(right)));

  return result;
};
