import type { LabelConfig } from "../config/types.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type { SkeletonPlan } from "../skeleton/types.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type { DiagnosticCollector } from "../diagnostics/DiagnosticCollector.js";

// ── Text measurement ──────────────────────────────────────────────────

export type TextDirection = "LTR" | "RTL";

export interface TextMeasureRequest {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number; // 400 = normal, 700 = bold
  readonly letterSpacing: number; // em units, 0 = normal
  readonly direction: TextDirection;
  readonly maximumWidth: number; // 0 = unlimited
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

export interface LabelCandidate {
  readonly personId: PersonId;
  readonly bounds: Bounds;
  readonly anchor: Vec2;
  readonly rotation: number;
  readonly leaderLength: number;
  readonly family: LabelCandidateFamily;
  readonly score: number | null;
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

// ── Font configuration (used by measurement service) ──────────────────

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
