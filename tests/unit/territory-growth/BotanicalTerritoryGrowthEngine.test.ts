import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import { SkeletonValidator } from "../../../src/core/layout/index.js";
import {
  BotanicalTerritoryGrowthEngine,
} from "../../../src/core/territory-growth/index.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton, rectangularTemplate } from "../../helpers/skeleton-builders.js";

describe("BotanicalTerritoryGrowthEngine", () => {
  it("creates deterministic hierarchical crown geometry without changing topology", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    if (template.kind !== "POLYGON") throw new Error("Expected polygon template");
    const fixture = await growSkeleton(acceptedSnapshot(), template);
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    const engine = new BotanicalTerritoryGrowthEngine();
    const input = {
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    };
    const first = await engine.grow(input);
    const replay = await engine.grow(input);

    expect(replay).toEqual(first);
    expect(first.skeletonPlan.status).toBe("ACCEPTED");
    expect(first.deterministicFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.skeletonPlan.deterministicFingerprint).not.toBe(
      fixture.skeletonPlan.deterministicFingerprint,
    );
    expect(first.metrics.primaryBranchCount).toBe(2);
    expect(first.metrics.secondaryBranchCount).toBe(1);
    expect(first.metrics.branchHierarchy.trunk).toBe(
      fixture.skeletonPlan.trunk.segments.length,
    );

    const before = new Map(
      fixture.skeletonPlan.branches.map((branch) => [branch.id, branch]),
    );
    for (const branch of first.skeletonPlan.branches) {
      const original = before.get(branch.id);
      expect(original).toBeDefined();
      expect(branch.ownerPersonId).toBe(original?.ownerPersonId);
      expect(branch.parentBranchId).toBe(original?.parentBranchId);
      expect(branch.childrenBranchIds).toEqual(original?.childrenBranchIds);
      expect(branch.startNodeId).toBe(original?.startNodeId);
      expect(branch.endNodeId).toBe(original?.endNodeId);
    }
    const trunk = first.skeletonPlan.branches.find((branch) =>
      first.skeletonPlan.trunk.segments.includes(branch.id)
    );
    const primary = first.skeletonPlan.branches.find((branch) =>
      branch.genealogyDepth === 1
    );
    const secondary = first.skeletonPlan.branches.find((branch) =>
      branch.genealogyDepth === 2
    );
    expect(trunk?.thickness.baseThickness).toBeGreaterThan(
      primary?.thickness.baseThickness ?? Number.POSITIVE_INFINITY,
    );
    expect(primary?.thickness.baseThickness).toBeGreaterThan(
      secondary?.thickness.baseThickness ?? Number.POSITIVE_INFINITY,
    );

    const validation = new SkeletonValidator().validate(
      first.skeletonPlan,
      fixture.graph,
      first.skeletonPlan.selectedRootId,
      template.polygon,
      new Map(fixture.territoryResult.value.territories.map((territory) => [
        territory.id,
        territory.polygon,
      ])),
    );
    expect(validation.accepted).toBe(true);
    expect(validation.metrics.intersectionCount).toBe(0);
  });

  it("rejects mismatched territory provenance", async () => {
    const fixture = await growSkeleton(acceptedSnapshot());
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    await expect(new BotanicalTerritoryGrowthEngine().grow({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: {
        ...fixture.territoryResult.value,
        deterministicFingerprint: "different",
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    })).rejects.toThrow("fingerprints do not match");
  });

  it("supports deterministic olive, pine, oak, and freeform arbor archetypes", async () => {
    const fixture = await growSkeleton(
      acceptedSnapshot(),
      rectangularTemplate(8_000, 5_000),
    );
    if (!fixture.territoryResult.ok) throw new Error("Expected territories");
    const fingerprints = new Set<string>();
    for (const archetype of ["olive", "pine", "oak", "freeform"] as const) {
      const result = await new BotanicalTerritoryGrowthEngine().grow({
        graph: fixture.graph,
        skeletonPlan: fixture.skeletonPlan,
        territoryPlan: fixture.territoryResult.value,
        configuration: DEFAULT_ENGINE_CONFIGURATION,
        growth: { archetype, descendantStrategy: "ARBOR_IVY" },
      });
      expect(result.skeletonPlan.status).toBe("ACCEPTED");
      expect(result.skeletonPlan.validation.metrics.intersectionCount).toBe(0);
      fingerprints.add(result.deterministicFingerprint);
    }
    expect(fingerprints.size).toBe(4);
  });
});
