import type { SkeletonConfig } from "../config/types.js";
import type {
  CorridorId,
  PersonId,
  SkeletonBranchId,
  SkeletonPlanId,
  TerritoryId,
} from "../contracts/identifiers.js";
import type { EngineIssue } from "../contracts/issues.js";
import type { DemandPlan } from "../demand/types.js";
import type { DiagnosticCollector } from "../diagnostics/DiagnosticCollector.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { Person } from "../genealogy/types.js";
import type { Bounds, CubicBezier, Polygon, Vec2 } from "../geometry/types.js";
import type { TerritoryPlan } from "../territory/types.js";

export type SkeletonNodeKind =
  | "TRUNK_BASE"
  | "TRUNK_JUNCTION"
  | "BRANCH_SPLIT"
  | "BRANCH_TERMINAL"
  | "TRUNK_TERMINAL";

export interface SkeletonNode {
  readonly id: string;
  readonly point: Vec2;
  readonly kind: SkeletonNodeKind;
  readonly incomingBranchId: SkeletonBranchId | null;
  readonly outgoingBranchIds: readonly SkeletonBranchId[];
  readonly ownerLineageRootId: PersonId;
}

export interface BranchThicknessParameters {
  readonly baseThickness: number;
  readonly tipThickness: number;
  readonly taperRatio: number;
}

export type BranchRejectionReason =
  | "OUT_OF_BOUNDS"
  | "EXCESSIVE_CURVATURE"
  | "TOO_SHORT"
  | "BRANCH_INTERSECTION"
  | "TERRITORY_BOUNDARY_CROSSED"
  | "CANDIDATE_DEGENERATE"
  | "NO_VALID_CANDIDATE"
  | "JUNCTION_OUT_OF_BOUNDS";

export interface CandidateRejectionRecord {
  readonly candidateIndex: number;
  readonly reason: BranchRejectionReason;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SkeletonBranch {
  readonly id: SkeletonBranchId;
  readonly ownerPersonId: PersonId;
  readonly parentBranchId: SkeletonBranchId | null;
  readonly generation: number;
  readonly genealogyDepth: number;
  readonly territoryId: TerritoryId | null;
  readonly curve: CubicBezier;
  readonly startPoint: Vec2;
  readonly endPoint: Vec2;
  readonly length: number;
  readonly thickness: BranchThicknessParameters;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly childrenBranchIds: readonly SkeletonBranchId[];
  readonly candidateScore: number | null;
  readonly rejectionHistory: readonly CandidateRejectionRecord[];
  readonly metadata: Readonly<{
    readonly branchIndex: number;
    readonly lineageRootId: PersonId;
    readonly person: Person;
  }>;
}

export interface TrunkSkeleton {
  readonly baseNodeId: string;
  readonly terminalNodeId: string;
  readonly segments: readonly SkeletonBranchId[];
  readonly length: number;
  readonly centroid: Vec2;
}

export interface MappedJunction {
  readonly junctionZoneId: string;
  readonly trunkNodeId: string;
  readonly lineageRootId: PersonId;
  readonly trunkPoint: Vec2;
  readonly corridorId: CorridorId;
}

export type SkeletonDiagnosticStage =
  | "TRUNK_PLANNING"
  | "JUNCTION_PLANNING"
  | "CANDIDATE_GENERATION"
  | "CANDIDATE_SCORING"
  | "RECURSIVE_GROWTH"
  | "SKELETON_VALIDATION";

export interface SkeletonDiagnostic {
  readonly sequence: number;
  readonly stage: SkeletonDiagnosticStage;
  readonly code: string;
  readonly branchId?: SkeletonBranchId;
  readonly ownerPersonId?: PersonId;
  readonly metrics: Readonly<Record<string, number>>;
  readonly rejectionReason?: BranchRejectionReason;
  readonly candidateAttempts?: number;
  readonly acceptedCandidateIndex?: number;
}

export interface SkeletonValidationMetrics {
  readonly branchCount: number;
  readonly nodeCount: number;
  readonly trunkSegmentCount: number;
  readonly junctionCount: number;
  readonly invalidBranchCount: number;
  readonly missingPersonBranchCount: number;
  readonly orphanBranchCount: number;
  readonly territoryMissCount: number;
  readonly outOfBoundsCount: number;
  readonly intersectionCount: number;
  readonly totalCurveLength: number;
  readonly maxDepth: number;
  readonly acceptedPersonCount: number;
  readonly connectedPersonCount: number;
}

export interface SkeletonValidationReport {
  readonly accepted: boolean;
  readonly issues: readonly EngineIssue[];
  readonly metrics: SkeletonValidationMetrics;
}

export interface SkeletonPlan {
  readonly schemaVersion: "1.0";
  readonly engineVersion: "0.2.0";
  readonly skeletonPlanId: SkeletonPlanId;
  readonly status: "ACCEPTED" | "REJECTED";
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly seed: number;
  readonly territoryPlanFingerprint: string;
  readonly trunk: TrunkSkeleton;
  readonly branches: readonly SkeletonBranch[];
  readonly nodes: readonly SkeletonNode[];
  readonly mappedJunctions: readonly MappedJunction[];
  readonly diagnostics: readonly SkeletonDiagnostic[];
  readonly validation: SkeletonValidationReport;
  readonly configurationUsed: SkeletonConfig;
  readonly metadata: Readonly<{
    readonly algorithm: "RECURSIVE_ORGANIC_GROWTH";
    readonly branchCount: number;
    readonly nodeCount: number;
    readonly maximumGenealogyDepth: number;
    readonly maximumSkeletonDepth: number;
    readonly totalInvalidCandidateCount: number;
    readonly totalRejectedCandidateCount: number;
  }>;
  readonly deterministicFingerprint: string;
}

export interface SkeletonGrowthInput {
  readonly graph: GenealogyGraph;
  readonly demandPlan: DemandPlan;
  readonly territoryPlan: TerritoryPlan;
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly configuration: SkeletonConfig;
  readonly seed: number;
  readonly diagnostics?: DiagnosticCollector;
}

export interface AttractorPoint {
  readonly point: Vec2;
  readonly strength: number;
  readonly falloff: number;
}

export interface AttractorField {
  readonly attractors: readonly AttractorPoint[];
  readonly repulsors: readonly AttractorPoint[];
}

export interface BranchCandidate {
  readonly index: number;
  readonly curve: CubicBezier;
  readonly startPoint: Vec2;
  readonly endPoint: Vec2;
  readonly length: number;
  readonly maxCurvature: number;
  readonly score: number | null;
  readonly valid: boolean;
  readonly rejectionReasons: readonly BranchRejectionReason[];
}

export interface CurveRecord {
  readonly branchId: string;
  readonly samples: readonly Vec2[];
}

export interface CandidateGenerationInput {
  readonly startPoint: Vec2;
  readonly endPoint: Vec2;
  readonly startDirection: Vec2 | null;
  readonly ownerPersonId: PersonId;
  readonly territoryPolygon: Polygon | null;
  readonly templatePolygon: Polygon;
  readonly attractors: AttractorField;
  readonly config: SkeletonConfig;
  readonly seed: number;
  readonly existingBranchBounds: readonly Bounds[];
  readonly existingBranchCurves: readonly CurveRecord[];
  readonly excludeParentBranchId: string | null;  // exact parent branchId to exclude from collision
  readonly relaxedTerritoryCheck: boolean;
  readonly candidateCount: number;
  readonly genealogyDepth: number;
  readonly roundingDecimalPlaces: number;
}

export interface SkeletonGrowthEngine {
  grow(input: SkeletonGrowthInput): Promise<SkeletonPlan>;
}
