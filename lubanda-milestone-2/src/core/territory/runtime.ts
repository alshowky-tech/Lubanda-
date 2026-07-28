import type { CorridorId, PersonId, TerritoryId } from "../contracts/index.js";
import type {
  GrowthCorridor,
  ReservedJunctionZone,
  Territory,
  TerritoryPlan,
} from "./types.js";

export interface TerritoryRuntimeIndex {
  readonly territoryById: ReadonlyMap<TerritoryId, Territory>;
  readonly territoryByOwnerId: ReadonlyMap<PersonId, Territory>;
  readonly corridorById: ReadonlyMap<CorridorId, GrowthCorridor>;
  readonly junctionById: ReadonlyMap<string, ReservedJunctionZone>;
}

export const buildTerritoryRuntimeIndex = (
  plan: TerritoryPlan,
): TerritoryRuntimeIndex => ({
  territoryById: new Map(plan.territories.map((item) => [item.id, item])),
  territoryByOwnerId: new Map(
    plan.territories.map((item) => [item.ownerLineageRootId, item]),
  ),
  corridorById: new Map(plan.corridors.map((item) => [item.id, item])),
  junctionById: new Map(plan.junctionZones.map((item) => [item.id, item])),
});

