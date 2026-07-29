import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { buildGenealogyGraph } from "../../src/core/genealogy/graph.js";
import { DeterministicDemandEngine } from "../../src/core/demand/DemandEngine.js";
import { DeterministicTerritoryPlanner } from "../../src/core/territory/TerritoryPlanner.js";
import { DeterministicSkeletonGrowthEngine } from "../../src/core/skeleton/SkeletonGrowthEngine.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { rectangularTemplate } from "../helpers/territory-builders.js";
import { SkeletonValidator } from "../../src/core/layout/SkeletonValidator.js";

describe("Territory to Skeleton integration", () => {
  it("grows a valid skeleton from an accepted territory plan with validation", async () => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const selectedRootId = graph.roots[0]!;
    const demandPlan = await new DeterministicDemandEngine().compute({
      graph,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
    });
    const territoryResult = await new DeterministicTerritoryPlanner().plan({
      graph,
      demandPlan,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      templateBoundary: rectangularTemplate(),
      configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
      seed: 42,
    });
    expect(territoryResult.ok).toBe(true);
    if (!territoryResult.ok) return;

    const territoryPlan = territoryResult.value;
    const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
      graph,
      demandPlan,
      territoryPlan,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
      seed: 42,
    });

    // Validate skeleton
    const validator = new SkeletonValidator();
    const territoryPolygons = new Map(
      territoryPlan.territories.map((t) => [t.ownerLineageRootId, t.polygon]),
    );
    const validationResult = validator.validate(
      skeletonPlan,
      graph,
      selectedRootId,
      territoryPlan.templatePolygon,
      territoryPolygons,
    );

    // The skeleton has branches and nodes
    expect(skeletonPlan.status).toBe("ACCEPTED");
    expect(skeletonPlan.trunk.segments.length).toBeGreaterThanOrEqual(1);
    expect(skeletonPlan.branches.length).toBeGreaterThan(0);
    expect(skeletonPlan.mappedJunctions.length).toBeGreaterThanOrEqual(1);

    // Validation metrics are populated
    expect(validationResult.metrics.branchCount).toBeGreaterThan(0);
    expect(validationResult.metrics.nodeCount).toBeGreaterThan(0);
    expect(validationResult.metrics.trunkSegmentCount).toBeGreaterThanOrEqual(1);
  });

  it("produces a byte-identical skeleton on replay with same seed", async () => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const selectedRootId = graph.roots[0]!;

    const runGrowth = async () => {
      const demandPlan = await new DeterministicDemandEngine().compute({
        graph,
        selectedRootId,
        sourceChecksum: snapshot.sourceChecksum,
        configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
      });
      const territoryResult = await new DeterministicTerritoryPlanner().plan({
        graph,
        demandPlan,
        selectedRootId,
        sourceChecksum: snapshot.sourceChecksum,
        templateBoundary: rectangularTemplate(),
        configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
        seed: 42,
      });
      if (!territoryResult.ok) throw new Error("Territory plan failed");
      return await new DeterministicSkeletonGrowthEngine().grow({
        graph,
        demandPlan,
        territoryPlan: territoryResult.value,
        selectedRootId,
        sourceChecksum: snapshot.sourceChecksum,
        configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
        seed: 42,
      });
    };

    const first = await runGrowth();
    const second = await runGrowth();

    expect(first.deterministicFingerprint).toBe(
      second.deterministicFingerprint,
    );
  });
});
