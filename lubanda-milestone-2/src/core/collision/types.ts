import type { CollisionConfig } from "../config/types.js";
import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { SkeletonBranch, SkeletonPlan } from "../skeleton/types.js";
import type { RoutingPlan, RoutingRecord } from "../routing/types.js";
import type { Vec2 } from "../geometry/types.js";

// ── Collision input ───────────────────────────────────────────────────

/**
 * Collision detection and resolution consumes the existing RoutingPlan
 * (with corridor polygons, branch radii, safety margins, obstacle data)
 * rather than rebuilding collision envelopes from scratch.
 */
export interface CollisionInput {
  readonly skeletonPlan: SkeletonPlan;
  readonly skeletonBranchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>;
  readonly routingPlan: RoutingPlan;
  readonly routingRecordMap: ReadonlyMap<SkeletonBranchId, RoutingRecord>;
  readonly configuration: CollisionConfig;
}

// ── Collision class ───────────────────────────────────────────────────

export type CollisionClass =
  | "BRANCH_BRANCH"
  | "BRANCH_LABEL"
  | "LABEL_LABEL"
  | "BRANCH_BOUNDARY"
  | "LABEL_BOUNDARY"
  | "BRANCH_DECORATION"
  | "SELF_INTERSECTION";

// ── Collision record ──────────────────────────────────────────────────

export type CollisionSeverity = "CLEARANCE_DEFICIT" | "PENETRATION" | "OVERLAP";

export type ResolutionScope =
  | "REJECT_CANDIDATE"
  | "BEND_PATH"
  | "SHIFT_JUNCTION"
  | "ADJUST_TERRITORY"
  | "MOVE_LABEL"
  | "LOCAL_RELAXATION"
  | "REGIONAL_RESOLVE";

export interface CollisionRecord {
  readonly branchIdA: SkeletonBranchId;
  readonly branchIdB: SkeletonBranchId | null; // null for self-intersection or boundary
  readonly collisionClass: CollisionClass;
  readonly closestPointA: Vec2;
  readonly closestPointB: Vec2;
  readonly measuredDistance: number;
  readonly requiredClearance: number;
  readonly clearanceDeficit: number; // positive when measured < required
  readonly severity: CollisionSeverity;
  readonly recommendedResolution: ResolutionScope;
}

// ── Collision test result ─────────────────────────────────────────────

export type CollisionTestResult =
  | { readonly valid: true; readonly minimumClearance: number }
  | { readonly valid: false; readonly collisions: readonly CollisionRecord[] };

// ── Collision index entry ─────────────────────────────────────────────

export interface CollisionIndexEntry {
  readonly branchId: SkeletonBranchId;
  readonly routingRecord: RoutingRecord;
  readonly envelopeBounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly envelopeRadius: number;
  readonly sampledCurve: readonly Vec2[];
}

// ── Collision index ───────────────────────────────────────────────────

export interface CollisionIndex {
  readonly entries: readonly CollisionIndexEntry[];
  readonly branchIdMap: ReadonlyMap<SkeletonBranchId, CollisionIndexEntry>;
  readonly query: (bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }) => readonly CollisionIndexEntry[];
}

// ── Collision policy ──────────────────────────────────────────────────

export interface CollisionPolicy {
  readonly checkBranchBoundary: boolean;
  readonly checkSelfCollision: boolean;
  readonly checkBranchBranch: boolean;
  readonly finalValidationTolerance: number; // stricter sampling tolerance for final validation
  readonly adjacentJunctionRadius: number; // exemption zone for parent-child junctions
  readonly selfCollisionMinimumLength: number; // curve length threshold for self-collision testing
}

// ── Collision validation report ───────────────────────────────────────

export interface CollisionValidationMetrics {
  readonly branchCount: number;
  readonly testedPairCount: number;
  readonly collisionCount: number;
  readonly clearanceDeficitCount: number;
  readonly penetrationCount: number;
  readonly boundaryViolationCount: number;
  readonly selfIntersectionCount: number;
  readonly minimumClearance: number;
  readonly maximumClearanceDeficit: number;
}

export interface CollisionValidationReport {
  readonly accepted: boolean;
  readonly collisions: readonly CollisionRecord[];
  readonly metrics: CollisionValidationMetrics;
}

// ── Local repair result ───────────────────────────────────────────────

export interface LocalRepairAction {
  readonly branchId: SkeletonBranchId;
  readonly collisionClass: CollisionClass;
  readonly resolutionScope: ResolutionScope;
  readonly clearanceDeficit: number;
}

export interface LocalRepairResult {
  readonly hasCollisions: boolean;
  readonly pendingActions: readonly LocalRepairAction[];
  readonly unresolvedCollisions: readonly CollisionRecord[];
}

// ── Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_COLLISION_POLICY: CollisionPolicy = Object.freeze({
  checkBranchBoundary: true,
  checkSelfCollision: true,
  checkBranchBranch: true,
  finalValidationTolerance: 2,
  adjacentJunctionRadius: 24,
  selfCollisionMinimumLength: 120,
});
