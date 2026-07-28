import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { DeterministicDemandEngine } from "../../src/core/demand/index.js";
import { buildGenealogyGraph } from "../../src/core/genealogy/index.js";
import { DeterministicTerritoryPlanner } from "../../src/core/territory/index.js";
import { DeterministicSkeletonGrowthEngine } from "../../src/core/skeleton/index.js";
import type { GenealogySnapshot } from "../../src/core/genealogy/types.js";
import type { TemplateBoundary } from "../../src/core/territory/types.js";
import type { SkeletonPlan } from "../../src/core/skeleton/types.js";

export const rectangularTemplate = (
  width = 4_000,
  height = 2_500,
): TemplateBoundary => ({
  kind: "POLYGON",
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  },
});

export const growSkeleton = async (
  snapshot: GenealogySnapshot,
  templateBoundary: TemplateBoundary = rectangularTemplate(),
  seed = 42,
  skeletonConfiguration = DEFAULT_ENGINE_CONFIGURATION.skeleton,
  territoryConfiguration = DEFAULT_ENGINE_CONFIGURATION.territory,
): Promise<{
  graph: ReturnType<typeof buildGenealogyGraph>;
  selectedRootId: string;
  demandPlan: Awaited<ReturnType<DeterministicDemandEngine["compute"]>>;
  territoryResult: Awaited<ReturnType<DeterministicTerritoryPlanner["plan"]>>;
  skeletonPlan: SkeletonPlan;
}> => {
  const graph = buildGenealogyGraph(snapshot);
  const selectedRootId =
    graph.roots.find((root) => root === "1") ?? graph.roots[0]!;
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
    templateBoundary,
    configuration: territoryConfiguration,
    seed,
  });
  if (!territoryResult.ok) {
    throw new Error(
      `Territory planning failed: ${JSON.stringify(territoryResult.errors)}`,
    );
  }
  const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
    graph,
    demandPlan,
    territoryPlan: territoryResult.value,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: skeletonConfiguration,
    seed,
  });
  return { graph, selectedRootId, demandPlan, territoryResult, skeletonPlan };
};
