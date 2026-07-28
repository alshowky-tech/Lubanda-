import { DeterministicCollisionEngine } from "./CollisionEngine.js";
import { DEFAULT_COLLISION_POLICY } from "./types.js";
import type {
  CollisionInput,
  CollisionPolicy,
  CollisionRecord,
  CollisionValidationReport,
  LocalRepairAction,
  LocalRepairResult,
  ResolutionScope,
} from "./types.js";

/**
 * Deterministic local repair for collision resolution.
 *
 * Per LCS-IMP-002: "Implement broad and narrow phase checks and local repair."
 * Per LNGP-R3-05 §6: Resolution strategy preferred order:
 *   1. reject candidate,
 *   2. bend path,
 *   3. shift junction,
 *   4. adjust territory,
 *   5. move label,
 *   6. local relaxation,
 *   7. escalate to regional re-solve.
 *
 * This is NOT a global CollisionSolver. It performs local resolution only:
 * - Scans the skeleton for collisions using the CollisionEngine
 * - Records each collision with a recommended resolution scope
 * - Returns the result as pending actions (no skeleton mutation)
 *
 * IMMUTABILITY GUARANTEE: This function never mutates its inputs.
 * - The SkeletonPlan is read-only (frozen by SkeletonGrowthEngine)
 * - The RoutingPlan is read-only (frozen by RoutingPlanBuilder)
 * - All RoutingRecords and corridor polygons are deep-frozen
 * - The function creates only new arrays/objects for its return value
 * - No input object is ever modified via setter, delete, or push
 *
 * Downstream consumers (e.g., the routing or skeleton stage) use these
 * pending actions to perform the actual geometric adjustment.
 */
export const resolveLocalCollisions = (
  input: CollisionInput,
  policy: CollisionPolicy = DEFAULT_COLLISION_POLICY,
): LocalRepairResult => {
  const engine = new DeterministicCollisionEngine();
  const index = engine.index(input);
  const pendingActions: LocalRepairAction[] = [];
  const unresolvedCollisions: CollisionRecord[] = [];
  const maxIterations = policy.maximumRepairIterations;
  let iterationCount = 0;

  // Test every non-trunk branch against the index, respecting max iterations
  for (const entry of index.entries) {
    if (iterationCount >= maxIterations) {
      // Record remaining untested branches as unresolved if they have collisions
      // (we can't know without testing, but we respect the iteration limit)
      break;
    }

    const result = engine.testCandidate(entry.branchId, index, input, policy);
    iterationCount += 1;

    if (!result.valid) {
      for (const collision of result.collisions) {
        const resolutionScope = mapSeverityToScope(collision);

        pendingActions.push({
          branchId: collision.branchIdA,
          collisionClass: collision.collisionClass,
          resolutionScope,
          clearanceDeficit: collision.clearanceDeficit,
        });

        // If the other branch is also in the index, add a reciprocal action
        if (collision.branchIdB !== null && collision.branchIdB !== collision.branchIdA) {
          const otherEntry = index.branchIdMap.get(collision.branchIdB);
          if (otherEntry) {
            pendingActions.push({
              branchId: collision.branchIdB,
              collisionClass: collision.collisionClass,
              resolutionScope,
              clearanceDeficit: collision.clearanceDeficit,
            });
          }
        }

        unresolvedCollisions.push(collision);
      }
    }
  }

  // Deduplicate pending actions by branchId
  const uniqueActions = deduplicateActions(pendingActions);

  // Sort deterministically by branchId
  uniqueActions.sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

  return {
    hasCollisions: unresolvedCollisions.length > 0,
    pendingActions: Object.freeze(uniqueActions),
    unresolvedCollisions: Object.freeze(unresolvedCollisions),
  };
};

/**
 * Run exact final validation and return the full validation report.
 * Useful for gate checking (Gate 3 — Geometry: zero forbidden crossings).
 */
export const validateCollisionSafety = (
  input: CollisionInput,
  policy: CollisionPolicy = DEFAULT_COLLISION_POLICY,
): CollisionValidationReport => {
  const engine = new DeterministicCollisionEngine();
  return engine.validateLayout(input, policy);
};

/**
 * Map collision severity to recommended resolution scope.
 * Per the preferred order in LNGP-R3-05 §6.
 */
const mapSeverityToScope = (collision: CollisionRecord): ResolutionScope => {
  if (collision.collisionClass === "BRANCH_BOUNDARY") return "SHIFT_JUNCTION";
  if (collision.collisionClass === "SELF_INTERSECTION") return "BEND_PATH";
  if (collision.severity === "PENETRATION") return "BEND_PATH";
  if (collision.clearanceDeficit > collision.requiredClearance * 0.5) return "BEND_PATH";
  return "LOCAL_RELAXATION";
};

/**
 * Deduplicate pending actions, keeping the highest severity action for each branch.
 */
const deduplicateActions = (actions: LocalRepairAction[]): LocalRepairAction[] => {
  const severityRank: Record<string, number> = {
    REGIONAL_RESOLVE: 7,
    LOCAL_RELAXATION: 6,
    MOVE_LABEL: 5,
    ADJUST_TERRITORY: 4,
    SHIFT_JUNCTION: 3,
    BEND_PATH: 2,
    REJECT_CANDIDATE: 1,
  };

  const bestByBranch = new Map<string, LocalRepairAction>();

  for (const action of actions) {
    const existing = bestByBranch.get(action.branchId);
    if (!existing || (severityRank[action.resolutionScope] ?? 0) > (severityRank[existing.resolutionScope] ?? 0)) {
      bestByBranch.set(action.branchId, action);
    }
  }

  return [...bestByBranch.values()];
};
