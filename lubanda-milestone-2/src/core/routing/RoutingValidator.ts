import type { EngineIssue } from "../contracts/issues.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { SkeletonPlan, SkeletonBranch } from "../skeleton/types.js";
import type { RoutingPlan, RoutingRecord } from "./types.js";
import { polygonArea } from "../territory/polygon-geometry.js";

const issue = (
  code: string,
  messageKey: string,
  entityIds: readonly string[] = [],
  details?: Readonly<Record<string, unknown>>,
): EngineIssue => ({
  code,
  severity: "ERROR" as const,
  messageKey,
  stage: "VALIDATE_SKELETON" as const,
  ...(entityIds.length === 0 ? {} : { entityIds }),
  ...(details ? { details } : {}),
  recoverable: true,
}) as unknown as EngineIssue;

/**
 * Validates a Milestone 4.1 routing plan against structural, geometric,
 * and consistency constraints.
 */
export class RoutingValidator {
  validate(
    plan: RoutingPlan,
    skeletonPlan: SkeletonPlan,
    skeletonBranchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>,
  ): { accepted: boolean; issues: readonly EngineIssue[] } {
    const issues: EngineIssue[] = [];
    const recordMap = new Map<string, RoutingRecord>();
    const seenBranchIds = new Set<string>();

    // 1. Every routable skeleton branch (non-trunk) has a routing record
    const routableBranches = skeletonPlan.branches.filter((b) => b.generation > 0);
    for (const branch of routableBranches) {
      const record = plan.records.find((r) => r.branchId === branch.id);
      if (!record) {
        issues.push(
          issue("ROUTING_MISSING_RECORD", "routing.missingRecord", [branch.id]),
        );
      }
    }

    // 2. No duplicate records
    for (const record of plan.records) {
      if (seenBranchIds.has(record.branchId)) {
        issues.push(
          issue("ROUTING_DUPLICATE_RECORD", "routing.duplicateRecord", [record.branchId]),
        );
      }
      seenBranchIds.add(record.branchId);
      recordMap.set(record.branchId, record);
    }

    for (const record of plan.records) {
      // 3. Branch exists in skeleton
      const skeletonBranch = skeletonBranchMap.get(record.branchId);
      if (!skeletonBranch) {
        issues.push(
          issue("ROUTING_INVALID_BRANCH_REF", "routing.invalidBranchRef", [record.branchId]),
        );
        continue;
      }

      // 4. Start/end nodes exist
      const nodeIds = new Set(skeletonPlan.nodes.map((n) => n.id));
      if (!nodeIds.has(record.startNodeId)) {
        issues.push(
          issue("ROUTING_INVALID_NODE_REF", "routing.invalidNodeRef", [record.startNodeId]),
        );
      }
      if (!nodeIds.has(record.endNodeId)) {
        issues.push(
          issue("ROUTING_INVALID_NODE_REF", "routing.invalidNodeRef", [record.endNodeId]),
        );
      }

      // 5. Parent branch exists
      if (record.parentBranchId !== null && !skeletonBranchMap.has(record.parentBranchId)) {
        issues.push(
          issue("ROUTING_INVALID_PARENT_REF", "routing.invalidParentRef", [record.parentBranchId]),
        );
      }

      // 6. Territory exists when assigned
      if (record.territoryId !== null) {
        const assigned = skeletonPlan.branches.find((b) => b.territoryId === record.territoryId);
        if (!assigned) {
          issues.push(
            issue("ROUTING_INVALID_TERRITORY_REF", "routing.invalidTerritoryRef", [record.territoryId]),
          );
        }
      }

      // 7. Finite values
      if (!Number.isFinite(record.branchRadius) || record.branchRadius < 0) {
        issues.push(
          issue("ROUTING_INVALID_RADIUS", "routing.invalidRadius", [record.branchId]),
        );
      }
      if (!Number.isFinite(record.safetyMargin) || record.safetyMargin < 0) {
        issues.push(
          issue("ROUTING_INVALID_MARGIN", "routing.invalidMargin", [record.branchId]),
        );
      }
      if (!Number.isFinite(record.maximumBendAngle) || record.maximumBendAngle < 0) {
        issues.push(
          issue("ROUTING_INVALID_BEND_ANGLE", "routing.invalidBendAngle", [record.branchId]),
        );
      }
      if (!Number.isFinite(record.requiredClearance) || record.requiredClearance < 0) {
        issues.push(
          issue("ROUTING_INVALID_CLEARANCE", "routing.invalidClearance", [record.branchId]),
        );
      }

      // 8. Corridor checks based on status
      if (record.status === "BLOCKED") {
        // BLOCKED must have an empty corridor (or degenerate)
        if (record.corridorPolygon.points.length >= 3) {
          issues.push(
            issue("ROUTING_BLOCKED_WITH_VALID_CORRIDOR", "routing.blockedWithValidCorridor", [record.branchId]),
          );
        }
      } else {
        // ROUTABLE or TERMINAL must have a finite positive-area corridor
        if (record.corridorPolygon.points.length < 3) {
          issues.push(
            issue("ROUTING_EMPTY_CORRIDOR", "routing.emptyCorridor", [record.branchId]),
          );
        } else {
          const area = polygonArea(record.corridorPolygon);
          if (area <= 0) {
            issues.push(
              issue("ROUTING_ZERO_AREA_CORRIDOR", "routing.zeroAreaCorridor", [record.branchId]),
            );
          }
          for (const pt of record.corridorPolygon.points) {
            if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
              issues.push(
                issue("ROUTING_INVALID_CORRIDOR", "routing.invalidCorridor", [record.branchId]),
              );
              break;
            }
          }
        }
      }

      // 9. Obstacle IDs and clearance records
      if (record.obstacleBranchIds.length > 0) {
        const uniqueObs = new Set(record.obstacleBranchIds);
        if (uniqueObs.size !== record.obstacleBranchIds.length) {
          const dups: string[] = [];
          const seenSet = new Set<string>();
          for (const id of record.obstacleBranchIds) {
            if (seenSet.has(id)) dups.push(id);
            else seenSet.add(id);
          }
          issues.push(
            issue("ROUTING_DUPLICATE_OBSTACLE", "routing.duplicateObstacle", [...new Set(dups)]),
          );
        }
        if (record.obstacleBranchIds.includes(record.branchId)) {
          issues.push(
            issue("ROUTING_SELF_OBSTACLE", "routing.selfObstacle", [record.branchId]),
          );
        }

        // Obstacle clearance records must exist for each obstacle
        const clearanceMap = new Map(
          record.obstacleClearances.map((c) => [c.obstacleBranchId, c]),
        );
        for (const obsId of record.obstacleBranchIds) {
          const cr = clearanceMap.get(obsId);
          if (!cr) {
            issues.push(
              issue("ROUTING_MISSING_CLEARANCE_RECORD", "routing.missingClearanceRecord", [record.branchId, obsId]),
            );
          } else {
            // Validate pairwise clearance values
            if (!Number.isFinite(cr.requiredClearance) || cr.requiredClearance < 0) {
              issues.push(
                issue("ROUTING_INVALID_CLEARANCE", "routing.invalidClearance", [record.branchId, obsId]),
              );
            }
            if (!Number.isFinite(cr.sampledMinSegmentDistance) || cr.sampledMinSegmentDistance < 0) {
              issues.push(
                issue("ROUTING_INVALID_SAMPLED_DISTANCE", "routing.invalidSampledDistance", [record.branchId, obsId]),
              );
            }
            // requiredClearance must be >= each pairwise clearance
            if (cr.requiredClearance > record.requiredClearance) {
              issues.push(
                issue("ROUTING_CLEARANCE_EXCEEDS_MAX", "routing.clearanceExceedsMax", [record.branchId, obsId]),
              );
            }
          }
        }

        // No extra clearance records without matching obstacle
        for (const cr of record.obstacleClearances) {
          if (!record.obstacleBranchIds.includes(cr.obstacleBranchId)) {
            issues.push(
              issue("ROUTING_EXTRA_CLEARANCE_RECORD", "routing.extraClearanceRecord", [record.branchId, cr.obstacleBranchId]),
            );
          }
        }
      }

      // 10. Priority uniqueness
      const samePriority = plan.records.filter(
        (r) => r.routingPriority === record.routingPriority,
      );
      if (samePriority.length > 1) {
        const alreadyFlagged = issues.some(
          (i) => i.details && "priority" in i.details &&
            (i.details as Record<string, unknown>).priority === record.routingPriority,
        );
        if (!alreadyFlagged) {
          issues.push(
            issue("ROUTING_DUPLICATE_PRIORITY", "routing.duplicatePriority",
              samePriority.map((r) => r.branchId),
              { priority: record.routingPriority },
            ),
          );
        }
      }

      // 11. Topology equality against skeleton
      if (skeletonBranch) {
        if (record.parentBranchId !== skeletonBranch.parentBranchId) {
          issues.push(
            issue("ROUTING_TOPOLOGY_MISMATCH", "routing.topologyMismatch", [record.branchId],
              { field: "parentBranchId" }),
          );
        }
        if (record.startNodeId !== skeletonBranch.startNodeId) {
          issues.push(
            issue("ROUTING_TOPOLOGY_MISMATCH", "routing.topologyMismatch", [record.branchId],
              { field: "startNodeId" }),
          );
        }
        if (record.endNodeId !== skeletonBranch.endNodeId) {
          issues.push(
            issue("ROUTING_TOPOLOGY_MISMATCH", "routing.topologyMismatch", [record.branchId],
              { field: "endNodeId" }),
          );
        }
      }
    }

    return {
      accepted: issues.length === 0,
      issues: Object.freeze(issues),
    };
  }
}
