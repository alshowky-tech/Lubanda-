import type { EngineConfiguration } from "../config/types.js";
import type { PersonId, SkeletonBranchId } from "../contracts/identifiers.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { Bounds, Polygon, Vec2 } from "../geometry/types.js";
import type { SkeletonPlan } from "../skeleton/types.js";

export type LabelCandidateId = string;
export type LabelPlacementId = string;

export interface LabelCandidate {
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly sourceBranchId?: SkeletonBranchId;
  readonly anchor: Vec2;
  readonly bounds: Bounds;
  readonly rotationDegrees: number;
  readonly fontSize: number;
  readonly score: number;
  readonly ordinal: number;
}

export interface LabelPlacement {
  readonly placementId: LabelPlacementId;
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly anchor: Vec2;
  readonly bounds: Bounds;
  readonly rotationDegrees: number;
  readonly fontSize: number;
  readonly score: number;
}

export interface LabelObstacle {
  readonly obstacleId: string;
  readonly bounds: Bounds;
  readonly kind: "WOOD" | "LABEL" | "RESERVED";
}

export interface LabelCollision {
  readonly id: string;
  readonly kind: LabelObstacle["kind"];
  readonly bounds: Bounds;
}

export interface LabelAssignmentInput {
  readonly candidates: readonly LabelCandidate[];
  readonly fixedPlacements?: readonly LabelPlacement[];
  readonly obstacles?: readonly LabelObstacle[];
  readonly clearance?: number;
  readonly cellSize?: number;
}

export interface RejectedLabelCandidate {
  readonly candidateId: LabelCandidateId;
  readonly personId: PersonId;
  readonly reason:
    | "COLLISION"
    | "OUT_OF_BOUNDS"
    | "DUPLICATE_CANDIDATE_ID"
    | "PERSON_ALREADY_ASSIGNED";
  readonly collisionIds: readonly string[];
}

export interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];
  readonly rejected: readonly RejectedLabelCandidate[];
  readonly unassignedPersonIds: readonly PersonId[];
}

export interface LabelCandidateGenerationResult {
  readonly candidates: readonly LabelCandidate[];
  readonly rejected: readonly RejectedLabelCandidate[];
}

export interface LabelLayoutInput {
  readonly graph: GenealogyGraph;
  readonly skeletonPlan: SkeletonPlan;
  readonly templatePolygon: Polygon;
  readonly configuration: EngineConfiguration;
}

export interface LabelLayoutDiagnostic {
  readonly code: "LABEL_UNRESOLVED";
  readonly severity: "WARNING";
  readonly personId: PersonId;
  readonly candidateCount: number;
  readonly rejectedCandidateCount: number;
  readonly collisionIds: readonly string[];
}

export interface LabelLayoutMetrics {
  readonly requestedPersonCount: number;
  readonly candidateCount: number;
  readonly placedLabelCount: number;
  readonly unresolvedLabelCount: number;
  readonly woodObstacleCount: number;
  readonly boundaryRejectedCandidateCount: number;
  readonly collisionRejectedCandidateCount: number;
}

export interface LabelLayoutResult {
  readonly status: "ACCEPTED" | "PARTIAL";
  readonly placements: readonly LabelPlacement[];
  readonly candidates: readonly LabelCandidate[];
  readonly rejected: readonly RejectedLabelCandidate[];
  readonly unresolvedPersonIds: readonly PersonId[];
  readonly diagnostics: readonly LabelLayoutDiagnostic[];
  readonly metrics: LabelLayoutMetrics;
}
