import type { LabelConfig } from "../config/types.js";
import type { PersonId, SkeletonBranchId } from "../contracts/identifiers.js";
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
  | "BOUNDARY_CLEARANCE_FAILED"
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
  /** Returns true if candidate bounds overlap the candidate's OWN branch
   *  envelope, EXCLUDING the circular self-anchor attachment zone of
   *  `anchorRadius` around `anchor`. Other branches are never exempt. */
  overlapsFixedBranch(
    candidateBranchId: SkeletonBranchId,
    bounds: Bounds,
    anchor: Vec2,
    anchorRadius: number,
  ): boolean;

  /** Returns true if the candidate bounds overlap an already-placed label. */
  overlapsFixedLabel(
    bounds: Bounds,
    fixedPlacements: readonly LabelPlacement[],
  ): boolean;

  /** Returns true if all four corners of the AABB are within the boundary. */
  isBoundsInsideBoundary(bounds: Bounds): boolean;

  /** Returns true if the point is inside the template boundary. */
  isPointInsideBoundary(point: Vec2): boolean;

  /** Returns true if the segment from a to b crosses any branch envelope. */
  leaderCrossesFixedObstacle(a: Vec2, b: Vec2): boolean;

  /** Minimum distance from point to any branch envelope sampled curve. */
  minClearanceToFixedBranches(point: Vec2): number;

  /** Minimum distance from point to the template boundary polygon edge. */
  boundaryClearance(point: Vec2): number;

  /** Minimum distance from any corner of the AABB to boundary polygon edges.
   *  Returns the smallest corner-to-edge distance. */
  minBoundsBoundaryClearance(bounds: Bounds): number;
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

// ── Scoring configuration ─────────────────────────────────────────────

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

// ── Direction resolver ────────────────────────────────────────────────

/**
 * Resolve base paragraph direction from script content.
 *
 * If the text contains any Arabic/Persian script characters (U+0600–U+08FF),
 * the base direction is RTL. Otherwise it is LTR.
 *
 * This resolves the overall paragraph direction only. Internal mixed-direction
 * runs (e.g., Arabic name containing a Latin ID) are handled by the
 * M7.1 TextMeasurementService which applies bidi processing via BidiProcessor
 * (UAX #9) to correctly order the glyph runs for measurement and rendering.
 *
 * The resolution is deterministic: same text always produces the same direction.
 */
const HAS_ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

export const resolveTextDirection = (text: string): TextDirection =>
  HAS_ARABIC_RE.test(text) ? "RTL" : "LTR";
