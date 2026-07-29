import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import { BotanicalLocalRelaxationEngine } from "../../../src/core/growth/index.js";
import { SkeletonValidator } from "../../../src/core/layout/SkeletonValidator.js";
import { LabelLayoutEngine } from "../../../src/core/labels/LabelLayoutEngine.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton, rectangularTemplate } from "../../helpers/skeleton-builders.js";

describe("BotanicalLocalRelaxationEngine", () => {
  it("improves territory attraction deterministically without breaking hard constraints", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    if (template.kind !== "POLYGON") throw new Error("Expected polygon template");
    const fixture = await growSkeleton(acceptedSnapshot(), template);
    if (!fixture.territoryResult.ok) throw new Error("Expected accepted territory plan");
    const originalSnapshot = JSON.stringify(fixture.skeletonPlan);
    const fixedLabels = new LabelLayoutEngine().layout({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      templatePolygon: template.polygon,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    });
    const engine = new BotanicalLocalRelaxationEngine();
    const input = {
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
      labelLayout: fixedLabels,
      relaxation: {
        maxIterations: 5,
        initialStepRatio: 0.025,
        maximumControlPointMovement: 4,
      },
    };

    const first = await engine.relax(input);
    const replay = await engine.relax(input);
    const reordered = await engine.relax({
      ...input,
      skeletonPlan: {
        ...fixture.skeletonPlan,
        branches: [...fixture.skeletonPlan.branches].reverse(),
      },
    });

    expect(replay).toEqual(first);
    expect(reordered).toEqual(first);
    expect(first.status).toBe("RELAXED");
    expect(first.skeletonPlan.status).toBe("ACCEPTED");
    expect(first.labelLayout.status).toBe("ACCEPTED");
    expect(first.labelLayout).toEqual(fixedLabels);
    expect(first.deterministicFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.skeletonPlan.deterministicFingerprint).not.toBe(
      fixture.skeletonPlan.deterministicFingerprint,
    );
    expect(first.metrics.acceptedIterationCount).toBeGreaterThan(0);
    expect(first.metrics.movedBranchCount).toBeGreaterThan(0);
    expect(first.metrics.meanTerritoryDistanceAfter).toBeLessThan(
      first.metrics.meanTerritoryDistanceBefore,
    );
    expect(first.metrics.scoreImprovement).toBeGreaterThan(0);
    expect(JSON.stringify(fixture.skeletonPlan)).toBe(originalSnapshot);

    const originalById = new Map(
      fixture.skeletonPlan.branches.map((branch) => [branch.id, branch]),
    );
    for (const branch of first.skeletonPlan.branches) {
      const original = originalById.get(branch.id);
      expect(original).toBeDefined();
      expect(branch.curve.p0).toEqual(original?.curve.p0);
      expect(branch.curve.p3).toEqual(original?.curve.p3);
      expect(branch.startPoint).toEqual(original?.startPoint);
      expect(branch.endPoint).toEqual(original?.endPoint);
    }

    const report = new SkeletonValidator().validate(
      first.skeletonPlan,
      fixture.graph,
      first.skeletonPlan.selectedRootId,
      template.polygon,
      new Map(
        fixture.territoryResult.value.territories.map((territory) => [
          territory.id,
          territory.polygon,
        ]),
      ),
    );
    expect(report.accepted).toBe(true);
    expect(report.metrics.intersectionCount).toBe(0);
    expect(report.metrics.outOfBoundsCount).toBe(0);
  });

  it("rejects mismatched territory provenance", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    const fixture = await growSkeleton(acceptedSnapshot(), template);
    if (!fixture.territoryResult.ok) throw new Error("Expected accepted territory plan");

    await expect(new BotanicalLocalRelaxationEngine().relax({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: {
        ...fixture.territoryResult.value,
        deterministicFingerprint: "different",
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    })).rejects.toThrow("fingerprints do not match");
  });

  it("validates relaxation configuration", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    const fixture = await growSkeleton(acceptedSnapshot(), template);
    if (!fixture.territoryResult.ok) throw new Error("Expected accepted territory plan");

    await expect(new BotanicalLocalRelaxationEngine().relax({
      graph: fixture.graph,
      skeletonPlan: fixture.skeletonPlan,
      territoryPlan: fixture.territoryResult.value,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
      relaxation: { maxIterations: 0 },
    })).rejects.toThrow("maxIterations");
  });
});
