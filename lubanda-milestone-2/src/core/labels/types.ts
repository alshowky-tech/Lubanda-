import type { LabelConfig } from "../config/types.js";
import type {
  PersonId,
  SkeletonBranchId,
} from "../contracts/identifiers.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { SkeletonPlan, SkeletonBranch, SkeletonNode } from "../skeleton/types.js";
import type { Bounds, Vec2, Polygon } from "../geometry/types.js";
import type { DiagnosticCollector } from "../diagnostics/DiagnosticCollector.js";

// ── Text measurement ──────────────────────────────────────────────────

export type TextDirection = "LTR" | "RTL";

export interface TextMeasureRequest {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly letterSpacing: number;
  readonly direction: TextDirection;
  readonly maximumWidth: number;
  readonly lineCountPolicy: "NATURAL" | "TRUNCATE" | "CLAMP";
  readonly maximumLines: number;
}

export interface LineBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly text: string;
}

export interface TextMetricsResult {
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly lineBoxes: readonly LineBox[];
  readonly glyphOverflow: boolean;
  readonly lineCount: number;
}

// ── Label candidate ───────────────────────────────────────────────────

export type LabelCandidateFamily =
  | "ALIGNED_WITH_BRANCH"
  | "OFFSET_ABOVE_BRANCH"
  | "OFFSET_BELOW_BRANCH"
  | "LATERAL"
  | "TERMINAL_LEAF"
  | "CARTOUCHE_ZONE";

export type CandidateValidationStatus = "VALID" | "INVALID";

export type CandidateRejectionCode =
  | "BRANCH_PENETRATION"
  | "BOUNDARY_VIOLATION"
  | "INSUFFICIENT_CLEARANCE"
  | "ROTATION_EXCEEDS_LIMIT"
  | "GLYPH_OVERFLOW"
  | "LEADER_CROSSING"
  | "ANCHOR_DISTANCE_EXCEEDED"
  | "NO_BRANCH_FOR_PERSON"
  | "NO_NAME_TEXT"
  | "FINITE_GEOMETRY_FAILURE"
  | "OVERLAPS_FIXED_LABEL"
  | "CARTOUCHE_NO_ZONE";

export interface LabelCandidateRejectionRecord {
  readonly code: CandidateRejectionCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface LabelCandidate {
  readonly personId: PersonId;
  readonly bounds: Bounds;
  readonly anchor: Vec2;
  readonly rotation: number;
  readonly leaderLength: number;
  readonly family: LabelCandidateFamily;
  readonly validationStatus: CandidateValidationStatus;
  readonly rejectionReasons: readonly LabelCandidateRejectionRecord[];
  readonly score: number | null;
  readonly componentScores: Readonly<Record<string, number>> | undefined;
}

// ── Label placement ───────────────────────────────────────────────────

export interface LabelPlacement {
  readonly personId: PersonId;
  readonly bounds: Bounds;
  readonly anchor: Vec2;
  readonly rotation: number;
  readonly leaderLength: number;
  readonly family: LabelCandidateFamily;
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
}

// ── Candidate generation input ────────────────────────────────────────

export interface LabelCandidateGenerationInput {
  readonly skeletonPlan: SkeletonPlan;
  readonly skeletonBranchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>;
  readonly skeletonNodeMap: ReadonlyMap<string, SkeletonNode>;
  readonly graph: GenealogyGraph;
  readonly nameMap: ReadonlyMap<PersonId, string>;
  readonly configuration: LabelConfig;
  readonly collisionQuery: CandidateCollisionQuery;
  readonly templateBoundary: Polygon;
  readonly textMeasurementService: TextMeasurementService;
  readonly cartoucheZones: readonly CartoucheZone[] | undefined;
  readonly fixedLabelPlacements: readonly LabelPlacement[] | undefined;
}

// ── Cartouche zone ────────────────────────────────────────────────────

export interface CartoucheZone {
  readonly zoneId: string;
  readonly polygon: Polygon;
  readonly anchor: Vec2;
  readonly labelAlignment: "CENTER" | "NEAREST";
}

// ── Candidate collision query (read-only abstraction) ─────────────────

export interface CandidateCollisionQuery {
  /** Returns true if bounds overlap any fixed obstacle (branch envelope,
   *  boundary, or already-placed label), excluding the self-anchor region. */
  overlapsFixedObstacle(
    bounds: Bounds,
    excludeAnchor?: Vec2,
    anchorRadius?: number,
  ): boolean;

