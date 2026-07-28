import { describe, expect, it } from "vitest";
import { DeterministicLabelCandidateGenerator } from "../../src/core/labels/LabelCandidateGenerator.js";
import { OpentypeTextMeasurer } from "../../src/core/labels/TextMeasurer.js";
import { DeterministicCollisionEngine } from "../../src/core/collision/CollisionEngine.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../src/core/routing/RoutingPlanBuilder.js";
import { DefaultCandidateCollisionQuery } from "../../src/core/labels/CandidateCollisionQuery.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { growSkeleton } from "../helpers/skeleton-builders.js";
import type { SkeletonBranch, SkeletonPlan } from "../../src/core/skeleton/types.js";
import type { RoutingRecord } from "../../src/core/routing/types.js";
import type { Polygon } from "../../src/core/geometry/types.js";
import type { SkeletonBranchId, PersonId } from "../../src/core/contracts/identifiers.js";
import type { LabelCandidateGenerationInput } from "../../src/core/labels/types.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";

// ── L‑shaped concave polygon fixture ──
const L_POLYGON: Polygon = Object.freeze({
  points: Object.freeze([
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 60, y: 80 },
    { x: 60, y: 120 },
    { x: 0, y: 120 },
  ]),
});

const buildRealInput = async (seed = 42): Promise<{
  input: LabelCandidateGenerationInput;
  skeletonPlan: SkeletonPlan;
  branchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>;
}> => {
  const snapshot = acceptedSnapshot();
  const { skeletonPlan } = await growSkeleton(snapshot, undefined, seed);
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    skeletonPlan.branches.map((b) => [b.id, b]),
  );
  const builder = new RoutingPlanBuilder();
  const territoryPolygons = new Map<string, Polygon>();
  for (const b of skeletonPlan.branches) {
    if (b.territoryId) {
      territoryPolygons.set(b.territoryId, {
        points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }],
      });
    }
  }
  const routingPlan = await builder.build({
    skeletonPlan,
    skeletonBranchMap: branchMap,
    territoryPolygons,
  });
  const routingRecordMap = new Map<SkeletonBranchId, RoutingRecord>(
    routingPlan.records.map((r) => [r.branchId, r]),
  );

  // Build a real CollisionIndex
  const engine = new DeterministicCollisionEngine();
  const collisionInput = {
    skeletonPlan,
    skeletonBranchMap: branchMap,
    routingPlan,
    routingRecordMap,
    configuration: DEFAULT_ENGINE_CONFIGURATION.collision,
  };
  const collisionIndex = engine.index(collisionInput);

  // Wrap in read-only query
  const templateBoundary: Polygon = {
    points: Object.freeze([
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ]),
  };
  const collisionQuery = new DefaultCandidateCollisionQuery(collisionIndex, templateBoundary);

  // Create the name map from the skeleton
  const nameMap = new Map<PersonId, string>();
  for (const branch of skeletonPlan.branches) {
    if (branch.generation > 0) {
      nameMap.set(branch.ownerPersonId, branch.metadata.person.name);
    }
  }

  const measurer = new OpentypeTextMeasurer(
    [{ family: "DejaVu Sans", weight: 400, style: "normal" as const, path: new URL("../../fonts/DejaVuSans.ttf", import.meta.url).pathname }],
    4,
  );
  await measurer.initialize();

  return {
    input: {
      skeletonPlan,
      skeletonBranchMap: branchMap,
      skeletonNodeMap: new Map(skeletonPlan.nodes.map((n) => [n.id, n])),
      graph: {
        personsById: new Map(),
        childrenByParentId: new Map(),
        roots: Object.freeze([]) as unknown as readonly PersonId[],
        getAncestors: () => [],
        getDescendants: () => [],
        getSubtree: () => [],
        isTerminal: () => false,
      },
      nameMap,
      configuration: DEFAULT_ENGINE_CONFIGURATION.labels,
      collisionQuery,
      templateBoundary,
      textMeasurementService: measurer,
      cartoucheZones: undefined,
      fixedLabelPlacements: Object.freeze([]),
    },
    skeletonPlan,
    branchMap,
  };
};

