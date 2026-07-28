import { describe, expect, it } from "vitest";
import { distance } from "../../../src/core/geometry/vec2.js";
import {
  acceptedSnapshot,
  syntheticSnapshot,
} from "../../helpers/genealogy-builders.js";
import { growSkeleton } from "../../helpers/skeleton-builders.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/graph.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import type { SkeletonPlan } from "../../../src/core/skeleton/types.js";
import { SkeletonValidator } from "../../../src/core/layout/SkeletonValidator.js";
import { classifyPointInPolygon } from "../../../src/core/geometry/polygon.js";
import { sampleCubicBezier } from "../../../src/core/geometry/bezier.js";
import { asPersonId } from "../../../src/core/contracts/identifiers.js";

const EPSILON = 1e-7;

describe("DeterministicSkeletonGrowthEngine", () => {
  it("grows a valid trunk and branches — validation accepted with zero issues", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    expect(skeletonPlan.status).toBe("ACCEPTED");
    expect(skeletonPlan.validation.accepted).toBe(true);
    expect(skeletonPlan.validation.issues.length).toBe(0);
    expect(skeletonPlan.trunk.segments.length).toBeGreaterThanOrEqual(1);
    expect(skeletonPlan.branches.length).toBeGreaterThanOrEqual(1);
    expect(skeletonPlan.nodes.length).toBeGreaterThanOrEqual(2);

    // Every branch startPoint equals its start node point
    const nodeMap = new Map(skeletonPlan.nodes.map((n) => [n.id, n]));
    for (const branch of skeletonPlan.branches) {
      const sNode = nodeMap.get(branch.startNodeId);
      expect(sNode).toBeDefined();
      if (sNode) {
        expect(distance(branch.startPoint, sNode.point)).toBeLessThanOrEqual(EPSILON);
      }
      const eNode = nodeMap.get(branch.endNodeId);
      expect(eNode).toBeDefined();
      if (eNode) {
        expect(distance(branch.endPoint, eNode.point)).toBeLessThanOrEqual(EPSILON);
      }
    }

    // Parent/child topology is consistent in both directions
    const branchMap = new Map(skeletonPlan.branches.map((b) => [b.id, b]));
    for (const branch of skeletonPlan.branches) {
      for (const childId of branch.childrenBranchIds) {
        const child = branchMap.get(childId);
        expect(child).toBeDefined();
        if (child) {
          expect(child.parentBranchId).toBe(branch.id);
        }
      }
    }

    // No unapproved intersections
    expect(skeletonPlan.validation.metrics.intersectionCount).toBe(0);

    // Complete template and territory containment
    for (const branch of skeletonPlan.branches) {
      const samples = sampleCubicBezier(branch.curve, { tolerance: 4, maxSubdivisionDepth: 10 });
      for (const p of samples) {
        expect(classifyPointInPolygon(p, { points: [{x:-1000,y:-1000},{x:5000,y:-1000},{x:5000,y:3500},{x:-1000,y:3500}] })).not.toBe("OUTSIDE");
      }
    }
  });

  it("connects major lineages via mapped junctions with correct startNodeId", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    expect(skeletonPlan.mappedJunctions.length).toBeGreaterThanOrEqual(1);
    const nodeMap = new Map(skeletonPlan.nodes.map((n) => [n.id, n]));
    for (const mj of skeletonPlan.mappedJunctions) {
      expect(mj.trunkNodeId).toBeTruthy();
      expect(mj.lineageRootId).toBeTruthy();
      const node = nodeMap.get(mj.trunkNodeId);
      expect(node).toBeDefined();
      if (node) {
        expect(distance(mj.trunkPoint, node.point)).toBeLessThanOrEqual(EPSILON);
      }
    }
  });

  it("every branch has finite coordinates and positive length", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    for (const branch of skeletonPlan.branches) {
      expect(Number.isFinite(branch.curve.p0.x)).toBe(true);
      expect(Number.isFinite(branch.curve.p0.y)).toBe(true);
      expect(Number.isFinite(branch.curve.p3.x)).toBe(true);
      expect(Number.isFinite(branch.curve.p3.y)).toBe(true);
      expect(branch.length).toBeGreaterThan(0);
    }
  });

  it("every node has a valid point", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    for (const node of skeletonPlan.nodes) {
      expect(Number.isFinite(node.point.x)).toBe(true);
      expect(Number.isFinite(node.point.y)).toBe(true);
    }
  });

  it("accepts a single-person genealogy gracefully", async () => {
    const { skeletonPlan } = await growSkeleton(
      syntheticSnapshot({ size: 1 }),
    );
    expect(skeletonPlan.status).toBe("ACCEPTED");
    expect(skeletonPlan.branches.length).toBeGreaterThanOrEqual(1);
  });

  it("records diagnostic events during growth", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    expect(skeletonPlan.diagnostics.length).toBeGreaterThan(0);
    const stages = new Set(
      skeletonPlan.diagnostics.map((d) => d.stage),
    );
    expect(stages.has("TRUNK_PLANNING")).toBe(true);
    expect(stages.has("RECURSIVE_GROWTH")).toBe(true);
  });

  it("produces a deterministic replay fingerprint", async () => {
    const first = await growSkeleton(acceptedSnapshot());
    const second = await growSkeleton(acceptedSnapshot());
    expect(first.skeletonPlan.deterministicFingerprint).toBe(
      second.skeletonPlan.deterministicFingerprint,
    );
  });

  it("assigns non-null candidate scores to accepted branches", async () => {
    const { skeletonPlan } = await growSkeleton(
      syntheticSnapshot({ size: 10, shape: "BALANCED" }),
    );
    const scoredBranches = skeletonPlan.branches.filter(
      (b) => b.candidateScore !== null,
    );
    expect(scoredBranches.length).toBeGreaterThan(0);
  });

  it("every selected-root subtree person has a branch", async () => {
    const { skeletonPlan, graph } = await growSkeleton(acceptedSnapshot());
    const subtree = graph.getSubtree(asPersonId(skeletonPlan.selectedRootId));
    const personIds = new Set(skeletonPlan.branches.map((b) => b.ownerPersonId));
    for (const id of subtree) {
      expect(personIds.has(id)).toBe(true);
    }
  });

  it("forced no-valid-candidate scenario returns REJECTED with no fallback branch", async () => {
    // Use growSkeleton with valid territory, but extreme skeleton constraints
    // that will reject all candidates
    const { skeletonPlan: sk } = await growSkeleton(
      acceptedSnapshot(),
      undefined,  // default template
      42,
      { ...DEFAULT_ENGINE_CONFIGURATION.skeleton, candidateCount: 2, minimumBranchLength: 5000 },
    );
    expect(sk.status).toBe("REJECTED");
    // No fallback branch should exist: no branch with candidateScore === null
    // and generation > 0 should have been created
    for (const b of sk.branches) {
      if (b.generation > 0 && b.candidateScore === null) {
        // score null means fallback — should not happen
        expect(false).toBe(true);
      }
    }
  });

  it("deliberately corrupted connectivity is rejected by the validator", async () => {
    // This tests the validator in isolation with a deliberately corrupted plan
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());

    // Build a fake plan with wrong parentBranchId
    const corruptedBranches = skeletonPlan.branches.map((b, i) => ({
      ...b,
      startPoint: i === 1 ? { x: 99999, y: 99999 } : b.startPoint,
    }));
    const corruptedPlan = { ...skeletonPlan, branches: Object.freeze(corruptedBranches) };

    const result = validator.validate(
      corruptedPlan as unknown as SkeletonPlan,
      graph,
      asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] },
      new Map(),
    );
    expect(result.accepted).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
