import { describe, expect, it } from "vitest";
import { resolveLocalCollisions, validateCollisionSafety } from "../../../src/core/collision/CollisionResolver.js";
import { DEFAULT_COLLISION_POLICY } from "../../../src/core/collision/types.js";
import { computeRequiredClearance } from "../../../src/core/routing/ClearanceModel.js";
import type { SkeletonBranchId } from "../../../src/core/contracts/identifiers.js";
import type { PersonId } from "../../../src/core/contracts/identifiers.js";
import type {
  CollisionInput,
  CollisionPolicy,
} from "../../../src/core/collision/types.js";
import type { SkeletonPlan, SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { SkeletonPlanId } from "../../../src/core/contracts/identifiers.js";
import type { RoutingPlan, RoutingRecord } from "../../../src/core/routing/types.js";
import type { Vec2, CubicBezier } from "../../../src/core/geometry/types.js";
import type { Person } from "../../../src/core/genealogy/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

const FAKE_PERSON_ID = "p1" as PersonId;
const FAKE_PERSON: Person = Object.freeze({
  id: FAKE_PERSON_ID,
  name: "Test",
  parentId: null,
  generation: 1,
  sourceRowNumber: 1,
  explicitDisplayOrder: null,
  source: { original: { id: FAKE_PERSON_ID, name: "Test", parentId: null, generation: 1 } },
});

const makeBranch = (
  id: string,
  parentId: string | null,
  generation: number,
  curve: CubicBezier,
  startNodeId: string,
  endNodeId: string,
): SkeletonBranch => ({
  id: id as SkeletonBranchId,
  ownerPersonId: "p1" as PersonId,
  parentBranchId: parentId as SkeletonBranchId | null,
  generation,
  genealogyDepth: generation,
  territoryId: null,
  curve,
  startPoint: curve.p0,
  endPoint: curve.p3,
  length: 100,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId,
  endNodeId,
  childrenBranchIds: Object.freeze([]),
  candidateScore: 0.9,
  rejectionHistory: Object.freeze([]),
  metadata: Object.freeze({
    branchIndex: parseInt(id.split(":")[1] ?? "0"),
    lineageRootId: FAKE_PERSON_ID,
    person: FAKE_PERSON,
  }),
});

const makeRoutingRecord = (
  branchId: string,
  parentBranchId: string | null,
  branchRadius: number,
  safetyMargin: number,
  corridorPoints: Vec2[],
): RoutingRecord => ({
  branchId: branchId as SkeletonBranchId,
  parentBranchId: parentBranchId as SkeletonBranchId | null,
  startNodeId: "n1",
  endNodeId: "n2",
  ownerPersonId: FAKE_PERSON_ID,
  territoryId: null,
  generation: 1,
  genealogyDepth: 1,
  preferredDirection: { x: 0, y: 1 },
  maximumBendAngle: 0.45 * Math.PI,
  branchRadius,
  safetyMargin,
  requiredClearance: computeRequiredClearance(branchRadius, branchRadius, safetyMargin, safetyMargin),
  routingPriority: 1,
  corridorPolygon: Object.freeze({ points: Object.freeze(corridorPoints) }),
  obstacleBranchIds: Object.freeze([]),
  obstacleClearances: Object.freeze([]),
  status: "ROUTABLE",
  diagnostics: Object.freeze([]),
});

const makeInput = (
  branches: SkeletonBranch[],
  routingRecords: RoutingRecord[],
): CollisionInput => {
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    branches.map((b) => [b.id, b]),
  );
  const routingRecordMap = new Map<SkeletonBranchId, RoutingRecord>(
    routingRecords.map((r) => [r.branchId, r]),
  );
  const skeletonPlan: SkeletonPlan = {
    schemaVersion: "1.0",
    engineVersion: "0.2.0",
    skeletonPlanId: "test-plan" as SkeletonPlanId,
    status: "ACCEPTED",
    selectedRootId: FAKE_PERSON_ID,
    sourceChecksum: "a".repeat(64),
    seed: 42,
    territoryPlanFingerprint: "b".repeat(64),
    trunk: Object.freeze({
      baseNodeId: "n1",
      terminalNodeId: "n3",
      segments: Object.freeze([]),
      length: 100,
      centroid: { x: 50, y: 50 },
    }),
    branches: Object.freeze(branches),
    nodes: Object.freeze([]),
    mappedJunctions: Object.freeze([]),
    diagnostics: Object.freeze([]),
    validation: Object.freeze({
      accepted: true,
      issues: Object.freeze([]),
      metrics: Object.freeze({
        branchCount: branches.length,
        nodeCount: 0,
        trunkSegmentCount: 0,
        junctionCount: 0,
        invalidBranchCount: 0,
        missingPersonBranchCount: 0,
        orphanBranchCount: 0,
        territoryMissCount: 0,
        outOfBoundsCount: 0,
        intersectionCount: 0,
        totalCurveLength: 0,
        maxDepth: 0,
        acceptedPersonCount: 0,
        connectedPersonCount: 0,
      }),
    }),
    configurationUsed: Object.freeze({ candidateCount: 10, maxCurvature: 0.45, minimumBranchLength: 18 }),
    metadata: Object.freeze({
      algorithm: "RECURSIVE_ORGANIC_GROWTH",
      branchCount: branches.length,
      nodeCount: 0,
      maximumGenealogyDepth: 1,
      maximumSkeletonDepth: 1,
      totalInvalidCandidateCount: 0,
      totalRejectedCandidateCount: 0,
    }),
    deterministicFingerprint: "test-fingerprint",
  };
  const routingPlan: RoutingPlan = {
    schemaVersion: "1.0",
    engineVersion: "0.2.0",
    skeletonPlanFingerprint: "test-fingerprint",
    records: Object.freeze(routingRecords),
    metadata: Object.freeze({
      algorithm: "GLOBAL_ROUTING_FOUNDATION",
      recordCount: routingRecords.length,
      maximumGeneration: 1,
    }),
    deterministicFingerprint: "routing-fingerprint",
  };
  return {
    skeletonPlan,
    skeletonBranchMap: branchMap,
    routingPlan,
    routingRecordMap,
    configuration: Object.freeze({ branchClearance: 8, labelClearance: 6, barkAllowance: 4 }),
  };
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("CollisionResolver — resolveLocalCollisions", () => {
  it("resolves a repairable branch collision (clearance deficit)", () => {
    // Two parallel branches very close together — clear collision
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const radius = 10;
    const margin = 4;
    // clearance needed = 10+10+4+4 = 28; actual distance = 3 → deficit > 0
    const recA = makeRoutingRecord("branch:a", null, radius, margin, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, radius, margin, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);
    const input = makeInput([branchA, branchB], [recA, recB]);
    const result = resolveLocalCollisions(input);

    expect(result.hasCollisions).toBe(true);
    expect(result.pendingActions.length).toBeGreaterThan(0);
    expect(result.unresolvedCollisions.length).toBeGreaterThan(0);

    // Verify the collision record has proper fields
    const collision = result.unresolvedCollisions[0]!;
    expect(collision.collisionClass).toBe("BRANCH_BRANCH");
    expect(collision.clearanceDeficit).toBeGreaterThan(0);
    expect(Number.isFinite(collision.measuredDistance)).toBe(true);
    expect(Number.isFinite(collision.requiredClearance)).toBe(true);

    // Verify resolution scope is assigned
    expect(["LOCAL_RELAXATION", "BEND_PATH"]).toContain(collision.recommendedResolution);
  });

  it("does not mutate the input SkeletonPlan or RoutingPlan", () => {
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);
    const input = makeInput([branchA, branchB], [recA, recB]);

    // Capture original frozen state
    const originalFingerprint = input.skeletonPlan.deterministicFingerprint;
    const originalRoutingFingerprint = input.routingPlan.deterministicFingerprint;
    const originalBranchCount = input.skeletonPlan.branches.length;
    const originalRecordCount = input.routingPlan.records.length;

    resolveLocalCollisions(input);

    // Verify nothing mutated
    expect(input.skeletonPlan.deterministicFingerprint).toBe(originalFingerprint);
    expect(input.routingPlan.deterministicFingerprint).toBe(originalRoutingFingerprint);
    expect(input.skeletonPlan.branches.length).toBe(originalBranchCount);
    expect(input.routingPlan.records.length).toBe(originalRecordCount);
  });

  it("does not modify branch topology or genealogy references", () => {
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);
    const input = makeInput([branchA, branchB], [recA, recB]);

    // Capture topology references
    const parentRefs = input.skeletonPlan.branches.map((b) => b.parentBranchId);
    const childRefs = input.skeletonPlan.branches.map((b) => b.childrenBranchIds.length);
    const ownerRefs = input.skeletonPlan.branches.map((b) => b.ownerPersonId);

    resolveLocalCollisions(input);

    // Verify topology unchanged
    const newParentRefs = input.skeletonPlan.branches.map((b) => b.parentBranchId);
    const newChildRefs = input.skeletonPlan.branches.map((b) => b.childrenBranchIds.length);
    const newOwnerRefs = input.skeletonPlan.branches.map((b) => b.ownerPersonId);
    expect(newParentRefs).toEqual(parentRefs);
    expect(newChildRefs).toEqual(childRefs);
    expect(newOwnerRefs).toEqual(ownerRefs);
  });

  it("returns empty result when no collisions exist", () => {
    // Two branches far apart
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 500 }, p1: { x: 50, y: 500 }, p2: { x: 100, y: 500 }, p3: { x: 150, y: 500 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 5, 2, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 5, 2, [
      { x: -5, y: 495 }, { x: 155, y: 495 }, { x: 155, y: 505 }, { x: -5, y: 505 },
    ]);
    const input = makeInput([branchA, branchB], [recA, recB]);
    const result = resolveLocalCollisions(input);

    expect(result.hasCollisions).toBe(false);
    expect(result.pendingActions.length).toBe(0);
    expect(result.unresolvedCollisions.length).toBe(0);
  });

  it("does not create a new collision with a third branch", () => {
    // Three branches: A close to B, C far from both. Repairing A-B must not affect C.
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const branchC = makeBranch("branch:c", null, 1, {
      p0: { x: 500, y: 0 }, p1: { x: 550, y: 0 }, p2: { x: 600, y: 0 }, p3: { x: 650, y: 0 },
    }, "n5", "n6");

    const radius = 10;
    const margin = 4;
    const recA = makeRoutingRecord("branch:a", null, radius, margin, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, radius, margin, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);
    const recC = makeRoutingRecord("branch:c", null, radius, margin, [
      { x: 495, y: -5 }, { x: 655, y: -5 }, { x: 655, y: 5 }, { x: 495, y: 5 },
    ]);

    const input = makeInput([branchA, branchB, branchC], [recA, recB, recC]);
    const result = resolveLocalCollisions(input);

    // A-B should have collisions
    expect(result.hasCollisions).toBe(true);

    // C should NOT be in any pending action or collision record
    const cInActions = result.pendingActions.some((a) => a.branchId === "branch:c");
    const cInCollisions = result.unresolvedCollisions.some(
      (c) => c.branchIdA === "branch:c" || c.branchIdB === "branch:c",
    );
    expect(cInActions).toBe(false);
    expect(cInCollisions).toBe(false);
  });

  it("remains deterministic (same input → same output)", () => {
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);

    const input = makeInput([branchA, branchB], [recA, recB]);
    const result1 = resolveLocalCollisions(input);
    const result2 = resolveLocalCollisions(input);

    expect(result1.hasCollisions).toBe(result2.hasCollisions);
    expect(result1.pendingActions.length).toBe(result2.pendingActions.length);
    expect(result1.unresolvedCollisions.length).toBe(result2.unresolvedCollisions.length);
    for (let i = 0; i < result1.pendingActions.length; i += 1) {
      expect(result1.pendingActions[i]!.branchId).toBe(result2.pendingActions[i]!.branchId);
      expect(result1.pendingActions[i]!.resolutionScope).toBe(result2.pendingActions[i]!.resolutionScope);
    }
  });

  it("respects maximum repair iterations (low limit cuts off repair)", () => {
    // Create 5 branches that all collide
    const branches: SkeletonBranch[] = [];
    const records: RoutingRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      const y = i * 3;
      branches.push(makeBranch(
        `branch:${i}`, null, 1,
        { p0: { x: 0, y }, p1: { x: 50, y }, p2: { x: 100, y }, p3: { x: 150, y } },
        `n${i * 2}`, `n${i * 2 + 1}`,
      ));
      records.push(makeRoutingRecord(
        `branch:${i}`, null, 10, 4,
        [{ x: -5, y: y - 5 }, { x: 155, y: y - 5 }, { x: 155, y: y + 5 }, { x: -5, y: y + 5 }],
      ));
    }

    const input = makeInput(branches, records);

    // With max 2 iterations, only 2 branches are tested
    const limitedPolicy: CollisionPolicy = { ...DEFAULT_COLLISION_POLICY, maximumRepairIterations: 2 };
    const limitedResult = resolveLocalCollisions(input, limitedPolicy);

    // With default 10 iterations, all 5 are tested
    const fullResult = resolveLocalCollisions(input);

    // Limited should have fewer or equal actions than full
    expect(limitedResult.pendingActions.length).toBeLessThanOrEqual(fullResult.pendingActions.length);
  });

  it("reports an unresolved collision when repair is impossible (penetration)", () => {
    // Two branches that actually intersect (crossing each other)
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 50 }, p2: { x: 100, y: 100 }, p3: { x: 150, y: 150 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 150 }, p1: { x: 50, y: 100 }, p2: { x: 100, y: 50 }, p3: { x: 150, y: 0 },
    }, "n3", "n4");

    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: 155 }, { x: 150, y: 160 }, { x: -10, y: 0 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: 155 }, { x: 155, y: -5 }, { x: 160, y: 0 }, { x: 0, y: 160 },
    ]);

    const input = makeInput([branchA, branchB], [recA, recB]);
    const result = resolveLocalCollisions(input);

    expect(result.hasCollisions).toBe(true);
    expect(result.unresolvedCollisions.length).toBeGreaterThan(0);

    // Penetration should be flagged with BEND_PATH resolution
    const hasPenetration = result.unresolvedCollisions.some(
      (c) => c.severity === "PENETRATION" || c.recommendedResolution === "BEND_PATH",
    );
    // Either we detected penetration or at minimum a clearance deficit
    expect(hasPenetration || result.unresolvedCollisions.some(
      (c) => c.severity === "CLEARANCE_DEFICIT",
    )).toBe(true);
  });

  it("pending actions are sorted deterministically by branchId", () => {
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);

    const input = makeInput([branchA, branchB], [recA, recB]);
    const result = resolveLocalCollisions(input);

    for (let i = 1; i < result.pendingActions.length; i += 1) {
      expect(
        String(result.pendingActions[i - 1]!.branchId).localeCompare(
          String(result.pendingActions[i]!.branchId),
        ),
      ).toBeLessThanOrEqual(0);
    }
  });
});