  /** Returns the minimum distance between a point and any fixed branch
   *  envelope. Used for leader-line validation. */
  minClearanceToFixedBranches(point: Vec2): number;

  /** Returns true if the segment from a to b crosses any branch envelope. */
  leaderCrossesFixedObstacle(a: Vec2, b: Vec2): boolean;

  /** Returns true if the point is inside the template boundary. */
  isInsideBoundary(point: Vec2, margin?: number): boolean;
}

// ── Label layout input ────────────────────────────────────────────────

export interface LabelLayoutInput {
  readonly skeletonPlan: SkeletonPlan;
  readonly graph: GenealogyGraph;
  readonly configuration: LabelConfig;
}

// ── Label layout metrics ──────────────────────────────────────────────

export interface LabelLayoutMetrics {
  readonly totalPersonCount: number;
  readonly placedLabelCount: number;
  readonly unplacedLabelCount: number;
  readonly collisionCount: number;
  readonly minimumFontSize: number;
  readonly maximumRotation: number;
  readonly averageAnchorDistance: number;
  readonly totalOverlapCount: number;
}

// ── Unresolved label reason ───────────────────────────────────────────

export type UnresolvedReasonCode =
  | "NO_CANDIDATES_GENERATED"
  | "ALL_CANDIDATES_COLLIDE"
  | "BACKTRACK_EXHAUSTED"
  | "GEOMETRY_RELAXATION_FAILED"
  | "TEXT_TOO_LONG"
  | "FONT_MISSING"
  | "INVALID_PERSON_REFERENCE";

export interface UnresolvedLabelReason {
  readonly personId: PersonId;
  readonly code: UnresolvedReasonCode;
  readonly message: string;
  readonly candidateCount: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

// ── Label layout result ───────────────────────────────────────────────

export interface LabelLayoutResult {
  readonly accepted: boolean;
  readonly placements: readonly LabelPlacement[];
  readonly unresolvedReasons: readonly UnresolvedLabelReason[];
  readonly metrics: LabelLayoutMetrics;
  readonly deterministicFingerprint: string;
}

// ── Solve context ─────────────────────────────────────────────────────

export interface SolveContext {
  readonly diagnostics?: DiagnosticCollector;
}

// ── Font configuration ────────────────────────────────────────────────

export interface FontDescriptor {
  readonly family: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly path: string;
}

// ── Text measurement service interface ────────────────────────────────

export interface TextMeasurementService {
  measure(request: TextMeasureRequest): Promise<TextMetricsResult>;
}

// ── Typography cache key ──────────────────────────────────────────────

export interface TypographyCacheKey {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly letterSpacing: number;
  readonly direction: TextDirection;
  readonly maximumWidth: number;
  readonly lineCountPolicy: string;
  readonly maximumLines: number;
}

// ── Label diagnostics ─────────────────────────────────────────────────

export type LabelDiagnosticStage =
  | "MEASURE_TEXT"
  | "GENERATE_CANDIDATES"
  | "SCORE_CANDIDATES"
  | "SOLVE_LABELS"
  | "VALIDATE_LABELS";

export interface LabelDiagnostic {
  readonly sequence: number;
  readonly stage: LabelDiagnosticStage;
  readonly personId?: PersonId;
  readonly code: string;
  readonly message: string;
  readonly metrics?: Readonly<Record<string, number>>;
}

// ── Scoring configuration (not authoritative; configurable) ───────────

export interface ScoringWeights {
  readonly obstacleCollision: number;
  readonly anchorDistance: number;
  readonly rotation: number;
  readonly localRhythm: number;
  readonly branchClearance: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = Object.freeze({
  obstacleCollision: 0.35,
  anchorDistance: 0.25,
  rotation: 0.15,
  localRhythm: 0.10,
  branchClearance: 0.15,
});

// ── Generated candidate result ────────────────────────────────────────

export interface GeneratedCandidatesResult {
  readonly allCandidates: readonly LabelCandidate[];
  readonly validCandidates: readonly LabelCandidate[];
  readonly personCandidateMap: ReadonlyMap<PersonId, readonly LabelCandidate[]>;
  readonly totalGeneratablePeople: number;
  readonly diagnostics: readonly LabelDiagnostic[];
}
