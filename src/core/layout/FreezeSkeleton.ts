import type {
  SkeletonPlan,
  SkeletonBranch,
  SkeletonNode,
  TrunkSkeleton,
  MappedJunction,
  SkeletonDiagnostic,
  SkeletonValidationReport,
} from "../skeleton/types.js";

/**
 * Deep-freeze a validated skeleton plan into an immutable, serializable DTO.
 * The deterministic fingerprint is already computed by the growth engine;
 * this phase only produces the frozen object graph for downstream consumers.
 */
export const freezeSkeletonPlan = (
  plan: SkeletonPlan,
): SkeletonPlan => Object.freeze({
  schemaVersion: "1.0",
  engineVersion: "0.2.0",
  skeletonPlanId: plan.skeletonPlanId,
  status: plan.status,
  selectedRootId: plan.selectedRootId,
  sourceChecksum: plan.sourceChecksum,
  seed: plan.seed,
  territoryPlanFingerprint: plan.territoryPlanFingerprint,
  trunk: deepFreezeTrunk(plan.trunk),
  branches: Object.freeze(plan.branches.map((b) => deepFreezeBranch(b))),
  nodes: Object.freeze(plan.nodes.map((n) => deepFreezeNode(n))),
  mappedJunctions: Object.freeze(
    plan.mappedJunctions.map((j) => deepFreezeJunction(j)),
  ),
  diagnostics: Object.freeze(
    plan.diagnostics.map((d) => deepFreezeDiagnostic(d)),
  ),
  validation: deepFreezeValidation(plan.validation),
  configurationUsed: Object.freeze({ ...plan.configurationUsed }),
  metadata: Object.freeze({ ...plan.metadata }),
  deterministicFingerprint: plan.deterministicFingerprint,
});

// ── Deep-freeze helpers ───────────────────────────────────────────────

const deepFreezeBranch = (branch: SkeletonBranch): SkeletonBranch =>
  Object.freeze({
    ...branch,
    curve: Object.freeze({
      p0: Object.freeze({ ...branch.curve.p0 }),
      p1: Object.freeze({ ...branch.curve.p1 }),
      p2: Object.freeze({ ...branch.curve.p2 }),
      p3: Object.freeze({ ...branch.curve.p3 }),
    }),
    startPoint: Object.freeze({ ...branch.startPoint }),
    endPoint: Object.freeze({ ...branch.endPoint }),
    thickness: Object.freeze({ ...branch.thickness }),
    childrenBranchIds: Object.freeze([...branch.childrenBranchIds]),
    rejectionHistory: Object.freeze(
      branch.rejectionHistory.map((r) =>
        Object.freeze({
          ...r,
          ...(r.details ? { details: Object.freeze({ ...r.details }) } : {}),
        }),
      ),
    ),
    metadata: Object.freeze({
      ...branch.metadata,
      person: Object.freeze({ ...branch.metadata.person }),
    }),
  });

const deepFreezeNode = (node: SkeletonNode): SkeletonNode =>
  Object.freeze({
    ...node,
    point: Object.freeze({ ...node.point }),
    outgoingBranchIds: Object.freeze([...node.outgoingBranchIds]),
  });

const deepFreezeTrunk = (trunk: TrunkSkeleton): TrunkSkeleton =>
  Object.freeze({
    ...trunk,
    centroid: Object.freeze({ ...trunk.centroid }),
    segments: Object.freeze([...trunk.segments]),
  });

const deepFreezeJunction = (j: MappedJunction): MappedJunction =>
  Object.freeze({
    ...j,
    trunkPoint: Object.freeze({ ...j.trunkPoint }),
  });

const deepFreezeDiagnostic = (d: SkeletonDiagnostic): SkeletonDiagnostic =>
  Object.freeze({
    ...d,
    metrics: Object.freeze({ ...d.metrics }),
  });

const deepFreezeValidation = (v: SkeletonValidationReport): SkeletonValidationReport =>
  Object.freeze({
    ...v,
    issues: Object.freeze([...v.issues]),
    metrics: Object.freeze({ ...v.metrics }),
  });
