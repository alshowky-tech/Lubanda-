import type { CoreStage } from "./solve-stage.js";

export const ISSUE_SEVERITIES = ["FATAL", "ERROR", "WARNING", "INFO"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const DATA_ISSUE_CODES = [
  "EMPTY_FILE",
  "MISSING_COLUMN",
  "EMPTY_ID",
  "EMPTY_NAME",
  "DUPLICATE_ID",
  "SELF_PARENT",
  "MISSING_PARENT",
  "NO_ROOT",
  "MULTIPLE_ROOTS",
  "CYCLE",
  "GENERATION_MISMATCH",
  "UNREACHABLE_PERSON",
  "MALFORMED_VALUE",
] as const;

export type DataIssueCode = (typeof DATA_ISSUE_CODES)[number];

export const TERRITORY_ISSUE_CODES = [
  "DEMAND_CONFIG_INVALID",
  "TEMPLATE_INVALID",
  "TERRITORY_MISSING",
  "TERRITORY_INVALID_GEOMETRY",
  "TERRITORY_OUT_OF_BOUNDS",
  "TERRITORY_AREA_INSUFFICIENT",
  "TERRITORY_OVERLAP",
  "TERRITORY_OWNERSHIP_CONFLICT",
  "TERRITORY_RELATION_INVALID",
  "CORRIDOR_INVALID",
  "CORRIDOR_TOO_NARROW",
  "CORRIDOR_OUT_OF_BOUNDS",
  "JUNCTION_RESERVATION_VIOLATION",
  "TERRITORY_NEGOTIATION_FAILED",
  "TERRITORY_NON_DETERMINISTIC",
  "NON_SERIALIZABLE_RESULT",
] as const;

export type TerritoryIssueCode = (typeof TERRITORY_ISSUE_CODES)[number];

export const SKELETON_ISSUE_CODES = [
  "SKELETON_TRUNK_INVALID",
  "SKELETON_JUNCTION_INVALID",
  "SKELETON_BRANCH_INVALID",
  "SKELETON_BRANCH_OUT_OF_BOUNDS",
  "SKELETON_BRANCH_EXCESSIVE_CURVATURE",
  "SKELETON_BRANCH_TOO_SHORT",
  "SKELETON_BRANCH_INTERSECTION",
  "SKELETON_NO_VALID_CANDIDATE",
  "SKELETON_MISSING_PERSON",
  "SKELETON_ORPHAN_BRANCH",
  "SKELETON_TERRITORY_MISS",
  "SKELETON_TREE_INCOMPLETE",
] as const;

export type SkeletonIssueCode = (typeof SKELETON_ISSUE_CODES)[number];

export const COLLISION_ISSUE_CODES = [
  "COLLISION_BRANCH_BRANCH",
  "COLLISION_BRANCH_BOUNDARY",
  "COLLISION_SELF_INTERSECTION",
  "COLLISION_CLEARANCE_DEFICIT",
  "COLLISION_PENETRATION",
  "COLLISION_RESOLUTION_FAILED",
  "COLLISION_NON_DETERMINISTIC",
] as const;

export type CollisionIssueCode = (typeof COLLISION_ISSUE_CODES)[number];

export const LABEL_ISSUE_CODES = [
  "LABEL_MEASUREMENT_FAILED",
  "LABEL_FONT_MISSING",
  "LABEL_FONT_LOAD_FAILED",
  "LABEL_NO_CANDIDATES",
  "LABEL_ALL_CANDIDATES_COLLIDE",
  "LABEL_BACKTRACK_EXHAUSTED",
  "LABEL_PLACEMENT_IMPOSSIBLE",
  "LABEL_OVERLAP_DETECTED",
  "LABEL_TEXT_TOO_LONG",
  "LABEL_INVALID_PERSON_REFERENCE",
  "LABEL_NON_DETERMINISTIC",
] as const;

export type LabelIssueCode = (typeof LABEL_ISSUE_CODES)[number];

export const ENGINE_ISSUE_CODES = [
  ...DATA_ISSUE_CODES,
  ...TERRITORY_ISSUE_CODES,
  ...SKELETON_ISSUE_CODES,
  ...COLLISION_ISSUE_CODES,
  ...LABEL_ISSUE_CODES,
] as const;
export type EngineIssueCode = (typeof ENGINE_ISSUE_CODES)[number];

export interface EngineIssue {
  readonly code: EngineIssueCode;
  readonly severity: IssueSeverity;
  readonly messageKey: string;
  readonly stage: CoreStage;
  readonly entityIds?: readonly string[];
  readonly field?: string;
  readonly rowNumber?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly recoverable: boolean;
}

export const isBlockingIssue = (issue: EngineIssue): boolean =>
  issue.severity === "FATAL" || issue.severity === "ERROR";
