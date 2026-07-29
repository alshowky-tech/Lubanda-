import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import { canonicalJson } from "../../../src/core/determinism/index.js";
import {
  BotanicalGrowthIntelligenceEngine,
} from "../../../src/core/growth-intelligence/index.js";
import { BotanicalTerritoryGrowthEngine } from "../../../src/core/territory-growth/index.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton, rectangularTemplate } from "../../helpers/skeleton-builders.js";

describe("BotanicalGrowthIntelligenceEngine", () => {
  it("adds deterministic global guidance without changing genealogy or topology", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    const fixture = await growSkeleton(acceptedSnapshot(), template);
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    const arborIvy = await new BotanicalTerritoryGrowthEngine().grow({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    });
    const input = {
      graph: fixture.graph,
      skeletonPlan: arborIvy.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    };
    const first = await new BotanicalGrowthIntelligenceEngine().guide(input);
    const replay = await new BotanicalGrowthIntelligenceEngine().guide(input);

    expect(replay).toEqual(first);
    expect(first.deterministicFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.skeletonPlan.status).toBe("ACCEPTED");
    expect(first.skeletonPlan.validation.metrics.intersectionCount).toBe(0);
    expect(first.growthVectors.length).toBeGreaterThan(0);
    expect(first.densityCells.length).toBeGreaterThan(0);
    expect(first.metrics.movedBranchCount).toBeGreaterThan(0);
    expect(first.metrics.acceptedIntensity).toBeGreaterThan(0);

    const signature = (branch: typeof first.skeletonPlan.branches[number]) => ({
      id: branch.id,
      ownerPersonId: branch.ownerPersonId,
      parentBranchId: branch.parentBranchId,
      childrenBranchIds: branch.childrenBranchIds,
      territoryId: branch.territoryId,
      startNodeId: branch.startNodeId,
      endNodeId: branch.endNodeId,
      startPoint: branch.startPoint,
      endPoint: branch.endPoint,
    });
    expect(canonicalJson(first.skeletonPlan.branches.map(signature))).toBe(
      canonicalJson(arborIvy.skeletonPlan.branches.map(signature)),
    );
  });

  it("uses deterministic archetype intelligence profiles", async () => {
    const fixture = await growSkeleton(
      acceptedSnapshot(),
      rectangularTemplate(8_000, 5_000),
    );
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    const arborIvy = await new BotanicalTerritoryGrowthEngine().grow({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    });
    const fingerprints = new Set<string>();
    for (const archetype of ["olive", "oak", "pine", "freeform"] as const) {
      const result = await new BotanicalGrowthIntelligenceEngine().guide({
        graph: fixture.graph,
        skeletonPlan: arborIvy.skeletonPlan,
        territoryPlan: fixture.territoryResult.value,
        configuration: DEFAULT_ENGINE_CONFIGURATION,
        intelligence: { archetype },
      });
      expect(result.skeletonPlan.status).toBe("ACCEPTED");
      fingerprints.add(result.deterministicFingerprint);
    }
    expect(fingerprints.size).toBe(4);
  });

  it("rejects mismatched territory provenance", async () => {
    const fixture = await growSkeleton(acceptedSnapshot());
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    await expect(new BotanicalGrowthIntelligenceEngine().guide({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: {
        ...fixture.territoryResult.value,
        deterministicFingerprint: "different",
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    })).rejects.toThrow("fingerprints do not match");
  });
});
