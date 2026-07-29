import type { TerritoryConfig } from "../config/types.js";
import type {
  CorridorId,
  EngineIssue,
  PersonId,
  TerritoryId,
  TerritoryPlanId,
} from "../contracts/index.js";
import type { StageResult } from "../contracts/stage-result.js";
import type { DemandPlan } from "../demand/types.js";
import type { DiagnosticCollector } from "../diagnostics/DiagnosticCollector.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { Bounds, Polygon, Vec2 } from "../geometry/types.js";

export interface ArchBoundaryParameters {
  readonly centerX: number;
  readonly baselineY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rootZoneDepth: number;
}

export type TemplateBoundary =
  | { readonly kind: "POLYGON"; readonly polygon: Polygon }
  | {
      readonly kind: "ELLIPSE";
      readonly center: Vec2;
      readonly radiusX: number;
      readonly radiusY: number;
    }
  | { readonly kind: "ARCH"; readonly parameters: ArchBoundaryParameters };

export interface RootEntryReservation {
  readonly id: "root-entry";
  readonly ownerRootId: PersonId;
  readonly polygon: Polygon;
  readonly center: Vec2;
  readonly width: number;
  readonly depth: number;
  readonly boundaryMargin: number;
}

export interface ReservedJunctionZone {
  readonly id: string;
  readonly ownerLineageRootId: PersonId;
  readonly center: Vec2;
  readonly radius: number;
  readonly polygon: Polygon;
}

export interface ClearanceEnvelope {
  readonly inset: number;
  readonly polygon: Polygon;
}

export interface Territory {
  readonly id: TerritoryId;
  readonly ownerLineageRootId: PersonId;
  readonly parentTerritoryId: TerritoryId | null;
  readonly parentOwnerId: PersonId;
  readonly polygon: Polygon;
  readonly centroid: Vec2;
  readonly area: number;
  readonly requiredArea: number;
  readonly allocatedShare: number;
  readonly demandShare: number;
  readonly boundaryMargin: number;
  readonly clearanceEnvelope: ClearanceEnvelope;
  readonly junctionZoneId: string;
  readonly entryCorridorId: CorridorId;
  readonly childTerritoryIds: readonly TerritoryId[];
  readonly fragmentCount: 1;
}

export interface GrowthCorridor {
  readonly id: CorridorId;
  readonly ownerLineageRootId: PersonId;
  readonly fromReservationId: "root-entry";
  readonly toTerritoryId: TerritoryId;
  readonly viaJunctionZoneId: string;
  readonly entryPoint: Vec2;
  readonly exitPoint: Vec2;
  readonly centerline: readonly Vec2[];
  readonly width: number;
  readonly usableLength: number;
  readonly clearance: number;
  readonly reservationMode: "EASEMENT";
}

export type TerritoryRejectionReason =
  | "INSUFFICIENT_TEMPLATE_AREA"
  | "INVALID_TEMPLATE"
  | "EMPTY_POWER_CELL"
  | "MINIMUM_AREA_UNSATISFIED"
  | "CORRIDOR_IMPOSSIBLE"
  | "NEGOTIATION_DID_NOT_CONVERGE"
  | "INVALID_POLYGON"
  | "DISCONNECTED_REGION";

export interface AllocationDiagnostic {
  readonly sequence: number;
  readonly stage:
    | "INITIAL_ALLOCATION"
    | "CORRIDOR_PLANNING"
    | "NEGOTIATION"
    | "VALIDATION";
  readonly code: string;
  readonly territoryId?: TerritoryId;
  readonly ownerLineageRootId?: PersonId;
  readonly metrics: Readonly<Record<string, number>>;
  readonly rejectionReason?: TerritoryRejectionReason;
}

export interface TerritoryBoundaryMovement {
  readonly iteration: number;
  readonly territoryId: TerritoryId;
  readonly before: Polygon;
  readonly after: Polygon;
  readonly areaBefore: number;
  readonly areaAfter: number;
  readonly transferredArea: number;
}

export interface TerritoryNegotiationState {
  readonly status: "NOT_REQUIRED" | "CONVERGED" | "FAILED";
  readonly iterations: number;
  readonly maximumIterations: number;
  readonly finalMaximumAreaErrorRatio: number;
  readonly movements: readonly TerritoryBoundaryMovement[];
  readonly convergenceReason:
    | "INITIAL_PLAN_VALID"
    | "AREA_TARGET_REACHED"
    | "ITERATION_LIMIT"
    | "IMPOSSIBLE_CONSTRAINT";
}

export interface TerritoryValidationReport {
  readonly accepted: boolean;
  readonly issues: readonly EngineIssue[];
  readonly metrics: {
    readonly includedMajorLineageCount: number;
    readonly territoryCount: number;
    readonly corridorCount: number;
    readonly invalidPolygonCount: number;
    readonly overlapCount: number;
    readonly missingOwnershipCount: number;
    readonly invalidCorridorCount: number;
    readonly minimumAreaDeficitCount: number;
    readonly totalAllocatedArea: number;
    readonly templateArea: number;
  };
}

export interface TerritoryPlan {
  readonly schemaVersion: "1.0";
  readonly engineVersion: "0.2.0";
  readonly territoryPlanId: TerritoryPlanId;
  readonly status: "ACCEPTED" | "REJECTED";
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly seed: number;
  readonly templateBoundary: TemplateBoundary;
  readonly templatePolygon: Polygon;
  readonly usableBounds: Bounds;
  readonly rootEntryReservation: RootEntryReservation;
  readonly territories: readonly Territory[];
  readonly junctionZones: readonly ReservedJunctionZone[];
  readonly corridors: readonly GrowthCorridor[];
  readonly negotiation: TerritoryNegotiationState;
  readonly diagnostics: readonly AllocationDiagnostic[];
  readonly validation: TerritoryValidationReport;
  readonly configurationUsed: TerritoryConfig;
  readonly demandFingerprint: string;
  readonly deterministicFingerprint: string;
}

export interface TerritoryPlanningInput {
  readonly graph: GenealogyGraph;
  readonly demandPlan: DemandPlan;
  readonly selectedRootId: PersonId;
  readonly sourceChecksum: string;
  readonly templateBoundary: TemplateBoundary;
  readonly configuration: TerritoryConfig;
  readonly seed: number;
  readonly diagnostics?: DiagnosticCollector;
}

export interface TerritoryPlanner {
  plan(input: TerritoryPlanningInput): Promise<StageResult<TerritoryPlan>>;
}
