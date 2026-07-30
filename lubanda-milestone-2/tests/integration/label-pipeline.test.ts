import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { DeterministicCollisionEngine } from "../../src/core/collision/CollisionEngine.js";
import { DefaultLabelCollisionQuery, runLabelPipeline } from "../../src/core/labels/index.js";
import { DefaultCandidateCollisionQuery } from "../../src/core/labels/CandidateCollisionQuery.js";
import { OpentypeTextMeasurer } from "../../src/core/labels/TextMeasurer.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../src/core/routing/RoutingPlanBuilder.js";
import type { PersonId, SkeletonBranchId } from "../../src/core/contracts/identifiers.js";
import type { Polygon } from "../../src/core/geometry/types.js";
import type { LabelCandidateGenerationInput } from "../../src/core/labels/types.js";
import type { RoutingRecord } from "../../src/core/routing/types.js";
import type { SkeletonBranch } from "../../src/core/skeleton/types.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { growSkeleton } from "../helpers/skeleton-builders.js";

const buildPipelineInput = async (): Promise<LabelCandidateGenerationInput> => {
  const snapshot = acceptedSnapshot();
  const { graph, skeletonPlan } = await growSkeleton(snapshot, undefined, 42);
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    skeletonPlan.branches.map((branch) => [branch.id, branch]),
  );
  const templateBoundary: Polygon = {
    points: Object.freeze([
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ]),
  };
  const territoryPolygons = new Map<string, Polygon>();
  for (const branch of skeletonPlan.branches) {
    if (branch.territoryId) territoryPolygons.set(branch.territoryId, templateBoundary);
  }
  const routingPlan = await new RoutingPlanBuilder().build({
    skeletonPlan,
    skeletonBranchMap: branchMap,
    territoryPolygons,
  });
  const routingRecordMap = new Map<SkeletonBranchId, RoutingRecord>(
    routingPlan.records.map((record) => [record.branchId, record]),
  );
  const collisionIndex = new DeterministicCollisionEngine().index({
    skeletonPlan,
    skeletonBranchMap: branchMap,
    routingPlan,
    routingRecordMap,
    configuration: DEFAULT_ENGINE_CONFIGURATION.collision,
  });
  const nameMap = new Map<PersonId, string>();
  for (const branch of skeletonPlan.branches) {
    if (branch.generation > 0) nameMap.set(branch.ownerPersonId, branch.metadata.person.name);
  }
  const measurer = new OpentypeTextMeasurer();
  await measurer.initialize();

  return {
    skeletonPlan,
    skeletonBranchMap: branchMap,
    skeletonNodeMap: new Map(skeletonPlan.nodes.map((node) => [node.id, node])),
    graph,
    nameMap,
    configuration: DEFAULT_ENGINE_CONFIGURATION.labels,
    collisionQuery: new DefaultCandidateCollisionQuery(collisionIndex, templateBoundary),
    templateBoundary,
    textMeasurementService: measurer,
    cartoucheZones: undefined,
    fixedLabelPlacements: Object.freeze([]),
  };
};

describe("M7.3 label pipeline integration", () => {
  it("runs candidate generation, scoring, and deterministic assignment end-to-end", async () => {
    const input = await buildPipelineInput();
    const first = await runLabelPipeline(input);
    const second = await runLabelPipeline(input);

    expect(first.generatedCandidates.allCandidates.length).toBeGreaterThan(0);
    expect(first.generatedCandidates.validCandidates.length).toBeGreaterThan(0);
    expect(first.layout.placements.length).toBeGreaterThan(0);
    expect(first.layout.metrics.collisionCount).toBe(0);
    expect(first.layout.metrics.totalOverlapCount).toBe(0);
    expect(first.layout.deterministicFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.layout.deterministicFingerprint).toBe(first.layout.deterministicFingerprint);

    const query = new DefaultLabelCollisionQuery();
    for (let i = 0; i < first.layout.placements.length; i += 1) {
      for (let j = i + 1; j < first.layout.placements.length; j += 1) {
        expect(query.overlapsPlacedLabel(first.layout.placements[i]!.bounds, first.layout.placements[j]!)).toBe(false);
      }
    }
  });
});