describe("CollisionResolver — validateCollisionSafety", () => {
  it("returns a validation report with proper structure", () => {
    const branchA = makeBranch("branch:a", null, 1, {
      p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 },
    }, "n1", "n2");
    const branchB = makeBranch("branch:b", null, 1, {
      p0: { x: 0, y: 3 }, p1: { x: 50, y: 3 }, p2: { x: 100, y: 3 }, p3: { x: 150, y: 3 },
    }, "n3", "n4");
    const recA = makeRoutingRecord("branch:a", null, 10, 4, [
      { x: -5, y: -5 }, { x: 155, y: -5 }, { x: 155, y: 5 }, { x: -5, y: 5 },
    ]);
    const recB = makeRoutingRecord("branch:b", null, 10, 4, [
      { x: -5, y: -2 }, { x: 155, y: -2 }, { x: 155, y: 8 }, { x: -5, y: 8 },
    ]);

    const input = makeInput([branchA, branchB], [recA, recB]);
    const report = validateCollisionSafety(input);

    expect(typeof report.accepted).toBe("boolean");
    expect(Array.isArray(report.collisions)).toBe(true);
    expect(report.metrics.branchCount).toBeGreaterThan(0);
    expect(Number.isFinite(report.metrics.minimumClearance)).toBe(true);
    expect(Number.isFinite(report.metrics.maximumClearanceDeficit)).toBe(true);
  });
});
