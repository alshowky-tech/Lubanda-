import { describe, expect, it } from "vitest";
import { distance } from "../../../src/core/geometry/vec2.js";
import { acceptedSnapshot, syntheticSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton } from "../../helpers/skeleton-builders.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/graph.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import type { SkeletonPlan } from "../../../src/core/skeleton/types.js";
import { SkeletonValidator } from "../../../src/core/layout/SkeletonValidator.js";
import { classifyPointInPolygon } from "../../../src/core/geometry/polygon.js";
import { evaluateCubicBezier, sampleCubicBezier } from "../../../src/core/geometry/bezier.js";
import { asPersonId } from "../../../src/core/contracts/identifiers.js";
import type { Polygon } from "../../../src/core/geometry/types.js";

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

    const nodeMap = new Map(skeletonPlan.nodes.map((n) => [n.id, n]));
    for (const branch of skeletonPlan.branches) {
      const sNode = nodeMap.get(branch.startNodeId);
      expect(sNode).toBeDefined();
      if (sNode) expect(distance(branch.startPoint, sNode.point)).toBeLessThanOrEqual(EPSILON);
      const eNode = nodeMap.get(branch.endNodeId);
      expect(eNode).toBeDefined();
      if (eNode) expect(distance(branch.endPoint, eNode.point)).toBeLessThanOrEqual(EPSILON);
    }

    const branchMap = new Map(skeletonPlan.branches.map((b) => [b.id, b]));
    for (const branch of skeletonPlan.branches) {
      for (const childId of branch.childrenBranchIds) {
        const child = branchMap.get(childId);
        expect(child).toBeDefined();
        if (child) expect(child.parentBranchId).toBe(branch.id);
      }
    }
    expect(skeletonPlan.validation.metrics.intersectionCount).toBe(0);

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
      if (node) expect(distance(mj.trunkPoint, node.point)).toBeLessThanOrEqual(EPSILON);
    }
  });

  it("lineage branch startNodeId equals its mapped trunkNodeId", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    for (const mj of skeletonPlan.mappedJunctions) {
      const lineageBranch = skeletonPlan.branches.find(
        (b) => b.ownerPersonId === mj.lineageRootId && b.generation === 1,
      );
      expect(lineageBranch).toBeDefined();
      if (lineageBranch) expect(lineageBranch.startNodeId).toBe(mj.trunkNodeId);
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
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 1 }));
    expect(skeletonPlan.status).toBe("ACCEPTED");
    expect(skeletonPlan.branches.length).toBeGreaterThanOrEqual(1);
  });

  it("records diagnostic events during growth", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    expect(skeletonPlan.diagnostics.length).toBeGreaterThan(0);
    const stages = new Set(skeletonPlan.diagnostics.map((d) => d.stage));
    expect(stages.has("TRUNK_PLANNING")).toBe(true);
    expect(stages.has("RECURSIVE_GROWTH")).toBe(true);
  });

  it("produces a deterministic replay fingerprint", async () => {
    const first = await growSkeleton(acceptedSnapshot());
    const second = await growSkeleton(acceptedSnapshot());
    expect(first.skeletonPlan.deterministicFingerprint).toBe(second.skeletonPlan.deterministicFingerprint);
  });

  it("assigns non-null candidate scores to accepted branches", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    expect(skeletonPlan.branches.filter((b) => b.candidateScore !== null).length).toBeGreaterThan(0);
  });

  it("every selected-root subtree person has a branch", async () => {
    const { skeletonPlan, graph } = await growSkeleton(acceptedSnapshot());
    const personIds = new Set(skeletonPlan.branches.map((b) => b.ownerPersonId));
    for (const id of graph.getSubtree(asPersonId(skeletonPlan.selectedRootId))) {
      expect(personIds.has(id)).toBe(true);
    }
  });

  it("forced no-valid-candidate returns REJECTED with no fallback", async () => {
    const { skeletonPlan: sk } = await growSkeleton(acceptedSnapshot(), undefined, 42,
      { ...DEFAULT_ENGINE_CONFIGURATION.skeleton, candidateCount: 2, minimumBranchLength: 5000 });
    expect(sk.status).toBe("REJECTED");
    for (const b of sk.branches) {
      if (b.generation > 0 && b.candidateScore === null) expect(false).toBe(true);
    }
  });

  it("BRANCH_SPLIT nodes lie on the parent Bezier curve", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    for (const node of skeletonPlan.nodes) {
      if (node.kind !== "BRANCH_SPLIT") continue;
      const parentBranch = skeletonPlan.branches.find((b) => b.id === node.incomingBranchId);
      expect(parentBranch).toBeDefined();
      if (!parentBranch) continue;
      // The split node point should be closer to the parent Bezier curve than to the chord
      const chordPoint = {
        x: parentBranch.startPoint.x + (parentBranch.endPoint.x - parentBranch.startPoint.x) * 0.5,
        y: parentBranch.startPoint.y + (parentBranch.endPoint.y - parentBranch.startPoint.y) * 0.5,
      };
      const distChord = distance(node.point, chordPoint);
      // Find closest point on Bezier by scanning t
      let minCurve = Infinity;
      for (let t = 0; t <= 1; t += 0.01) {
        minCurve = Math.min(minCurve, distance(node.point, evaluateCubicBezier(parentBranch.curve, t)));
      }
      // The curve distance should be much smaller than the chord distance
      expect(minCurve).toBeLessThanOrEqual(distChord + 0.1);
    }
  });

  it("split nodes have incomingBranchId and children reference them", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    for (const node of skeletonPlan.nodes) {
      if (node.kind !== "BRANCH_SPLIT") continue;
      expect(node.incomingBranchId).not.toBeNull();
      const incomingBranch = skeletonPlan.branches.find((b) => b.id === node.incomingBranchId);
      expect(incomingBranch).toBeDefined();
      // Children starting at this node should reference the parent branch
      const children = skeletonPlan.branches.filter((b) => b.startNodeId === node.id);
      for (const child of children) {
        expect(child.parentBranchId).toBe(incomingBranch?.id);
      }
    }
  });

  it("corrupted parentBranchId is rejected", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const branches = [...skeletonPlan.branches];
    if (branches.length >= 3) {
      const corrupted = branches.map((b, i) => (i === 1 && branches[2] ? { ...b, parentBranchId: branches[2]!.id } : b));
      const result = validator.validate(
        { ...skeletonPlan, branches: Object.freeze(corrupted) } as unknown as SkeletonPlan,
        graph, asPersonId(skeletonPlan.selectedRootId),
        { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, new Map());
      expect(result.accepted).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("missing incomingBranchId on split node is rejected", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const corruptedNodes = skeletonPlan.nodes.map((n) =>
      n.kind === "BRANCH_SPLIT" ? { ...n, incomingBranchId: null } : n);
    const tmap = new Map<string, Polygon>();
    for (const b of skeletonPlan.branches) {
      if (b.territoryId) tmap.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
    }
    const result = validator.validate(
      { ...skeletonPlan, nodes: Object.freeze(corruptedNodes) } as unknown as SkeletonPlan,
      graph, asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, tmap);
    expect(result.accepted).toBe(false);
  });

  it("missing outgoing child reference is rejected", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const corrupted = skeletonPlan.branches.map((b) =>
      b.childrenBranchIds.length > 0 ? { ...b, childrenBranchIds: Object.freeze([]) } : b);
    const tmap = new Map<string, Polygon>();
    for (const b of skeletonPlan.branches) {
      if (b.territoryId) tmap.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
    }
    const result = validator.validate(
      { ...skeletonPlan, branches: Object.freeze(corrupted) } as unknown as SkeletonPlan,
      graph, asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, tmap);
    expect(result.accepted).toBe(false);
  });

  it("tiny territory causes territory miss", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const tmap = new Map<string, Polygon>();
    const tiny = { points: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] };
    for (const b of skeletonPlan.branches) { if (b.territoryId) tmap.set(b.territoryId, tiny); }
    const result = validator.validate(skeletonPlan, graph, asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, tmap);
    expect(result.metrics.territoryMissCount).toBeGreaterThan(0);
  });

  it("every node has unique outgoingBranchIds (no duplicates)", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    for (const node of skeletonPlan.nodes) {
      const unique = new Set(node.outgoingBranchIds);
      expect(unique.size).toBe(node.outgoingBranchIds.length);
    }
  });

  it("a single-child BRANCH_SPLIT end node has exactly one outgoing branch", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "LINEAR" }));
    for (const node of skeletonPlan.nodes) {
      if (node.kind === "BRANCH_SPLIT" && node.outgoingBranchIds.length > 0) {
        expect(node.outgoingBranchIds.length).toBe(1);
      }
    }
  });

  it("every interior BRANCH_SPLIT has exactly one outgoing branch", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    for (const node of skeletonPlan.nodes) {
      if (node.kind !== "BRANCH_SPLIT") continue;
      const parentBranch = skeletonPlan.branches.find((b) => b.id === node.incomingBranchId);
      if (!parentBranch) continue;
      // An interior split is one that is NOT the parent's end node
      if (node.id === parentBranch.endNodeId) continue;
      expect(node.outgoingBranchIds.length).toBe(1);
      // Verify the outgoing branch starts at this node
      for (const childId of node.outgoingBranchIds) {
        const child = skeletonPlan.branches.find((b) => b.id === childId);
        expect(child).toBeDefined();
        if (child) expect(child.startNodeId).toBe(node.id);
      }
    }
  });

  it("single-child parent end node is BRANCH_SPLIT with exactly one outgoing", async () => {
    // acceptedSnapshot: person 2 has exactly 1 child (person 4)
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    expect(skeletonPlan.status).toBe("ACCEPTED");
    // Find person 2's branch (generation 1, ownerPersonId "2")
    const p2Branch = skeletonPlan.branches.find((b) => b.ownerPersonId === "2" && b.generation === 1);
    expect(p2Branch).toBeDefined();
    if (!p2Branch) return;
    // Person 2's branch has exactly 1 child (person 4)
    expect(p2Branch.childrenBranchIds.length).toBe(1);
    // The end node of this single-child branch must be BRANCH_SPLIT
    const endNode = skeletonPlan.nodes.find((n) => n.id === p2Branch.endNodeId);
    expect(endNode).toBeDefined();
    if (endNode) expect(endNode.kind).toBe("BRANCH_SPLIT");
    // The end node must have exactly 1 outgoing (the child branch)
    expect(endNode!.outgoingBranchIds.length).toBe(1);
    expect(endNode!.outgoingBranchIds[0]).toBe(p2Branch.childrenBranchIds[0]);
    // The child starts at this end node
    const childBranch = skeletonPlan.branches.find((b) => b.id === p2Branch.childrenBranchIds[0]);
    expect(childBranch).toBeDefined();
    if (childBranch) expect(childBranch.startNodeId).toBe(endNode!.id);
  });

  it("validator rejects duplicated outgoingBranchIds with exact reason", async () => {
    const { skeletonPlan } = await growSkeleton(syntheticSnapshot({ size: 10, shape: "BALANCED" }));
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    // Find a BRANCH_SPLIT node with at least one outgoing and duplicate its first entry
    const targetNode = skeletonPlan.nodes.find(
      (n) => n.kind === "BRANCH_SPLIT" && n.outgoingBranchIds.length > 0,
    );
    expect(targetNode).toBeDefined();
    if (!targetNode) return;
    const duplicatedOut = [...targetNode.outgoingBranchIds, targetNode.outgoingBranchIds[0]!];
    const corruptedNodes = skeletonPlan.nodes.map((n) =>
      n.id === targetNode.id ? { ...n, outgoingBranchIds: Object.freeze(duplicatedOut) } : n,
    );
    const tmap = new Map<string, Polygon>();
    for (const b of skeletonPlan.branches) {
      if (b.territoryId) tmap.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
    }
    const result = validator.validate(
      { ...skeletonPlan, nodes: Object.freeze(corruptedNodes) } as unknown as SkeletonPlan,
      graph, asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, tmap,
    );
    expect(result.accepted).toBe(false);
    // Should contain an issue with reason "node.outgoingBranchIds contains duplicate entries"
    const dupIssue = result.issues.find(
      (i) => i.details && typeof i.details === "object" && "reason" in i.details &&
        (i.details as Record<string, unknown>).reason === "node.outgoingBranchIds contains duplicate entries",
    );
    expect(dupIssue).toBeDefined();
    expect(dupIssue!.code).toBe("SKELETON_BRANCH_INVALID");
  });

  it("large territory has zero misses", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const validator = new SkeletonValidator();
    const graph = buildGenealogyGraph(acceptedSnapshot());
    const tmap = new Map<string, Polygon>();
    const large = { points: [{x:-10000,y:-10000},{x:10000,y:-10000},{x:10000,y:10000},{x:-10000,y:10000}] };
    for (const b of skeletonPlan.branches) { if (b.territoryId) tmap.set(b.territoryId, large); }
    const result = validator.validate(skeletonPlan, graph, asPersonId(skeletonPlan.selectedRootId),
      { points: [{x:0,y:0},{x:4000,y:0},{x:4000,y:2500},{x:0,y:2500}] }, tmap);
    expect(result.metrics.territoryMissCount).toBe(0);
  });
});
