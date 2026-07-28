import type {
  PersonId,
  SkeletonBranchId,
  TerritoryId,
} from "../contracts/identifiers.js";
import type { SkeletonPlan, SkeletonBranch } from "../skeleton/types.js";
import type { Polygon, Vec2 } from "../geometry/types.js";

// ── Routing status ────────────────────────────────────────────────────

export type RoutingRecordStatus =
  | "ROUTABLE"
  | "TERMINAL"
  | "BLOCKED";

// ── Routing record ────────────────────────────────────────────────────

export interface RoutingRecord {
  readonly branchId: SkeletonBranchId;
  readonly parentBranchId: SkeletonBranchId | null;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly ownerPersonId: PersonId;
  readonly territoryId: TerritoryId | null;
  readonly generation: number;
  readonly genealogyDepth: number;
  readonly preferredDirection: Vec2;
  readonly maximumBendAngle: number;
  readonly branchRadius: number;
  readonly safetyMargin: number;
  readonly requiredClearance: number;
  readonly routingPriority: number;
  readonly corridorPolygon: Polygon;
  readonly obstacleBranchIds: readonly SkeletonBranchId[];
  readonly status: RoutingRecordStatus;
  readonly diagnostics: readonly RoutingDiagnostic[];
}

// ── Routing plan ──────────────────────────────────────────────────────

export interface RoutingPlan {
  readonly schemaVersion: "1.0";
  readonly engineVersion: "0.2.0";
  readonly skeletonPlanFingerprint: string;
  readonly records: readonly RoutingRecord[];
  readonly metadata: Readonly<{
    readonly algorithm: "GLOBAL_ROUTING_FOUNDATION";
    readonly recordCount: number;
    readonly maximumGeneration: number;
  }>;
  readonly deterministicFingerprint: string;
}

// ── Input ─────────────────────────────────────────────────────────────

export interface RoutingInput {
  readonly skeletonPlan: SkeletonPlan;
  readonly skeletonBranchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>;
  readonly territoryPolygons: ReadonlyMap<string, Polygon>;
}

// ── Diagnostics ───────────────────────────────────────────────────────

export type RoutingDiagnosticStage =
  | "ROUTING_PLAN_CREATION"
  | "PRIORITY_ASSIGNMENT"
  | "CORRIDOR_CREATION"
  | "OBSTACLE_DISCOVERY"
  | "CLEARANCE_VALIDATION"
  | "ROUTING_VALIDATION";

export type RoutingDiagnosticSeverity = "INFO" | "WARNING" | "ERROR";

export interface RoutingDiagnostic {
  readonly sequence: number;
  readonly branchId?: SkeletonBranchId;
  readonly stage: RoutingDiagnosticStage;
  readonly code: string;
  readonly severity: RoutingDiagnosticSeverity;
  readonly message: string;
  readonly metrics?: Readonly<Record<string, number>>;
  readonly relatedBranchIds?: readonly SkeletonBranchId[];
}

// ── Clearance constants ───────────────────────────────────────────────

export const DEFAULT_MINIMUM_BRANCH_RADIUS = 2;
export const DEFAULT_MAXIMUM_BRANCH_RADIUS = 14;
export const DEFAULT_SAFETY_MARGIN = 4;
export const DEFAULT_MAX_BEND_ANGLE = Math.PI * 0.45;
export const DEFAULT_BRANCH_RADIUS_AT_GENERATION_0 = 10;

// ── Builder contract ──────────────────────────────────────────────────

export interface RoutingPlanBuilder {
  build(input: RoutingInput): Promise<RoutingPlan>;
}
