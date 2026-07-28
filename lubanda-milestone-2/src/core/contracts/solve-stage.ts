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

export type CoreStage = Milestone1Stage | Milestone2Stage | Milestone3Stage;
