export const MILESTONE_1_STAGES = [
  "ACQUIRE",
  "NORMALIZE",
  "VALIDATE",
  "BUILD_GRAPH",
  "CONFIGURATION",
] as const;

export type Milestone1Stage = (typeof MILESTONE_1_STAGES)[number];

export const MILESTONE_2_STAGES = [
  "COMPUTE_DEMAND",
  "ALLOCATE_TERRITORIES",
  "PLAN_CORRIDORS",
  "NEGOTIATE_TERRITORIES",
  "VALIDATE_TERRITORIES",
  "SERIALIZE_TERRITORIES",
] as const;

export type Milestone2Stage = (typeof MILESTONE_2_STAGES)[number];

export const MILESTONE_3_STAGES = [
  "PLAN_TRUNK",
  "PLAN_JUNCTIONS",
  "GROW_SKELETON",
  "GENERATE_CANDIDATES",
  "REJECT_CANDIDATES",
  "SCORE_CANDIDATES",
  "VALIDATE_SKELETON",
  "FREEZE_SKELETON",
] as const;

export type Milestone3Stage = (typeof MILESTONE_3_STAGES)[number];

export const MILESTONE_4_2_STAGES = [
  "BUILD_COLLISION_INDEX",
  "TEST_BRANCH_COLLISIONS",
  "TEST_SELF_COLLISION",
  "TEST_BOUNDARY_CONTAINMENT",
  "RESOLVE_LOCAL_COLLISIONS",
  "VALIDATE_COLLISION_SAFETY",
] as const;

export type Milestone42Stage = (typeof MILESTONE_4_2_STAGES)[number];

export const MILESTONE_7_STAGES = [
  "MEASURE_TEXT",
  "GENERATE_CANDIDATES",
  "SCORE_CANDIDATES",
  "SOLVE_LABELS",
  "VALIDATE_LABELS",
] as const;

export type Milestone7Stage = (typeof MILESTONE_7_STAGES)[number];

export type CoreStage = Milestone1Stage | Milestone2Stage | Milestone3Stage | Milestone42Stage | Milestone7Stage;
