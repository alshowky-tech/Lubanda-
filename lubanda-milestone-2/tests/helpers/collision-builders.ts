import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { acceptedSnapshot } from "./genealogy-builders.js";
import { growSkeleton } from "./skeleton-builders.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../src/core/routing/RoutingPlanBuilder.js";
import type { SkeletonBranch } from "../../src/core/skeleton/types.js";
import type { RoutingRecord } from "../../src/core/routing/types.js";
import type { CollisionInput } from "../../src/core/collision/types.js";
import type { Polygon } from "../../src/core/geometry/types.js";
import type { SkeletonBranchId } from "../../src/core/contracts/identifiers.js";

export const buildCollisionInput = async (seed = 42): Promise<CollisionInput> => {
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
  return {
    skeletonPlan,
    skeletonBranchMap: branchMap,
    routingPlan,
    routingRecordMap,
    configuration: DEFAULT_ENGINE_CONFIGURATION.collision,
  };
};
