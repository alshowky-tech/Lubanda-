import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { expandBounds } from "../../src/core/geometry/bounds.js";
import { LabelCollisionQuery } from "../../src/core/labels/LabelCollisionQuery.js";
import { boundsInsidePolygon } from "../../src/core/labels/LabelCandidateGenerator.js";
import { LabelLayoutEngine } from "../../src/core/labels/LabelLayoutEngine.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { growSkeleton, rectangularTemplate } from "../helpers/skeleton-builders.js";

describe("skeleton-to-label integration", () => {
  it("generates multiple deterministic candidates and a collision-free layout", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    if (template.kind !== "POLYGON") throw new Error("Expected polygon template");
    const { graph, skeletonPlan } = await growSkeleton(acceptedSnapshot(), template);
    expect(skeletonPlan.status).toBe("ACCEPTED");

    const engine = new LabelLayoutEngine();
    const input = {
      graph,
      skeletonPlan,
      templatePolygon: template.polygon,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    };
    const first = engine.layout(input);
    const replay = engine.layout(input);
    const reordered = engine.layout({
      ...input,
      skeletonPlan: {
        ...skeletonPlan,
        branches: [...skeletonPlan.branches].reverse(),
      },
    });
    const expectedPersonCount = new Set(
      skeletonPlan.branches.map((branch) => branch.ownerPersonId),
    ).size;

    expect(replay).toEqual(first);
    expect(reordered).toEqual(first);
    expect(first.status).toBe("ACCEPTED");
    expect(first.metrics.requestedPersonCount).toBe(expectedPersonCount);
    expect(first.placements).toHaveLength(expectedPersonCount);
    expect(first.metrics.candidateCount).toBeGreaterThan(first.metrics.requestedPersonCount);
    expect(new Set(first.candidates.map((candidate) => candidate.candidateId)).size)
      .toBe(first.candidates.length);
    expect(first.candidates.length + first.metrics.boundaryRejectedCandidateCount)
      .toBe(expectedPersonCount * 24);
    expect(first.rejected.some((item) =>
      item.reason === "COLLISION" &&
      item.collisionIds.some((id) => id.startsWith("wood:")),
    )).toBe(true);
    expect(first.placements.map((placement) => placement.personId)).toEqual(
      [...first.placements.map((placement) => placement.personId)].sort(),
    );
    for (const placement of first.placements) {
      expect(boundsInsidePolygon(
        expandBounds(
          placement.bounds,
          DEFAULT_ENGINE_CONFIGURATION.collision.labelClearance,
        ),
        template.polygon,
      )).toBe(true);
    }

    const query = new LabelCollisionQuery({
      clearance: DEFAULT_ENGINE_CONFIGURATION.collision.labelClearance / 2,
    });
    for (const placement of first.placements) {
      expect(query.hasCollision(placement.bounds)).toBe(false);
      query.addPlacement(placement);
    }
  });

  it("reports every unresolved person when the boundary excludes all candidates", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    const { graph, skeletonPlan } = await growSkeleton(acceptedSnapshot(), template);
    const expectedPersonCount = new Set(
      skeletonPlan.branches.map((branch) => branch.ownerPersonId),
    ).size;
    const result = new LabelLayoutEngine().layout({
      graph,
      skeletonPlan,
      templatePolygon: {
        points: [
          { x: -100, y: -100 },
          { x: -10, y: -100 },
          { x: -10, y: -10 },
          { x: -100, y: -10 },
        ],
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.placements).toHaveLength(0);
    expect(result.unresolvedPersonIds).toHaveLength(expectedPersonCount);
    expect(result.diagnostics).toHaveLength(expectedPersonCount);
    expect(result.diagnostics.every((item) =>
      item.code === "LABEL_UNRESOLVED" &&
      item.collisionIds.includes("boundary:template"),
    )).toBe(true);
  });
});