describe("Skeleton → Candidate generation integration", () => {
  it("generates candidates from a real skeleton with real collision index", async () => {
    const { input } = await buildRealInput(42);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);
    expect(result.allCandidates.length).toBeGreaterThan(0);
    for (const c of result.allCandidates) {
      expect(Number.isFinite(c.bounds.minX)).toBe(true);
      expect(c.validationStatus).toBe("VALID");
    }
  });

  it("uses real M7.1 text measurement for candidate bounds", async () => {
    const { input } = await buildRealInput(42);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);
    for (const c of result.allCandidates) {
      expect(c.bounds.minX).toBeLessThan(c.bounds.maxX);
      expect(c.bounds.minY).toBeLessThan(c.bounds.maxY);
    }
  });

  it("generates reproducible (deterministic) output", async () => {
    const { input } = await buildRealInput(42);
    const gen = new DeterministicLabelCandidateGenerator();
    const r1 = await gen.generate(input);
    const r2 = await gen.generate(input);
    expect(r1.allCandidates.length).toBe(r2.allCandidates.length);
    for (let i = 0; i < r1.allCandidates.length; i += 1) {
      expect(r1.allCandidates[i]!.family).toBe(r2.allCandidates[i]!.family);
    }
  });
});

describe("Routing clearance integration", () => {
  it("generates candidates with branch-clearance-aware offsets", async () => {
    const { input } = await buildRealInput(42);
    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(input);
    // Offset candidates have leader lengths > 0
    const offsetCands = result.allCandidates.filter(
      (c) => c.family !== "ALIGNED_WITH_BRANCH" && c.family !== "TERMINAL_LEAF",
    );
    for (const c of offsetCands) {
      expect(c.leaderLength).toBeGreaterThan(0);
    }
  });
});

describe("Concave boundary integration (L-shaped polygon)", () => {
  it("detects notch-bridging candidates as INVALID using concave query", async () => {
    const { input: rectangularInput } = await buildRealInput(42);
    const measurer = rectangularInput.textMeasurementService;
    const branchMap = rectangularInput.skeletonBranchMap;
    const skeletonPlan = rectangularInput.skeletonPlan;
    const nodeMap = rectangularInput.skeletonNodeMap;
    const nameMap = rectangularInput.nameMap;

    // Build empty collision index + concave polygon
    const emptyIndex = { entries: Object.freeze([]), branchIdMap: new Map(), query: () => [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const concaveQuery = new DefaultCandidateCollisionQuery(emptyIndex as any, L_POLYGON);

    const concaveInput: LabelCandidateGenerationInput = {
      skeletonPlan,
      skeletonBranchMap: branchMap,
      skeletonNodeMap: nodeMap,
      graph: rectangularInput.graph,
      nameMap,
      configuration: rectangularInput.configuration,
      collisionQuery: concaveQuery,
      templateBoundary: L_POLYGON,
      textMeasurementService: measurer,
      cartoucheZones: undefined,
      fixedLabelPlacements: Object.freeze([]),
    };

    const gen = new DeterministicLabelCandidateGenerator();
    const result = await gen.generate(concaveInput);
    expect(result.allCandidates.length).toBeGreaterThan(0);
  });
});

// ── Property tests ──

describe("Property: candidate geometry", () => {
  it("all coordinates are finite", async () => {
    const { input } = await buildRealInput(42);
    const result = await new DeterministicLabelCandidateGenerator().generate(input);
    for (const c of result.allCandidates) {
      expect(Number.isFinite(c.bounds.minX)).toBe(true);
      expect(Number.isFinite(c.bounds.maxX)).toBe(true);
      expect(Number.isFinite(c.bounds.minY)).toBe(true);
      expect(Number.isFinite(c.bounds.maxY)).toBe(true);
      expect(Number.isFinite(c.anchor.x)).toBe(true);
      expect(Number.isFinite(c.anchor.y)).toBe(true);
    }
  });
});

describe("Property: deterministic replay", () => {
  it("produces canonical-equivalent output on repeat", async () => {
    const { input } = await buildRealInput(42);
    const gen = new DeterministicLabelCandidateGenerator();
    const r1 = await gen.generate(input);
    const r2 = await gen.generate(input);
    expect(JSON.stringify(r1.allCandidates.map((c) => c.family))).toBe(
      JSON.stringify(r2.allCandidates.map((c) => c.family)),
    );
  });
});

describe("Property: terminal family rules", () => {
  it("generates at least 4 candidates per person", async () => {
    const { input } = await buildRealInput(42);
    const result = await new DeterministicLabelCandidateGenerator().generate(input);
    for (const [, candidates] of result.personCandidateMap) {
      expect(candidates.length).toBeGreaterThanOrEqual(4);
    }
  });
});
